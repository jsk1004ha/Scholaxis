import { seedCatalog, trendingTopics } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { dedupeDocuments } from './dedup-service.mjs';
import { getStoredDocuments, persistDocuments, persistGraphEdges, persistSearchRun } from './storage.mjs';
import { getDocumentGraph, syncDocumentGraph } from './graph-service.mjs';
import { loadDocumentsFromPostgres, syncDocumentsToPostgres } from './postgres-store.mjs';
import { buildRecommendationSet } from './recommendation-service.mjs';
import { rerankSearchEntries } from './reranker-service.mjs';
import { searchLiveSources, sourceRegistrySummary } from './source-adapters.mjs';
import { buildCrossLingualQueryContext, expandQueryVariants, mergeSourceStatuses } from './source-helpers.mjs';
import { attachVectors, buildDenseVector, buildSparseVector, cosineSimilarity, normalizeText, sparseOverlapScore, tokenize, unique } from './vector-service.mjs';
import { searchVectorCandidates, syncDocumentVectors } from './vector-index-service.mjs';

const regionLabel = { all: '전체', domestic: '국내', global: '해외' };
const sourceTypeLabel = { all: '전체', paper: '논문', thesis: '학위논문', patent: '특허', report: '보고서', fair_entry: '전람회/발명품' };
const SEARCH_STOPWORDS = new Set([
  '연구','분석','시스템','모델','기반','설계','예측','요약','문서','검색','자료','평가','결과',
  'analysis','research','system','model','based','design','prediction','summary','document','search','data','evaluation','results'
]);
const GLOBAL_SOURCES = new Set(['semantic_scholar', 'arxiv']);
const DOMESTIC_SOURCES = new Set(['riss', 'kci', 'scienceon', 'dbpia', 'ntis', 'kipris', 'science_fair', 'student_invention_fair']);

function classifySourceType(type) {
  if (['paper', 'thesis', 'patent', 'report', 'fair_entry'].includes(type)) return type;
  return 'paper';
}

function buildQueryTokens(query = '') {
  const base = unique(tokenize(query));
  const normalized = normalizeText(query).replace(/\s+/g, '');
  const variants = expandQueryVariants(query).flatMap((value) => tokenize(value));

  const koreanChunks = [];
  if (/^[가-힣]{4,}$/.test(normalized)) {
    for (let index = 0; index <= normalized.length - 2; index += 1) {
      koreanChunks.push(normalized.slice(index, index + 2));
    }
    for (let index = 0; index <= normalized.length - 3; index += 1) {
      koreanChunks.push(normalized.slice(index, index + 3));
    }
  }

  return unique([...base, ...variants, ...koreanChunks]).filter((token) => token.length >= 2);
}

function hasQueryEvidence(scoreBundle, queryTokens = [], queryTerms = [], rawQueryTermCount = 0, document = {}, query = '') {
  if (!queryTokens.length) return true;
  const normalizedTitle = String(document.title || '').toLowerCase();
  const normalizedEnglishTitle = String(document.englishTitle || '').toLowerCase();
  const normalizedBody = normalizeText(
    [
      document.title,
      document.englishTitle,
      document.abstract,
      document.summary,
      ...(document.keywords || []),
      ...(document.methods || []),
      ...(document.highlights || [])
    ]
      .filter(Boolean)
      .join(' ')
  );
  const normalizedQuery = String(query || '').toLowerCase().trim();
  if (normalizedQuery && (normalizedTitle.includes(normalizedQuery) || normalizedEnglishTitle.includes(normalizedQuery))) return true;
  const exactTermMatches = queryTerms.filter((token) => normalizedBody.includes(token));
  if (queryTerms.length >= 2) {
    return exactTermMatches.length >= Math.min(2, queryTerms.length);
  }
  if (queryTerms.length === 1 && exactTermMatches.length >= 1) return true;
  if (rawQueryTermCount >= 2) return false;
  if (queryTokens.some((token) => normalizedBody.includes(token))) return true;
  return (
    scoreBundle.lexicalScore >= 8 ||
    scoreBundle.sparseScore >= 0.14
  );
}

function scoreDocument(document, queryTokens, queryVector, querySparse) {
  const lexicalText = [
    document.title,
    document.englishTitle,
    document.abstract,
    document.summary,
    document.novelty,
    document.organization,
    ...(document.keywords || []),
    ...(document.methods || []),
    ...(document.highlights || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let lexicalScore = 0;
  for (const token of queryTokens) {
    if ((document.title || '').toLowerCase().includes(token)) lexicalScore += 12;
    if ((document.englishTitle || '').toLowerCase().includes(token)) lexicalScore += 6;
    if ((document.abstract || '').toLowerCase().includes(token)) lexicalScore += 5;
    if ((document.summary || '').toLowerCase().includes(token)) lexicalScore += 4;
    if ((document.keywords || []).some((keyword) => keyword.toLowerCase().includes(token))) lexicalScore += 7;
    if ((document.methods || []).some((method) => method.toLowerCase().includes(token))) lexicalScore += 4;
    if (lexicalText.includes(token)) lexicalScore += 2;
  }

  const denseScore = cosineSimilarity(queryVector, document.vector || []);
  const sparseScore = sparseOverlapScore(querySparse, document.sparseVector || {});
  const domesticBias = document.region === 'domestic' ? 0.08 : 0;
  const sourcePriority = ['semantic_scholar', 'arxiv', 'riss', 'kci', 'scienceon', 'dbpia', 'ntis', 'kipris'].includes(document.source)
    ? 0.06
    : 0.04;
  const citationScore = Math.min((document.citations || 0) / 500, 0.12);
  const recencyScore = document.year ? Math.max(0, (document.year - 2018) * 0.01) : 0;

  return {
    lexicalScore,
    denseScore,
    sparseScore,
    total:
      lexicalScore * 0.55 +
      denseScore * 22 +
      sparseScore * 14 +
      domesticBias * 100 +
      sourcePriority * 100 +
      citationScore * 100 +
      recencyScore * 100
  };
}

function summarizeFilters({ region, sourceType, sort }) {
  return `${regionLabel[region] || '전체'} · ${sourceTypeLabel[sourceType] || '전체'} · ${sort === 'latest' ? '최신순' : sort === 'citation' ? '인용순' : '관련도순'}`;
}

function splitSourcesForCrossLingual(preferredSources = [], direction = 'none') {
  const selected = preferredSources.length ? preferredSources : [...GLOBAL_SOURCES, ...DOMESTIC_SOURCES];
  if (direction === 'ko-to-en') {
    return {
      originalSources: selected.filter((source) => !GLOBAL_SOURCES.has(source)),
      translatedSources: selected.filter((source) => GLOBAL_SOURCES.has(source))
    };
  }
  if (direction === 'en-to-ko') {
    return {
      originalSources: selected.filter((source) => !DOMESTIC_SOURCES.has(source)),
      translatedSources: selected.filter((source) => DOMESTIC_SOURCES.has(source))
    };
  }
  return { originalSources: selected, translatedSources: [] };
}

function mergeLiveBundles(...bundles) {
  const documents = [];
  const statuses = new Map();
  for (const bundle of bundles.filter(Boolean)) {
    documents.push(...(bundle.documents || []));
    for (const status of bundle.statuses || []) {
      const current = statuses.get(status.source) || {};
      statuses.set(status.source, { ...current, ...status });
    }
  }
  return {
    documents,
    statuses: [...statuses.values()]
  };
}

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.canonicalId || item?.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateMatchesPaper(paper, candidate) {
  const paperTokens = new Set(tokenize([paper.title, ...(paper.keywords || [])].join(' ')));
  const candidateTokens = new Set(tokenize([candidate.title, ...(candidate.keywords || [])].join(' ')));
  return [...paperTokens].some((token) => candidateTokens.has(token));
}

function describeGraphInsights(paper, graph, recommendations = []) {
  const referenceCount = graph.references?.length || 0;
  const citationCount = graph.citations?.length || 0;
  const authorAffinityCount = graph.authorAffinity?.length || 0;
  const topRecommendation = recommendations[0] || null;
  return {
    summary:
      referenceCount || citationCount
        ? `이 문헌은 참고문헌 ${referenceCount}건, 후속 인용 ${citationCount}건, 저자 연구 맵 ${authorAffinityCount}건과 연결됩니다.`
        : '아직 직접 그래프 엣지는 적지만 키워드·저자·인용 신호를 기반으로 후속 읽기 후보를 확장할 수 있습니다.',
    whyItMatters: [
      referenceCount ? `선행 연구 축이 ${referenceCount}건으로 형성되어 관련 연구 검토 경로가 뚜렷합니다.` : null,
      citationCount ? `후속 인용 축이 ${citationCount}건 있어 최근 영향 범위를 빠르게 파악할 수 있습니다.` : null,
      authorAffinityCount ? `저자/기관 기반 연관 연구 ${authorAffinityCount}건이 있어 연구실 단위 추적에 유리합니다.` : null,
      topRecommendation ? `가장 먼저 읽을 후보는 “${topRecommendation.title}”입니다.` : null,
    ].filter(Boolean),
  };
}

function buildComparisonMatrix(paper, recommendations = [], citations = [], references = []) {
  const groups = [
    ...recommendations.slice(0, 2).map((item) => ({ lane: '추천', item })),
    ...citations.slice(0, 2).map((item) => ({ lane: '후속 인용', item })),
    ...references.slice(0, 2).map((item) => ({ lane: '선행 참고', item })),
  ];
  return groups.map(({ lane, item }) => ({
    lane,
    id: item.canonicalId || item.id,
    title: item.title,
    year: item.year,
    source: item.sourceLabel || item.source,
    comparison: [
      item.year && paper.year
        ? item.year >= paper.year
          ? '현재 문헌보다 최신 흐름을 보여줍니다.'
          : '현재 문헌의 선행 배경을 보완합니다.'
        : null,
      (item.keywords || []).length && (paper.keywords || []).length
        ? `공통 키워드 ${unique((item.keywords || []).filter((keyword) => (paper.keywords || []).includes(keyword))).slice(0, 3).join(', ') || '정보 없음'}`
        : null,
      item.organization && paper.organization && item.organization !== paper.organization
        ? `기관/출처가 달라 비교 관점 확보에 유리합니다.`
        : null,
    ].filter(Boolean)
  }));
}


function buildGraphEdgesFromResults(results = []) {
  if (!results.length) return [];
  const [head, ...tail] = results;
  return tail.map((item) => ({
    sourceId: head.canonicalId || head.id,
    targetId: item.canonicalId || item.id,
    edgeType: 'similar',
    weight: Number(item.score || 0)
  }));
}

async function buildSearchIndexDocuments(liveDocuments = []) {
  const postgres = appConfig.storageBackend === 'postgres' ? await loadDocumentsFromPostgres() : [];
  const stored = getStoredDocuments();
  return dedupeDocuments([...seedCatalog, ...stored, ...postgres, ...liveDocuments]).map((document) =>
    attachVectors(document, appConfig.vectorDimensions)
  );
}

function normalizeSearchResult(document, rank, scoreBundle) {
  return {
    id: document.canonicalId || document.id,
    rank,
    score: Number(scoreBundle.total.toFixed(2)),
    lexicalScore: Number(scoreBundle.lexicalScore.toFixed(2)),
    denseScore: Number(scoreBundle.denseScore.toFixed(4)),
    sparseScore: Number(scoreBundle.sparseScore.toFixed(4)),
    type: classifySourceType(document.type),
    region: document.region,
    year: document.year,
    title: document.title,
    englishTitle: document.englishTitle,
    authors: document.authors,
    organization: document.organization,
    source: document.sourceLabel || document.source,
    sourceKey: document.source,
    alternateSources: document.alternateSources || [document.source],
    citations: document.citations,
    openAccess: document.openAccess,
    summary: document.summary,
    keywords: document.keywords,
    highlights: document.highlights,
    canonicalId: document.canonicalId,
    links: document.links || {}
  };
}

export function listTrends() {
  return trendingTopics;
}

export function listSourceStatuses(query = '') {
  return sourceRegistrySummary(query).map((item) => ({
    source: item.source,
    status: item.liveEnabled ? 'configured' : 'disabled',
    latency: item.type === 'api' ? 'fast' : 'moderate',
    coverage: item.coverage,
    note: item.note,
    detailUrl: item.detailUrl
  }));
}

export function getSearchSuggestions(query = '') {
  const tokens = unique(tokenize(query));
  const pool = unique([
    ...trendingTopics,
    ...seedCatalog.map((item) => item.title),
    ...seedCatalog.flatMap((item) => item.keywords)
  ]);

  const suggestions = pool
    .filter((entry) => (tokens.length ? tokens.some((token) => entry.toLowerCase().includes(token)) : true))
    .slice(0, 10);

  return {
    query,
    suggestions,
    fallback: trendingTopics.slice(0, 8)
  };
}

function emitSearchEvent(onEvent, type, payload) {
  if (typeof onEvent !== 'function') return;
  onEvent({ type, payload });
}

async function executeSearchCatalog({
  q = '',
  region = 'all',
  sourceType = 'all',
  sort = 'relevance',
  preferredSources = [],
  live = appConfig.enableLiveSources,
  forceRefresh = false,
  autoLive = appConfig.autoLiveOnEmpty
} = {}, onEvent = null) {
  const crossLingual = await buildCrossLingualQueryContext(q);
  const retrievalQuery = unique([q, crossLingual.translatedQuery].filter(Boolean)).join(' ').trim() || q;
  const queryTokens = buildQueryTokens(retrievalQuery);
  const queryTerms = unique(tokenize(retrievalQuery)).filter((token) => !SEARCH_STOPWORDS.has(token));
  const rawQueryTermCount = unique(tokenize(retrievalQuery)).length;
  const queryVector = buildDenseVector(retrievalQuery, appConfig.vectorDimensions);
  const querySparse = buildSparseVector(retrievalQuery);
  const shouldAutoLive = Boolean(q.trim()) && autoLive && !live;
  const filters = {
    region,
    sourceType,
    sort,
    preferredSources,
    crossLingual: crossLingual.enabled,
    crossLingualBackend: crossLingual.backend,
  };

  emitSearchEvent(onEvent, 'summary', {
    query: q,
    filters,
    summary: q
      ? `“${q}” 검색을 시작합니다. 로컬 인덱스와 라이브 소스를 순차적으로 확인합니다.`
      : `기본 탐색 결과를 준비하고 있습니다.`,
    crossLingual
  });

  function rankDocuments(documents = []) {
    return documents
      .filter((item) => (region === 'all' ? true : item.region === region))
      .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
      .map((item) => ({ item, scoreBundle: scoreDocument(item, queryTokens, queryVector, querySparse) }));
  }

  async function attachVectorBoost(entries = []) {
    const documents = entries.map((entry) => entry.item);
    const vectorHits = await searchVectorCandidates({
      query: retrievalQuery,
      documents,
      limit: appConfig.recommendationCandidateLimit,
    });
    const vectorHitScores = new Map(vectorHits.map((entry) => [entry.id, entry.score]));
    return entries
      .map(({ item, scoreBundle }) => ({
        item,
        scoreBundle: {
          ...scoreBundle,
          total: scoreBundle.total + (vectorHitScores.get(item.canonicalId || item.id) || 0) * 10,
        },
      }))
      .filter(({ item, scoreBundle }) => hasQueryEvidence(scoreBundle, queryTokens, queryTerms, rawQueryTermCount, item, retrievalQuery));
  }

  let liveBundle = { documents: [], statuses: [] };
  let mergedSourceData = await buildSearchIndexDocuments();
  emitSearchEvent(onEvent, 'progress', {
    stage: 'seed-index',
    query: q,
    filters,
    message: `기본/저장 인덱스 ${mergedSourceData.length}건을 스캔했습니다.`,
    indexedCount: mergedSourceData.length
  });
  let rankedEntries = await attachVectorBoost(rankDocuments(mergedSourceData));

  if ((live || shouldAutoLive) && (!rankedEntries.length || live)) {
    emitSearchEvent(onEvent, 'progress', {
      stage: 'live-fetch',
      query: q,
      filters,
      message: `라이브 소스를 조회하고 있습니다.`,
      preferredSources
    });
    const sourceSplit = splitSourcesForCrossLingual(preferredSources, crossLingual.direction);
    const originalLiveBundle = await searchLiveSources(q, sourceSplit.originalSources, appConfig.maxLiveResultsPerSource, {
      forceRefresh,
      overrideEnable: shouldAutoLive || live
    });
    const translatedLiveBundle =
      crossLingual.enabled && crossLingual.translatedQuery && sourceSplit.translatedSources.length
        ? await searchLiveSources(crossLingual.translatedQuery, sourceSplit.translatedSources, appConfig.maxLiveResultsPerSource, {
            forceRefresh,
            overrideEnable: shouldAutoLive || live
          })
        : { documents: [], statuses: [] };
    liveBundle = mergeLiveBundles(originalLiveBundle, translatedLiveBundle);
    mergedSourceData = await buildSearchIndexDocuments(liveBundle.documents);
    rankedEntries = await attachVectorBoost(rankDocuments(mergedSourceData));
    emitSearchEvent(onEvent, 'progress', {
      stage: 'live-merged',
      query: q,
      filters,
      message: `라이브 소스 ${liveBundle.documents.length}건을 병합했습니다.`,
      liveSourceCount: liveBundle.documents.length,
      sourceStatus: mergeSourceStatuses(listSourceStatuses(q), liveBundle.statuses)
    });
  }

  const ranked = [...rankedEntries].sort((a, b) => {
    if (sort === 'latest') return (b.item.year || 0) - (a.item.year || 0) || b.scoreBundle.total - a.scoreBundle.total;
    if (sort === 'citation') return (b.item.citations || 0) - (a.item.citations || 0) || b.scoreBundle.total - a.scoreBundle.total;
    return b.scoreBundle.total - a.scoreBundle.total || (b.item.year || 0) - (a.item.year || 0);
  });
  const rerankResult =
    sort === 'relevance'
      ? await rerankSearchEntries(ranked, q, crossLingual, appConfig.rerankerTopK)
      : { entries: ranked, diagnostics: { backend: 'none', applied: false, topK: 0 } };
  const reranked = rerankResult.entries;

  const summary = q
    ? reranked.length
      ? `“${q}”에 대해 ${reranked.length}건의 ${sourceTypeLabel[sourceType] || '자료'}를 찾았습니다. ${summarizeFilters({ region, sourceType, sort })} 기준 결과입니다.`
      : `“${q}”와 충분히 관련된 ${sourceTypeLabel[sourceType] || '자료'}를 찾지 못했습니다. 더 구체적인 키워드나 유사 표현으로 다시 시도해 보세요.`
    : `탐색 가능한 ${reranked.length}건의 자료를 불러왔습니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`;

  const results = reranked.map(({ item, scoreBundle }, index) => ({
    ...normalizeSearchResult(item, index + 1, scoreBundle),
    rerankScore: Number((scoreBundle.rerankScore || 0).toFixed(4)),
    rerankReason: scoreBundle.rerankReason || '',
  }));
  const sourceStatus = mergeSourceStatuses(listSourceStatuses(q), liveBundle.statuses);
  persistDocuments(mergedSourceData);
  persistGraphEdges(buildGraphEdgesFromResults(results));
  await syncDocumentGraph(mergedSourceData);
  await syncDocumentVectors(mergedSourceData);
  await syncDocumentsToPostgres(mergedSourceData);
  persistSearchRun({ query: q, filters, total: reranked.length, liveSourceCount: liveBundle.documents.length, canonicalCount: mergedSourceData.length });

  const payload = {
    query: q,
    filters,
    summary,
    total: reranked.length,
    relatedQueries: getSearchSuggestions(q).suggestions.slice(0, 6),
    sourceStatus,
    items: results,
    results,
    liveSourceCount: liveBundle.documents.length,
    canonicalCount: mergedSourceData.length,
    crossLingual,
    reranking: {
      ...rerankResult.diagnostics,
      applied: sort === 'relevance' ? rerankResult.diagnostics.applied : false,
    }
  };

  emitSearchEvent(onEvent, 'results', payload);
  emitSearchEvent(onEvent, 'done', payload);
  return payload;
}

export async function searchCatalog(options = {}) {
  return executeSearchCatalog(options);
}

export async function searchCatalogStream(options = {}, onEvent = null) {
  return executeSearchCatalog(options, onEvent);
}

export async function getPaperById(id) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => item.id === id || item.canonicalId === id);
  if (!paper) return null;

  const related = (await searchCatalog({ q: paper.keywords.slice(0, 3).join(' '), sort: 'relevance', live: false })).results
    .filter((item) => item.id !== (paper.canonicalId || paper.id))
    .slice(0, 4);
  const graph = getDocumentGraph(paper.canonicalId || paper.id, appConfig.citationExpansionLimit);
  const recommendations = await buildRecommendationSet({
    paper,
    documents: sourceData,
    userProfile: null,
    limit: 4,
  });

  return {
    ...paper,
    related,
    graph,
    recommendations,
    explanation: describeGraphInsights(paper, graph, recommendations),
    metrics: {
      citations: paper.citations,
      references: 18 + (paper.keywords?.length || 0) * 3,
      insightScore: Math.min(97, 70 + (paper.keywords?.length || 0) * 3),
      freshness: paper.year >= 2024 ? '최신 연구' : '안정화 연구',
      alternateSourceCount: (paper.alternateSources || []).length
    }
  };}

export async function expandPaperById(id) {
  const paper = await getPaperById(id);
  if (!paper) return null;
  const citations = await getCitationsById(id, appConfig.citationExpansionLimit);
  const references = await getReferencesById(id, appConfig.citationExpansionLimit);
  const recommendations = await getRecommendationsById(id, 6, null);

  return {
    paper,
    expansion: {
      suggestedQueries: unique([
        ...(paper.keywords || []).slice(0, 3),
        `${paper.keywords?.[0] || paper.title} 선행연구`,
        `${paper.organization || paper.sourceLabel} 연구 동향`
      ]).slice(0, 6),
      citationPreview: (paper.related || []).map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        year: item.year
      })),
      recommendations,
      graphNarrative: describeGraphInsights(paper, paper.graph || {}, recommendations),
      comparisonMatrix: buildComparisonMatrix(paper, recommendations, citations, references),
      graph: getDocumentGraph(paper.canonicalId || paper.id, appConfig.citationExpansionLimit),
      sourceStatus: listSourceStatuses().filter((item) => [paper.source, ...(paper.alternateSources || [])].includes(item.source)),
      alternateSources: paper.alternateSources || [paper.source]
    }
  };
}

export async function getRecommendationsById(id, limit = 5, userProfile = null) {
  const paper = await getPaperById(id);
  if (!paper) return [];
  const sourceData = await buildSearchIndexDocuments();
  return buildRecommendationSet({
    paper,
    documents: sourceData,
    userProfile,
    limit,
  });
}

export async function getPersonalizedRecommendations({
  userProfile = null,
  libraryItems = [],
  limit = 8
} = {}) {
  const sourceData = await buildSearchIndexDocuments();
  const libraryIds = new Set((libraryItems || []).map((item) => item.canonicalId).filter(Boolean));
  const aggregated = new Map();

  for (const item of (libraryItems || []).slice(0, 5)) {
    const paper = sourceData.find((candidate) => (candidate.canonicalId || candidate.id) === item.canonicalId);
    if (!paper) continue;
    const recommendations = await buildRecommendationSet({
      paper,
      documents: sourceData,
      userProfile,
      limit: Math.max(limit, 6),
    });
    for (const recommendation of recommendations) {
      const key = recommendation.canonicalId || recommendation.id;
      if (!key || libraryIds.has(key)) continue;
      const current = aggregated.get(key) || {
        ...recommendation,
        explanation: [],
        recommendationScore: 0
      };
      current.recommendationScore += Number(recommendation.recommendationScore || 0);
      current.explanation = unique([...(current.explanation || []), ...(recommendation.explanation || [])]);
      aggregated.set(key, current);
    }
  }

  const interestTerms = unique(tokenize((userProfile?.researchInterests || []).join(' ')));
  for (const candidate of sourceData) {
    const candidateId = candidate.canonicalId || candidate.id;
    if (!candidateId || libraryIds.has(candidateId)) continue;
    const interestOverlap = interestTerms.filter((term) =>
      [candidate.title, candidate.summary, ...(candidate.keywords || [])].join(' ').toLowerCase().includes(term)
    );
    if (!interestOverlap.length && aggregated.has(candidateId)) continue;
    const current = aggregated.get(candidateId) || {
      ...candidate,
      explanation: [],
      recommendationScore: 0
    };
    current.recommendationScore +=
      interestOverlap.length * 9 +
      (userProfile?.preferredSources?.includes(candidate.source) ? 6 : 0) +
      (userProfile?.defaultRegion && userProfile.defaultRegion === candidate.region ? 4 : 0) +
      Math.max(0, (candidate.year || 2020) - 2020) * 0.8;
    if (interestOverlap.length) {
      current.explanation = unique([...(current.explanation || []), `관심사 기반 추천: ${interestOverlap.slice(0, 3).join(', ')}`]);
    }
    aggregated.set(candidateId, current);
  }

  const fallback = sourceData
    .filter((candidate) => !libraryIds.has(candidate.canonicalId || candidate.id))
    .slice(0, limit)
    .map((candidate) => ({
      ...candidate,
      recommendationScore:
        (userProfile?.preferredSources?.includes(candidate.source) ? 12 : 0) +
        Math.max(0, (candidate.year || 2020) - 2020),
      explanation: ['기본 추천 피드'],
    }));

  const items = (aggregated.size ? [...aggregated.values()] : fallback)
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit)
    .map((item, index) => ({
      ...normalizeSearchResult(attachVectors(item, appConfig.vectorDimensions), index + 1, {
        lexicalScore: 0,
        denseScore: 0,
        sparseScore: 0,
        total: Number(item.recommendationScore || 0)
      }),
      recommendationScore: Number((item.recommendationScore || 0).toFixed(2)),
      explanation: item.explanation || []
    }));

  return {
    total: items.length,
    summary: items.length
      ? '관심 분야와 저장한 문헌을 바탕으로 다음에 읽을 자료를 추천했습니다.'
      : '개인화 추천을 생성하려면 관심 분야나 라이브러리 항목을 추가해 주세요.',
    items
  };
}

export async function getCitationsById(id, limit = appConfig.citationExpansionLimit) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => (item.canonicalId || item.id) === id);
  if (!paper) return [];
  const graph = getDocumentGraph(id, limit);
  const direct = graph.citations
    .map((edge) => sourceData.find((item) => (item.canonicalId || item.id) === edge.sourceId))
    .filter(Boolean);
  if (direct.length >= limit) return direct.slice(0, limit);
  const fallback = sourceData
    .filter((candidate) => (candidate.canonicalId || candidate.id) !== id)
    .filter((candidate) => (candidate.year || 0) >= (paper.year || 0))
    .filter((candidate) => candidateMatchesPaper(paper, candidate))
    .sort((a, b) => (b.citations || 0) - (a.citations || 0))
    .slice(0, limit - direct.length);
  return uniqueById([...direct, ...fallback]).slice(0, limit);
}

export async function getReferencesById(id, limit = appConfig.citationExpansionLimit) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => (item.canonicalId || item.id) === id);
  if (!paper) return [];
  const graph = getDocumentGraph(id, limit);
  const direct = graph.references
    .map((edge) => sourceData.find((item) => (item.canonicalId || item.id) === edge.targetId))
    .filter(Boolean);
  if (direct.length >= limit) return direct.slice(0, limit);
  const fallback = sourceData
    .filter((candidate) => (candidate.canonicalId || candidate.id) !== id)
    .filter((candidate) => (candidate.year || 0) <= (paper.year || Number.MAX_SAFE_INTEGER))
    .filter((candidate) => candidateMatchesPaper(paper, candidate))
    .sort((a, b) => (b.citations || 0) - (a.citations || 0))
    .slice(0, limit - direct.length);
  return uniqueById([...direct, ...fallback]).slice(0, limit);
}
