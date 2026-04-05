import { seedCatalog, trendingTopics } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { dedupeDocuments } from './dedup-service.mjs';
import { getRecommendationsFromStorage, persistDocuments, persistGraphEdges, persistSearchRun } from './storage.mjs';
import { searchLiveSources, sourceRegistrySummary } from './source-adapters.mjs';
import { mergeSourceStatuses } from './source-helpers.mjs';
import { attachVectors, buildDenseVector, buildSparseVector, cosineSimilarity, sparseOverlapScore, tokenize, unique } from './vector-service.mjs';

const regionLabel = { all: '전체', domestic: '국내', global: '해외' };
const sourceTypeLabel = { all: '전체', paper: '논문', thesis: '학위논문', patent: '특허', report: '보고서', fair_entry: '전람회/발명품' };

function classifySourceType(type) {
  if (['paper', 'thesis', 'patent', 'report', 'fair_entry'].includes(type)) return type;
  return 'paper';
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
  forceRefresh = false
} = {}) {
  const queryTokens = unique(tokenize(q));
  const queryVector = buildDenseVector(q, appConfig.vectorDimensions);
  const querySparse = buildSparseVector(q);

  const liveBundle = live ? await searchLiveSources(q, preferredSources, appConfig.maxLiveResultsPerSource, { forceRefresh }) : { documents: [], statuses: [] };
  const mergedSourceData = dedupeDocuments([...seedCatalog, ...liveBundle.documents]).map((document) =>
    attachVectors(document, appConfig.vectorDimensions)
  );

  const filtered = mergedSourceData
    .filter((item) => (region === 'all' ? true : item.region === region))
    .filter((item) => (sourceType === 'all' ? true : classifySourceType(item.type) === sourceType))
    .map((item) => ({ item, scoreBundle: scoreDocument(item, queryTokens, queryVector, querySparse) }));

  const ranked = [...filtered].sort((a, b) => {
    if (sort === 'latest') return (b.item.year || 0) - (a.item.year || 0) || b.scoreBundle.total - a.scoreBundle.total;
    if (sort === 'citation') return (b.item.citations || 0) - (a.item.citations || 0) || b.scoreBundle.total - a.scoreBundle.total;
    return b.scoreBundle.total - a.scoreBundle.total || (b.item.year || 0) - (a.item.year || 0);
  });

  const summary = q
    ? `“${q}”에 대해 ${ranked.length}건의 ${sourceTypeLabel[sourceType] || '자료'}를 찾았습니다. ${summarizeFilters({ region, sourceType, sort })} 기준 결과입니다.`
    : `탐색 가능한 ${ranked.length}건의 자료를 불러왔습니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`;

  const results = ranked.map(({ item, scoreBundle }, index) => normalizeSearchResult(item, index + 1, scoreBundle));
  const sourceStatus = mergeSourceStatuses(listSourceStatuses(q), liveBundle.statuses);
  persistDocuments(mergedSourceData);
  persistGraphEdges(buildGraphEdgesFromResults(results));
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
  const sourceData = dedupeDocuments(seedCatalog).map((document) => attachVectors(document, appConfig.vectorDimensions));
  const paper = sourceData.find((item) => item.id === id || item.canonicalId === id);
  if (!paper) return null;

  const related = (await searchCatalog({ q: paper.keywords.slice(0, 3).join(' '), sort: 'relevance', live: false })).results
    .filter((item) => item.id !== (paper.canonicalId || paper.id))
    .slice(0, 4);

  return {
    ...paper,
    related,
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
      sourceStatus: listSourceStatuses().filter((item) => [paper.source, ...(paper.alternateSources || [])].includes(item.source)),
      alternateSources: paper.alternateSources || [paper.source]
    }
  };
}

export async function getRecommendationsById(id, limit = 5) {
  const paper = await getPaperById(id);
  if (!paper) return [];
  const edges = getRecommendationsFromStorage(paper.canonicalId || paper.id, limit);
  if (!edges.length) return (paper.related || []).slice(0, limit);
  const sourceData = dedupeDocuments(seedCatalog).map((document) => attachVectors(document, appConfig.vectorDimensions));
  return edges.map((edge) => sourceData.find((item) => (item.canonicalId || item.id) === edge.targetId)).filter(Boolean);
}
