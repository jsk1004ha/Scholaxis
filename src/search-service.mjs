import { seedCatalog, trendingTopics } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { dedupeDocuments } from './dedup-service.mjs';
import { getStoredDocuments, persistDocuments, persistGraphEdges, persistSearchRun } from './storage.mjs';
import { getDocumentGraph, syncDocumentGraph } from './graph-service.mjs';
import { loadDocumentsFromPostgres, syncDocumentsToPostgres } from './postgres-store.mjs';
import { buildRecommendationSet } from './recommendation-service.mjs';
import { searchLiveSources, sourceRegistrySummary } from './source-adapters.mjs';
import { expandQueryVariants, mergeSourceStatuses } from './source-helpers.mjs';
import { attachVectors, buildDenseVector, buildSparseVector, cosineSimilarity, normalizeText, sparseOverlapScore, tokenize, unique } from './vector-service.mjs';
import { searchVectorCandidates, syncDocumentVectors } from './vector-index-service.mjs';

const regionLabel = { all: '전체', domestic: '국내', global: '해외' };
const sourceTypeLabel = { all: '전체', paper: '논문', thesis: '학위논문', patent: '특허', report: '보고서', fair_entry: '전람회/발명품' };
const SEARCH_STOPWORDS = new Set([
  '연구','분석','시스템','모델','기반','설계','예측','요약','문서','검색','자료','평가','결과',
  'analysis','research','system','model','based','design','prediction','summary','document','search','data','evaluation','results'
]);

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

export async function searchCatalog({
  q = '',
  region = 'all',
  sourceType = 'all',
  sort = 'relevance',
  preferredSources = [],
  live = appConfig.enableLiveSources,
  forceRefresh = false,
  autoLive = appConfig.autoLiveOnEmpty
} = {}) {
  const queryTokens = buildQueryTokens(q);
  const queryTerms = unique(tokenize(q)).filter((token) => !SEARCH_STOPWORDS.has(token));
  const rawQueryTermCount = unique(tokenize(q)).length;
  const queryVector = buildDenseVector(q, appConfig.vectorDimensions);
  const querySparse = buildSparseVector(q);
  const shouldAutoLive = Boolean(q.trim()) && autoLive && !live;

  function rankDocuments(documents = []) {
    return documents
      .filter((item) => (region === 'all' ? true : item.region === region))
      .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
      .map((item) => ({ item, scoreBundle: scoreDocument(item, queryTokens, queryVector, querySparse) }));
  }

  async function attachVectorBoost(entries = []) {
    const documents = entries.map((entry) => entry.item);
    const vectorHits = await searchVectorCandidates({
      query: q,
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
      .filter(({ item, scoreBundle }) => hasQueryEvidence(scoreBundle, queryTokens, queryTerms, rawQueryTermCount, item, q));
  }

  let liveBundle = { documents: [], statuses: [] };
  let mergedSourceData = await buildSearchIndexDocuments();
  let rankedEntries = await attachVectorBoost(rankDocuments(mergedSourceData));

  if ((live || shouldAutoLive) && (!rankedEntries.length || live)) {
    liveBundle = await searchLiveSources(q, preferredSources, appConfig.maxLiveResultsPerSource, {
      forceRefresh,
      overrideEnable: shouldAutoLive || live
    });
    mergedSourceData = await buildSearchIndexDocuments(liveBundle.documents);
    rankedEntries = await attachVectorBoost(rankDocuments(mergedSourceData));
  }

  const ranked = [...rankedEntries].sort((a, b) => {
    if (sort === 'latest') return (b.item.year || 0) - (a.item.year || 0) || b.scoreBundle.total - a.scoreBundle.total;
    if (sort === 'citation') return (b.item.citations || 0) - (a.item.citations || 0) || b.scoreBundle.total - a.scoreBundle.total;
    return b.scoreBundle.total - a.scoreBundle.total || (b.item.year || 0) - (a.item.year || 0);
  });

  const summary = q
    ? ranked.length
      ? `“${q}”에 대해 ${ranked.length}건의 ${sourceTypeLabel[sourceType] || '자료'}를 찾았습니다. ${summarizeFilters({ region, sourceType, sort })} 기준 결과입니다.`
      : `“${q}”와 충분히 관련된 ${sourceTypeLabel[sourceType] || '자료'}를 찾지 못했습니다. 더 구체적인 키워드나 유사 표현으로 다시 시도해 보세요.`
    : `탐색 가능한 ${ranked.length}건의 자료를 불러왔습니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`;

  const results = ranked.map(({ item, scoreBundle }, index) => normalizeSearchResult(item, index + 1, scoreBundle));
  const sourceStatus = mergeSourceStatuses(listSourceStatuses(q), liveBundle.statuses);
  persistDocuments(mergedSourceData);
  persistGraphEdges(buildGraphEdgesFromResults(results));
  await syncDocumentGraph(mergedSourceData);
  await syncDocumentVectors(mergedSourceData);
  await syncDocumentsToPostgres(mergedSourceData);
  persistSearchRun({ query: q, filters: { region, sourceType, sort, preferredSources }, total: ranked.length, liveSourceCount: liveBundle.documents.length, canonicalCount: mergedSourceData.length });

  return {
    query: q,
    filters: { region, sourceType, sort, preferredSources },
    summary,
    total: ranked.length,
    relatedQueries: getSearchSuggestions(q).suggestions.slice(0, 6),
    sourceStatus,
    items: results,
    results,
    liveSourceCount: liveBundle.documents.length,
    canonicalCount: mergedSourceData.length
  };
}

export async function getPaperById(id) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => item.id === id || item.canonicalId === id);
  if (!paper) return null;

  const related = (await searchCatalog({ q: paper.keywords.slice(0, 3).join(' '), sort: 'relevance', live: false })).results
    .filter((item) => item.id !== (paper.canonicalId || paper.id))
    .slice(0, 4);

  return {
    ...paper,
    related,
    graph: getDocumentGraph(paper.canonicalId || paper.id, appConfig.citationExpansionLimit),
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

export async function getCitationsById(id, limit = appConfig.citationExpansionLimit) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => (item.canonicalId || item.id) === id);
  if (!paper) return [];
  const graph = getDocumentGraph(id, limit);
  return graph.citations
    .map((edge) => sourceData.find((item) => (item.canonicalId || item.id) === edge.sourceId))
    .filter(Boolean);
}

export async function getReferencesById(id, limit = appConfig.citationExpansionLimit) {
  const sourceData = await buildSearchIndexDocuments();
  const paper = sourceData.find((item) => (item.canonicalId || item.id) === id);
  if (!paper) return [];
  const graph = getDocumentGraph(id, limit);
  return graph.references
    .map((edge) => sourceData.find((item) => (item.canonicalId || item.id) === edge.targetId))
    .filter(Boolean);
}
