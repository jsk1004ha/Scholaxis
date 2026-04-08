import { seedCatalog, trendingTopics } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { persistDocuments, persistGraphEdges, persistSearchRun } from './storage.mjs';
import { getSearchIndexDiagnostics, loadSearchIndexDocuments } from './document-index-service.mjs';
import { getDocumentGraph, syncDocumentGraph, traceDocumentGraph } from './graph-service.mjs';
import { syncDocumentsToPostgres } from './postgres-store.mjs';
import { buildRecommendationSet } from './recommendation-service.mjs';
import { rerankSearchEntries } from './reranker-service.mjs';
import { expandSemanticLexiconTerms } from './semantic-lexicon.mjs';
import { searchLiveSources, sourceRegistrySummary } from './source-adapters.mjs';
import { buildCrossLingualQueryContext, classifyQueryProfile, expandQueryVariants, mergeSourceStatuses } from './source-helpers.mjs';
import {
  averageDocumentLength,
  bm25Score,
  buildDocumentFrequency,
  buildDocumentPassages,
  buildSparseVector,
  buildTermFrequency,
  cosineSimilarity,
  coverageRatio,
  normalizeText,
  sparseOverlapScore,
  tokenize,
  unique
} from './vector-service.mjs';
import { embedText } from './embedding-service.mjs';
import { searchVectorCandidates, syncDocumentVectors } from './vector-index-service.mjs';

const regionLabel = { all: '전체', domestic: '국내', global: '해외' };
const sourceTypeLabel = { all: '전체', paper: '논문', thesis: '학위논문', patent: '특허', report: '보고서', fair_entry: '전람회/발명품' };
const SEARCH_STOPWORDS = new Set([
  '연구','분석','시스템','모델','기반','설계','예측','요약','문서','검색','자료','평가','결과',
  'analysis','research','system','model','based','design','prediction','summary','document','search','data','evaluation','results'
]);
const GLOBAL_SOURCES = new Set(['semantic_scholar', 'arxiv']);
const DOMESTIC_SOURCES = new Set(['riss', 'kci', 'scienceon', 'dbpia', 'ntis', 'kipris', 'science_fair', 'student_invention_fair']);
const HEURISTIC_EMBEDDING_PROVIDERS = new Set(['hash-projection', 'heuristic-hash', 'local-hash-projection', 'local-semantic-projection']);
let lastSynchronizedIndexKey = '';

function classifySourceType(type) {
  if (['paper', 'thesis', 'patent', 'report', 'fair_entry'].includes(type)) return type;
  return 'paper';
}

function buildQueryTokens(query = '') {
  const base = unique(tokenize(query));
  const semantic = expandSemanticLexiconTerms(base);
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

  return unique([...base, ...semantic, ...variants, ...koreanChunks]).filter((token) => token.length >= 2);
}

function hasReliableSemanticEmbedding(document = {}) {
  return !HEURISTIC_EMBEDDING_PROVIDERS.has(String(document.embeddingProvider || '').toLowerCase());
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
  const compactQuery = normalizeText(query).replace(/\s+/g, '');
  const queryLooksKorean = /[가-힣]/.test(query);
  const queryLooksLatin = /[A-Za-z]/.test(query);
  const documentLanguage = String(document.language || '').toLowerCase();
  const crossLingualTarget =
    (queryLooksKorean && documentLanguage.startsWith('en')) ||
    (queryLooksLatin && documentLanguage.startsWith('ko'));
  if (normalizedQuery && (normalizedTitle.includes(normalizedQuery) || normalizedEnglishTitle.includes(normalizedQuery))) return true;
  if (compactQuery && normalizedBody.replace(/\s+/g, '').includes(compactQuery)) return true;
  const exactTermMatches = queryTerms.filter((token) => normalizedBody.includes(token));
  if (queryTerms.length >= 2) {
    return exactTermMatches.length >= Math.min(2, queryTerms.length);
  }
  if (queryTerms.length === 1 && exactTermMatches.length >= 1) return true;
  if (hasReliableSemanticEmbedding(document) && scoreBundle.denseScore >= 0.58) return true;
  if (crossLingualTarget && hasReliableSemanticEmbedding(document) && scoreBundle.denseScore >= 0.34) return true;
  if ((scoreBundle.rerankScore || 0) >= 0.62 && scoreBundle.denseScore >= 0.28) return true;
  if (rawQueryTermCount >= 2) return false;
  if (queryTokens.some((token) => normalizedBody.includes(token))) return true;
  return (
    scoreBundle.lexicalScore >= 8 ||
    scoreBundle.sparseScore >= 0.14 ||
    scoreBundle.bm25Score >= 0.4 ||
    (hasReliableSemanticEmbedding(document) && scoreBundle.denseScore >= 0.44)
  );
}

function buildCorpusStats(documents = []) {
  const termFrequencyMaps = documents.map((document) => buildTermFrequency(document.searchText || ''));
  return {
    termFrequencyMaps,
    documentFrequencyMap: buildDocumentFrequency(termFrequencyMaps),
    averageLength: averageDocumentLength(termFrequencyMaps),
    totalDocuments: documents.length || 1
  };
}

function scoreDocument(document, queryTokens, queryTerms, queryVector, querySparse, corpusStats = null) {
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
  const normalizedQuery = normalizeText(queryTerms.join(' '));

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

  const titleCoverage = coverageRatio(queryTerms, [document.title, document.englishTitle].filter(Boolean).join(' '));
  const abstractCoverage = coverageRatio(queryTerms, [document.abstract, document.summary].filter(Boolean).join(' '));
  const exactTitleBoost = normalizedQuery && normalizeText([document.title, document.englishTitle].join(' ')).includes(normalizedQuery) ? 18 : 0;
  lexicalScore += titleCoverage * 18 + abstractCoverage * 8 + exactTitleBoost;

  const denseScore = cosineSimilarity(queryVector, document.semanticVector || document.vector || []);
  const sparseScore = sparseOverlapScore(querySparse, document.sparseVector || {});
  const termFrequencyMap = buildTermFrequency(document.searchText || lexicalText);
  const bm25 = corpusStats
    ? bm25Score(queryTerms, termFrequencyMap, corpusStats.documentFrequencyMap, corpusStats.totalDocuments, corpusStats.averageLength)
    : 0;
  const domesticBias = 0;
  const sourcePriority = 0;
  const citationScore = Math.min((document.citations || 0) / 500, 0.12);
  const recencyScore = document.year ? Math.max(0, (document.year - 2018) * 0.01) : 0;
  const denseWeight = hasReliableSemanticEmbedding(document) ? 24 : 9;

  return {
    lexicalScore,
    denseScore,
    sparseScore,
    bm25Score: bm25,
    total:
      lexicalScore * 0.5 +
      denseScore * denseWeight +
      sparseScore * 10 +
      bm25 * 18 +
      domesticBias * 100 +
      sourcePriority * 100 +
      citationScore * 100 +
      recencyScore * 100
  };
}

async function boostWithPassageMatches(entries = [], queryVector = [], limit = 24) {
  const head = entries
    .slice()
    .sort((a, b) => b.scoreBundle.total - a.scoreBundle.total)
    .slice(0, Math.max(6, limit));

  const boostedHead = await Promise.all(
    head.map(async (entry) => {
      const passages = buildDocumentPassages(entry.item);
      if (!passages.length) return entry;
      let bestScore = 0;
      let bestLabel = '';
      for (const passage of passages) {
        const passageVector = await embedText(`${entry.item.title || ''}\n${passage.text}`);
        const score = cosineSimilarity(queryVector, passageVector);
        if (score > bestScore) {
          bestScore = score;
          bestLabel = passage.label;
        }
      }

      const fieldBonus =
        bestLabel === 'title' ? 0.16 :
        bestLabel === 'abstract' ? 0.1 :
        bestLabel === 'summary' ? 0.06 :
        0.03;

      return {
        ...entry,
        scoreBundle: {
          ...entry.scoreBundle,
          passageDenseScore: Number(bestScore.toFixed(4)),
          passageLabel: bestLabel,
          total: entry.scoreBundle.total + (bestScore + fieldBonus) * 16
        }
      };
    })
  );

  const boostedById = new Map(boostedHead.map((entry) => [entry.item.canonicalId || entry.item.id, entry]));
  return entries.map((entry) => boostedById.get(entry.item.canonicalId || entry.item.id) || entry);
}


function applyQueryProfileBoost(item, scoreBundle, queryProfile = null) {
  if (!queryProfile) return { item, scoreBundle };
  const requestedTypes = queryProfile.requestedTypes || [];
  const sourceHints = queryProfile.sourceHints || [];
  const itemType = classifySourceType(item.type);
  let total = scoreBundle.total;

  if (requestedTypes.length && !requestedTypes.includes('paper')) {
    if (requestedTypes.includes(itemType)) total += 18;
    else total -= 10;
  }

  if (sourceHints.includes(item.source)) total += 10;
  if (requestedTypes.includes('fair_entry') && itemType !== 'fair_entry') total -= 8;
  if (requestedTypes.includes('patent') && itemType !== 'patent') total -= 6;
  if (requestedTypes.includes('report') && itemType !== 'report') total -= 6;

  return {
    item,
    scoreBundle: {
      ...scoreBundle,
      total,
      profileBoost: Number((total - scoreBundle.total).toFixed(2))
    }
  };
}

function applyPreferredSourceBoost(item, scoreBundle, preferredSources = []) {
  const requestedSources = unique((preferredSources || []).map((source) => String(source || '').trim()).filter(Boolean));
  if (!requestedSources.length) return { item, scoreBundle };

  const availableSources = new Set([item.source, ...(item.alternateSources || [])].filter(Boolean));
  const matched = requestedSources.some((source) => availableSources.has(source));
  const sourceBoost = matched ? 18 : -6;

  return {
    item,
    scoreBundle: {
      ...scoreBundle,
      total: scoreBundle.total + sourceBoost,
      preferredSourceBoost: sourceBoost
    }
  };
}

function sanitizeDocumentForDetail(document = {}) {
  if (!document) return document;
  return {
    id: document.canonicalId || document.id,
    canonicalId: document.canonicalId || document.id,
    type: classifySourceType(document.type),
    source: document.sourceLabel || document.source,
    sourceKey: document.source,
    title: document.title,
    englishTitle: document.englishTitle,
    authors: document.authors || [],
    organization: document.organization || '',
    year: document.year || null,
    citations: document.citations || 0,
    openAccess: Boolean(document.openAccess),
    region: document.region || 'all',
    language: document.language || '',
    summary: document.summary || '',
    abstract: document.abstract || '',
    novelty: document.novelty || '',
    keywords: document.keywords || [],
    methods: document.methods || [],
    highlights: document.highlights || [],
    alternateSources: document.alternateSources || [document.source],
    links: document.links || {},
  };
}

function sanitizeGraphTraversal(graphTraversal = {}) {
  return {
    paths: graphTraversal.paths || [],
    nodes: graphTraversal.nodes || []
  };
}

function summarizeFilters({ region, sourceType, sort }) {
  return `${regionLabel[region] || '전체'} · ${sourceTypeLabel[sourceType] || '전체'} · ${sort === 'latest' ? '최신순' : sort === 'citation' ? '인용순' : '관련도순'}`;
}

function buildFallbackQueries(query = '', crossLingual = null) {
  const normalized = normalizeText(query);
  const tokens = unique(tokenize(query));
  const informative = tokens.filter((token) => !SEARCH_STOPWORDS.has(token));
  const longest = [...informative].sort((a, b) => b.length - a.length).slice(0, 3);
  const variants = [
    normalized,
    normalized.replace(/\s+/g, ''),
    informative.join(' '),
    informative.slice(0, 2).join(' '),
    longest.join(' '),
    crossLingual?.translatedQuery || '',
    ...expandSemanticLexiconTerms(informative).slice(0, 6),
  ].filter(Boolean);

  if (informative.length >= 3) {
    for (let index = 0; index <= informative.length - 2; index += 1) {
      variants.push(informative.slice(index, index + 2).join(' '));
    }
  }

  return unique(variants)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== query.trim());
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

function rankSourcesByProfile(preferredSources = [], profile = null, direction = 'none') {
  const selected = preferredSources.length ? preferredSources : [...GLOBAL_SOURCES, ...DOMESTIC_SOURCES];
  const scored = selected.map((source) => {
    let score = 0;
    if (profile?.sourceHints?.includes(source)) score += 8;
    if (profile?.requestedTypes?.includes('patent') && source === 'kipris') score += 6;
    if (profile?.requestedTypes?.includes('report') && ['ntis', 'rne_report'].includes(source)) score += 6;
    if (profile?.requestedTypes?.includes('fair_entry') && ['science_fair', 'student_invention_fair', 'rne_report'].includes(source)) score += 6;
    if (direction === 'ko-to-en' && GLOBAL_SOURCES.has(source)) score += 4;
    if (direction === 'en-to-ko' && DOMESTIC_SOURCES.has(source)) score += 4;
    if (profile?.domains?.includes('humanities') && ['riss', 'kci', 'dbpia'].includes(source)) score += 5;
    if (profile?.domains?.includes('education') && ['riss', 'kci', 'dbpia'].includes(source)) score += 5;
    if (profile?.domains?.includes('earth_space') && ['semantic_scholar', 'arxiv', 'scienceon', 'ntis'].includes(source)) score += 4;
    if (profile?.domains?.includes('engineering') && ['arxiv', 'semantic_scholar', 'kci', 'dbpia', 'kipris'].includes(source)) score += 4;
    return { source, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((item) => item.source);
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
  const denseSimilarity = cosineSimilarity(
    paper.semanticVector || paper.vector || [],
    candidate.semanticVector || candidate.vector || []
  );
  return [...paperTokens].some((token) => candidateTokens.has(token)) || denseSimilarity >= 0.32;
}

async function rankExploratoryCandidates({
  query = '',
  documents = [],
  region = 'all',
  sourceType = 'all',
  limit = 6
} = {}) {
  const queryTokens = buildQueryTokens(query);
  const queryTerms = unique(tokenize(query)).filter((token) => !SEARCH_STOPWORDS.has(token));
  const queryProfile = classifyQueryProfile(query);
  const queryVector = await embedText(query);
  const querySparse = buildSparseVector(query);
  const corpusStats = buildCorpusStats(documents);
  const ranked = documents
    .filter((item) => (region === 'all' ? true : item.region === region))
    .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
    .map((item) => applyQueryProfileBoost(item, scoreDocument(item, queryTokens, queryTerms, queryVector, querySparse, corpusStats), classifyQueryProfile(query)));

  const boosted = await rerankSearchEntries(
    ranked
      .sort((a, b) => b.scoreBundle.total - a.scoreBundle.total)
      .slice(0, Math.max(limit * 3, 12)),
    query,
    null,
    Math.max(limit, 6)
  );

  return boosted.entries
    .filter((entry) => {
      const searchableText = normalizeText([
        entry.item.title,
        entry.item.englishTitle,
        entry.item.summary,
        entry.item.abstract,
        ...(entry.item.keywords || [])
      ].filter(Boolean).join(' '));
      const termOverlap = queryTerms.filter((token) => searchableText.includes(token)).length;
      const requestedTypes = queryProfile.requestedTypes || [];
      const profileTypeMatch = requestedTypes.includes(classifySourceType(entry.item.type));
      const profileSourceMatch = (queryProfile.sourceHints || []).includes(entry.item.source);
      const directEvidence = (
        termOverlap >= 1 ||
        entry.scoreBundle.lexicalScore >= 8 ||
        entry.scoreBundle.sparseScore >= 0.14 ||
        entry.scoreBundle.bm25Score >= 0.32 ||
        (hasReliableSemanticEmbedding(entry.item) && entry.scoreBundle.denseScore >= 0.24)
      );
      if (directEvidence) return true;
      const typeDrivenFallback = requestedTypes.some((type) => type !== 'paper') && profileTypeMatch;
      const sourceDrivenFallback = requestedTypes.some((type) => type !== 'paper') && profileSourceMatch && profileTypeMatch;
      return (typeDrivenFallback || sourceDrivenFallback) && entry.scoreBundle.total >= 18;
    })
    .slice(0, limit);
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

function gradeDetailSection(count = 0, total = 1, healthyThreshold = 0.75) {
  const normalizedTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, count / normalizedTotal));
  return {
    count,
    total: normalizedTotal,
    ratio,
    status: ratio >= healthyThreshold ? 'healthy' : count > 0 ? 'degraded' : 'unavailable',
  };
}

function buildDetailSectionState({
  key,
  title,
  count = 0,
  total = 1,
  healthyThreshold = 0.75,
  healthySummary = '',
  degradedSummary = '',
  unavailableSummary = '',
}) {
  const grade = gradeDetailSection(count, total, healthyThreshold);
  return {
    key,
    title,
    count: grade.count,
    total: grade.total,
    ratio: Number((grade.ratio * 100).toFixed(0)),
    status: grade.status,
    summary:
      grade.status === 'healthy'
        ? healthySummary
        : grade.status === 'degraded'
          ? degradedSummary
          : unavailableSummary,
  };
}

function buildDetailMetadata(paper = {}) {
  const type = classifySourceType(paper.type);
  return [
    { label: '문헌 유형', value: sourceTypeLabel[type] || paper.type || '자료' },
    { label: '발행 연도', value: paper.year ? String(paper.year) : '' },
    { label: '언어', value: paper.language || '' },
    { label: '지역', value: regionLabel[paper.region] || paper.region || '' },
    { label: '기관', value: paper.organization || '' },
    { label: '저자 수', value: (paper.authors || []).length ? `${paper.authors.length}명` : '' },
    { label: '키워드', value: (paper.keywords || []).length ? `${paper.keywords.length}개` : '' },
    { label: '방법론', value: (paper.methods || []).length ? `${paper.methods.length}개` : '' },
    { label: '연결 출처', value: (paper.alternateSources || []).length ? `${paper.alternateSources.length}곳` : '' },
    { label: '오픈 액세스', value: paper.openAccess ? '가능' : '' },
  ].map((entry) => ({
    ...entry,
    status: entry.value ? 'available' : 'missing',
  }));
}

function buildDetailHealth({
  paper,
  related = [],
  citations = [],
  references = [],
  recommendations = [],
  comparisonMatrix = [],
  suggestedQueries = [],
  graph = {},
  graphPaths = [],
  sourceStatus = [],
} = {}) {
  const metadata = buildDetailMetadata(paper);
  const availableMetadata = metadata.filter((entry) => entry.status === 'available').length;
  const links = [
    {
      label: '원문 링크',
      href: paper?.links?.original || paper?.links?.detail || '',
    },
    {
      label: '출처 상세 링크',
      href: paper?.links?.detail || '',
    },
  ].map((entry) => ({
    ...entry,
    status: entry.href ? 'available' : 'missing',
  }));
  const availableLinks = links.filter((entry) => entry.status === 'available').length;

  const metadataSection = buildDetailSectionState({
    key: 'metadata',
    title: '핵심 메타데이터',
    count: availableMetadata,
    total: metadata.length,
    healthyThreshold: 0.7,
    healthySummary: '초록, 저자, 연도, 키워드 등 핵심 메타데이터가 비교적 충실합니다.',
    degradedSummary: '메타데이터 일부가 비어 있어 요약·저자·기관 정보를 함께 확인해야 합니다.',
    unavailableSummary: '기본 메타데이터가 부족해 출처 상세 페이지 확인이 필요합니다.',
  });

  const linkSection = buildDetailSectionState({
    key: 'links',
    title: '원문/상세 링크',
    count: availableLinks,
    total: links.length,
    healthyThreshold: 1,
    healthySummary: '원문과 출처 상세 링크가 모두 준비되어 바로 검증할 수 있습니다.',
    degradedSummary: '링크가 일부만 연결되어 있어 원문 또는 상세 페이지 중 한 경로만 제공됩니다.',
    unavailableSummary: '직접 열 수 있는 원문/상세 링크가 아직 없습니다.',
  });

  const relatedSection = buildDetailSectionState({
    key: 'related',
    title: '함께 읽을 자료',
    count: Math.min(related.length, 4),
    total: 4,
    healthyThreshold: 0.5,
    healthySummary: `관련 자료 ${related.length}건을 바로 이어서 탐색할 수 있습니다.`,
    degradedSummary: `관련 자료가 ${related.length}건만 있어 탐색 연결성이 제한적입니다.`,
    unavailableSummary: '함께 읽을 자료가 아직 충분히 연결되지 않았습니다.',
  });

  const recommendationSignals = [
    recommendations.length > 0,
    recommendations.length >= 2,
    comparisonMatrix.length > 0,
    suggestedQueries.length > 0,
  ].filter(Boolean).length;
  const recommendationSection = buildDetailSectionState({
    key: 'recommendations',
    title: '추천/비교 경로',
    count: recommendationSignals,
    total: 4,
    healthyThreshold: 0.75,
    healthySummary: '추천 후보, 비교 포인트, 다음 질의가 함께 제공되어 후속 탐색이 자연스럽습니다.',
    degradedSummary: '추천 후보는 있지만 비교 포인트 또는 다음 질의가 아직 충분하지 않습니다.',
    unavailableSummary: '추천 비교 경로가 아직 충분히 형성되지 않았습니다.',
  });

  const graphSignals = [
    graphPaths.length > 0,
    citations.length > 0,
    references.length > 0,
    ((graph.authorAffinity || []).length + (graph.similar || []).length + (graph.topicBridges || []).length) > 0,
  ].filter(Boolean).length;
  const graphSection = buildDetailSectionState({
    key: 'graph',
    title: '그래프/인용 확장',
    count: graphSignals,
    total: 4,
    healthyThreshold: 0.75,
    healthySummary: '그래프 경로와 인용/참고 확장이 함께 제공됩니다.',
    degradedSummary: '그래프 또는 인용/참고 확장 중 일부만 제공되어 연결성이 부분적으로 제한됩니다.',
    unavailableSummary: '그래프/인용 확장 데이터가 아직 부족합니다.',
  });

  const sourceSignals = [
    sourceStatus.length > 0,
    sourceStatus.some((item) => item.status === 'configured'),
    (paper?.alternateSources || []).length > 0,
  ].filter(Boolean).length;
  const sourceSection = buildDetailSectionState({
    key: 'sources',
    title: '출처 상태',
    count: sourceSignals,
    total: 3,
    healthyThreshold: 0.67,
    healthySummary: '연결된 출처 상태와 대체 출처를 함께 확인할 수 있습니다.',
    degradedSummary: '대체 출처 또는 출처 상태 정보가 일부만 확보되었습니다.',
    unavailableSummary: '출처 상태를 아직 계산하지 못했습니다.',
  });

  const sections = [metadataSection, linkSection, relatedSection, recommendationSection, graphSection, sourceSection];
  const averageRatio = sections.reduce((sum, section) => sum + section.ratio, 0) / sections.length;
  const status = averageRatio >= 80 && sections.every((section) => section.status === 'healthy')
    ? 'healthy'
    : averageRatio > 0
      ? 'degraded'
      : 'unavailable';
  const degradedSections = sections.filter((section) => section.status !== 'healthy');

  return {
    status,
    score: Number(averageRatio.toFixed(0)),
    summary:
      degradedSections.length === 0
        ? '상세 메타데이터, 링크, 추천, 그래프 확장이 모두 안정적으로 연결됩니다.'
        : `일부 상세 구간이 제한적입니다: ${degradedSections.map((section) => section.title).join(', ')}.`,
    warnings: degradedSections.map((section) => section.summary),
    metadata,
    links,
    linkSummary:
      availableLinks === 2
        ? '원문과 출처 상세 링크를 모두 제공합니다.'
        : availableLinks === 1
          ? '원문 또는 출처 상세 링크 중 한 경로만 제공합니다.'
          : '직접 접근 가능한 원문/상세 링크가 없습니다.',
    sections,
  };
}


function buildGraphPaths(paper, recommendations = [], citations = [], references = [], graph = {}) {
  const directPaths = [
    ...references.slice(0, 3).map((item) => ({
      hop: 1,
      relation: 'references',
      from: paper.canonicalId || paper.id,
      to: item.canonicalId || item.id,
      summary: `선행 참고로 ${item.title} 연결`,
    })),
    ...citations.slice(0, 3).map((item) => ({
      hop: 1,
      relation: 'citations',
      from: item.canonicalId || item.id,
      to: paper.canonicalId || paper.id,
      summary: `후속 인용으로 ${item.title} 연결`,
    })),
    ...recommendations.slice(0, 3).map((item) => ({
      hop: 1,
      relation: 'recommended',
      from: paper.canonicalId || paper.id,
      to: item.canonicalId || item.id,
      summary: `의미/그래프 혼합 추천으로 ${item.title} 연결`,
    }))
  ];

  const tracedPaths = (graph.pathTrace || []).slice(0, 4).map((path) => ({
    hop: 2,
    relation: `${path.firstEdgeType}:${path.secondEdgeType}`,
    from: path.from,
    via: path.via,
    to: path.to,
    summary: path.summary
  }));

  return [...directPaths, ...tracedPaths];
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
  return loadSearchIndexDocuments({ liveDocuments });
}

function buildSynchronizationKey(documents = []) {
  return documents
    .map((document) => `${document.canonicalId || document.id}:${document.updatedAt || ''}`)
    .sort()
    .join('|');
}

async function synchronizeIndexedArtifacts(documents = []) {
  const key = buildSynchronizationKey(documents);
  if (key && key === lastSynchronizedIndexKey) {
    return { synchronized: false, reason: 'unchanged-index' };
  }

  persistDocuments(documents);
  await syncDocumentGraph(documents);
  await syncDocumentVectors(documents);
  await syncDocumentsToPostgres(documents);
  lastSynchronizedIndexKey = key;
  return { synchronized: true };
}

export async function warmSearchIndex() {
  const documents = await buildSearchIndexDocuments();
  const sync = await synchronizeIndexedArtifacts(documents);
  return {
    documents: documents.length,
    sync,
    cache: getSearchIndexDiagnostics(),
  };
}

function normalizeSearchResult(document, rank, scoreBundle) {
  return {
    id: document.canonicalId || document.id,
    rank,
    score: Number(scoreBundle.total.toFixed(2)),
    lexicalScore: Number(scoreBundle.lexicalScore.toFixed(2)),
    denseScore: Number(scoreBundle.denseScore.toFixed(4)),
    sparseScore: Number(scoreBundle.sparseScore.toFixed(4)),
    bm25Score: Number((scoreBundle.bm25Score || 0).toFixed(4)),
    passageDenseScore: Number((scoreBundle.passageDenseScore || 0).toFixed(4)),
    passageLabel: scoreBundle.passageLabel || '',
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
  const queryProfile = classifyQueryProfile(q);
  const retrievalQuery = unique([q, crossLingual.translatedQuery].filter(Boolean)).join(' ').trim() || q;
  const queryTokens = buildQueryTokens(retrievalQuery);
  const queryTerms = unique(tokenize(retrievalQuery)).filter((token) => !SEARCH_STOPWORDS.has(token));
  const rawQueryTermCount = unique(tokenize(retrievalQuery)).length;
  const queryVector = await embedText(retrievalQuery);
  const querySparse = buildSparseVector(retrievalQuery);
  const shouldAutoLive = Boolean(q.trim()) && autoLive && !live;
  const filters = {
    region,
    sourceType,
    sort,
    preferredSources,
    crossLingual: crossLingual.enabled,
    crossLingualBackend: crossLingual.backend,
    queryProfile,
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
    const corpusStats = buildCorpusStats(documents);
    return documents
      .filter((item) => (region === 'all' ? true : item.region === region))
      .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
      .map((item) => {
        const boosted = applyQueryProfileBoost(
          item,
          scoreDocument(item, queryTokens, queryTerms, queryVector, querySparse, corpusStats),
          queryProfile
        );
        return applyPreferredSourceBoost(boosted.item, boosted.scoreBundle, preferredSources);
      });
  }

  async function attachVectorBoost(entries = []) {
    const documents = entries.map((entry) => entry.item);
    const vectorHits = await searchVectorCandidates({
      query: retrievalQuery,
      queryVector,
      documents,
      limit: appConfig.recommendationCandidateLimit,
    });
    const vectorHitScores = new Map(vectorHits.map((entry) => [entry.id, entry.score]));
    const vectorBoostWeight = documents.some((document) => hasReliableSemanticEmbedding(document)) ? 10 : 2.5;
    return entries
      .map(({ item, scoreBundle }) => ({
        item,
        scoreBundle: {
          ...scoreBundle,
          total: scoreBundle.total + (vectorHitScores.get(item.canonicalId || item.id) || 0) * vectorBoostWeight,
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
    const routedSources = rankSourcesByProfile(preferredSources, queryProfile, crossLingual.direction);
    const sourceSplit = splitSourcesForCrossLingual(routedSources, crossLingual.direction);
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

  let reformulationsTried = [];
  if (!rankedEntries.length) {
    const fallbackQueries = buildFallbackQueries(q, crossLingual);
    for (const fallbackQuery of fallbackQueries.slice(0, 6)) {
      reformulationsTried.push(fallbackQuery);
      const fallbackTokens = buildQueryTokens(fallbackQuery);
      const fallbackTerms = unique(tokenize(fallbackQuery)).filter((token) => !SEARCH_STOPWORDS.has(token));
      const fallbackVector = await embedText(fallbackQuery);
      const fallbackSparse = buildSparseVector(fallbackQuery);

      function rankFallbackDocuments(documents = []) {
        const corpusStats = buildCorpusStats(documents);
        return documents
          .filter((item) => (region === 'all' ? true : item.region === region))
          .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
          .map((item) => {
            const boosted = applyQueryProfileBoost(
              item,
              scoreDocument(item, fallbackTokens, fallbackTerms, fallbackVector, fallbackSparse, corpusStats),
              queryProfile
            );
            return applyPreferredSourceBoost(boosted.item, boosted.scoreBundle, preferredSources);
          });
      }

      const localFallback = await attachVectorBoost(rankFallbackDocuments(mergedSourceData));
      if (localFallback.length) {
        rankedEntries = localFallback.map((entry) => ({
          ...entry,
          scoreBundle: {
            ...entry.scoreBundle,
            total: entry.scoreBundle.total + 5,
            rerankReason: `재질의 fallback: ${fallbackQuery}`
          }
        }));
        emitSearchEvent(onEvent, 'progress', {
          stage: 'fallback-local',
          query: q,
          filters,
          message: `결과가 없어 재질의 “${fallbackQuery}”로 후보를 다시 찾았습니다.`,
          reformulation: fallbackQuery
        });
        break;
      }

      if (live || shouldAutoLive) {
        const routedSources = rankSourcesByProfile(preferredSources, queryProfile, crossLingual.direction);
        const sourceSplit = splitSourcesForCrossLingual(routedSources, crossLingual.direction);
        const liveFallbackOriginal = await searchLiveSources(fallbackQuery, sourceSplit.originalSources, appConfig.maxLiveResultsPerSource, {
          forceRefresh,
          overrideEnable: shouldAutoLive || live
        });
        const liveFallbackTranslated =
          crossLingual.enabled && crossLingual.translatedQuery && sourceSplit.translatedSources.length
            ? await searchLiveSources(crossLingual.translatedQuery, sourceSplit.translatedSources, appConfig.maxLiveResultsPerSource, {
                forceRefresh,
                overrideEnable: shouldAutoLive || live
              })
            : { documents: [], statuses: [] };
        const fallbackBundle = mergeLiveBundles(liveFallbackOriginal, liveFallbackTranslated);
        if (fallbackBundle.documents.length) {
          liveBundle = mergeLiveBundles(liveBundle, fallbackBundle);
          mergedSourceData = await buildSearchIndexDocuments(liveBundle.documents);
          rankedEntries = await attachVectorBoost(rankFallbackDocuments(mergedSourceData));
          if (rankedEntries.length) {
            emitSearchEvent(onEvent, 'progress', {
              stage: 'fallback-live',
              query: q,
              filters,
              message: `재질의 “${fallbackQuery}”와 라이브 소스를 결합해 후보를 찾았습니다.`,
              reformulation: fallbackQuery,
              liveSourceCount: fallbackBundle.documents.length
            });
            break;
          }
        }
      }
    }
  }

  let fallbackMode = 'strict';
  if (!rankedEntries.length) {
    const exploratory = await rankExploratoryCandidates({
      query: retrievalQuery,
      documents: mergedSourceData,
      region,
      sourceType,
      limit: 6
    });
    if (exploratory.length) {
      rankedEntries = exploratory.map((entry) => ({
        ...entry,
        scoreBundle: {
          ...entry.scoreBundle,
          total: entry.scoreBundle.total,
          rerankReason: entry.scoreBundle.rerankReason || '직접 일치 결과 부족으로 연관 후보를 제안합니다.'
        }
      }));
      fallbackMode = 'exploratory';
      emitSearchEvent(onEvent, 'progress', {
        stage: 'fallback-exploratory',
        query: q,
        filters,
        message: '직접 일치 결과가 부족해 의미적으로 가까운 연관 후보를 제안합니다.',
      });
    }
  }

  rankedEntries = await boostWithPassageMatches(rankedEntries, queryVector, appConfig.recommendationCandidateLimit);

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
      ? fallbackMode === 'exploratory'
        ? `“${q}”의 직접 일치 결과가 부족해 ${reranked.length}건의 연관 ${sourceTypeLabel[sourceType] || '자료'}를 제안합니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`
        : `“${q}”에 대해 ${reranked.length}건의 ${sourceTypeLabel[sourceType] || '자료'}를 찾았습니다. ${summarizeFilters({ region, sourceType, sort })} 기준 결과입니다.`
      : `“${q}”와 충분히 관련된 ${sourceTypeLabel[sourceType] || '자료'}를 찾지 못했습니다. 더 구체적인 키워드나 유사 표현으로 다시 시도해 보세요.`
    : `탐색 가능한 ${reranked.length}건의 자료를 불러왔습니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`;

  const results = reranked.map(({ item, scoreBundle }, index) => ({
    ...normalizeSearchResult(item, index + 1, scoreBundle),
    rerankScore: Number((scoreBundle.rerankScore || 0).toFixed(4)),
    rerankReason: scoreBundle.rerankReason || '',
    exploratory: fallbackMode === 'exploratory',
  }));
  const sourceStatus = mergeSourceStatuses(listSourceStatuses(q), liveBundle.statuses);
  persistGraphEdges(buildGraphEdgesFromResults(results));
  void synchronizeIndexedArtifacts(mergedSourceData).catch((error) => {
    console.warn(`[search-sync] background artifact synchronization failed: ${error.message}`);
  });
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
    queryProfile,
    reformulationsTried,
    fallbackMode,
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

  await syncDocumentGraph(sourceData);
  const graphTraversal = traceDocumentGraph(paper.canonicalId || paper.id, sourceData, appConfig.citationExpansionLimit);
  const graph = graphTraversal.graph || getDocumentGraph(paper.canonicalId || paper.id, appConfig.citationExpansionLimit);
  const citations = await getCitationsById(id, appConfig.citationExpansionLimit);
  const references = await getReferencesById(id, appConfig.citationExpansionLimit);
  const recommendations = await buildRecommendationSet({
    paper,
    documents: sourceData,
    userProfile: null,
    limit: 4,
  });
  const related = uniqueById([...recommendations, ...citations, ...references])
    .filter((item) => (item.canonicalId || item.id) !== (paper.canonicalId || paper.id))
    .slice(0, 4);
  const impactScore = Math.min(99, Math.round((paper.citations || 0) * 0.35 + (references.length + citations.length) * 4 + (paper.year >= 2024 ? 10 : 0)));

  const sanitizedPaper = sanitizeDocumentForDetail(paper);
  const sanitizedRelated = related.map((item) => sanitizeDocumentForDetail(item));
  const sanitizedCitations = citations.map((item) => sanitizeDocumentForDetail(item));
  const sanitizedReferences = references.map((item) => sanitizeDocumentForDetail(item));
  const sanitizedRecommendations = recommendations.map((item) => sanitizeDocumentForDetail(item));
  const graphPaths = [
    ...graphTraversal.paths,
    ...buildGraphPaths(paper, recommendations, citations, references)
  ]
    .filter((path, index, items) =>
      index === items.findIndex((candidate) =>
        candidate.from === path.from &&
        candidate.to === path.to &&
        (candidate.via || '') === (path.via || '') &&
        String(candidate.summary || '') === String(path.summary || '')
      )
    )
    .slice(0, appConfig.citationExpansionLimit);
  const sourceStatus = listSourceStatuses().filter((item) => [paper.source, ...(paper.alternateSources || [])].includes(item.source));

  return {
    ...sanitizedPaper,
    related: sanitizedRelated,
    graph,
    citations: sanitizedCitations,
    references: sanitizedReferences,
    recommendations: sanitizedRecommendations,
    graphPaths,
    graphTraversal: sanitizeGraphTraversal(graphTraversal),
    sourceStatus,
    explanation: describeGraphInsights(paper, graph, recommendations),
    sourceLinks: {
      detail: paper.links?.detail || '',
      original: paper.links?.original || paper.links?.detail || ''
    },
    metrics: {
      citations: paper.citations || citations.length,
      references: references.length,
      impact: impactScore,
      insightScore: impactScore,
      freshness: paper.year >= 2024 ? '최신 연구' : '안정화 연구',
      velocity: paper.year >= 2024 ? '상승' : '안정',
      alternateSourceCount: (paper.alternateSources || []).length
    },
    detailHealth: buildDetailHealth({
      paper,
      related,
      citations,
      references,
      recommendations,
      graph,
      graphPaths,
      sourceStatus,
    }),
  };
}

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
      recommendations: recommendations.map((item) => sanitizeDocumentForDetail(item)),
      graphNarrative: describeGraphInsights(paper, paper.graph || {}, recommendations),
      comparisonMatrix: buildComparisonMatrix(paper, recommendations, citations, references),
      graph: getDocumentGraph(paper.canonicalId || paper.id, appConfig.citationExpansionLimit),
      sourceStatus: listSourceStatuses().filter((item) => [paper.source, ...(paper.alternateSources || [])].includes(item.source)),
      alternateSources: paper.alternateSources || [paper.source],
      detailHealth: buildDetailHealth({
        paper,
        related: paper.related || [],
        citations,
        references,
        recommendations,
        comparisonMatrix: buildComparisonMatrix(paper, recommendations, citations, references),
        suggestedQueries: unique([
          ...(paper.keywords || []).slice(0, 3),
          `${paper.keywords?.[0] || paper.title} 선행연구`,
          `${paper.organization || paper.sourceLabel} 연구 동향`
        ]).slice(0, 6),
        graph: paper.graph || {},
        graphPaths: paper.graphPaths || [],
        sourceStatus: listSourceStatuses().filter((item) => [paper.source, ...(paper.alternateSources || [])].includes(item.source)),
      }),
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
