import { getPaperById, mockSearchResponse, mockSimilarity } from './mock-data.js';

const REGION_MAP = {
  '국내,해외': 'all',
  '해외,국내': 'all',
  전체: 'all',
  all: 'all',
  국내: 'domestic',
  domestic: 'domestic',
  해외: 'global',
  global: 'global',
};

const SOURCE_TYPE_MAP = {
  '논문,특허,보고서': 'all',
  전체: 'all',
  all: 'all',
  논문: 'paper',
  paper: 'paper',
  특허: 'patent',
  patent: 'patent',
  보고서: 'report',
  report: 'report',
};

const SORT_MAP = {
  relevance: 'relevance',
  추천순: 'relevance',
  latest: 'latest',
  최신순: 'latest',
  domestic: 'relevance',
  국내우선: 'relevance',
  citation: 'citation',
  인용순: 'citation',
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function normalizeSearch(payload) {
  if (Array.isArray(payload)) return { ...mockSearchResponse, items: payload.map(toUiPaperShape) };
  if (payload?.items) return buildNormalizedSearchPayload(payload, payload.items);
  if (payload?.results) return buildNormalizedSearchPayload(payload, payload.results);
  if (payload?.data?.items) return buildNormalizedSearchPayload(payload.data, payload.data.items);
  return mockSearchResponse;
}

function normalizePaper(payload, id) {
  if (payload?.paper) return toUiPaperDetail({ ...payload.paper, id: payload.paper.id || id });
  if (payload?.data?.paper) return toUiPaperDetail({ ...payload.data.paper, id: payload.data.paper.id || id });
  return toUiPaperDetail({ ...getPaperById(id), ...(payload ?? {}), id: payload?.id || id });
}

function normalizeSimilarity(payload) {
  if (payload?.analysis) return { ...mockSimilarity, ...payload.analysis };
  if (payload?.data?.analysis) return { ...mockSimilarity, ...payload.data.analysis };
  return { ...mockSimilarity, ...(payload ?? {}) };
}

function buildFallbackSearch(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  const q = (query.q || '').toLowerCase();
  const regionFilter =
    normalizedQuery.region && normalizedQuery.region !== 'all' ? [normalizedQuery.region] : [];
  const typeFilter =
    normalizedQuery.sourceType && normalizedQuery.sourceType !== 'all' ? [normalizedQuery.sourceType] : [];

  const items = mockSearchResponse.items.filter((paper) => {
    const haystack = [paper.title, paper.subtitle, paper.summary, paper.abstract, ...(paper.tags ?? [])]
      .join(' ')
      .toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const normalizedRegion = REGION_MAP[paper.region] || paper.region;
    const normalizedType = SOURCE_TYPE_MAP[paper.sourceType] || paper.sourceType;
    const matchesRegion = regionFilter.length === 0 || regionFilter.includes(normalizedRegion);
    const matchesType = typeFilter.length === 0 || typeFilter.includes(normalizedType);
    return matchesQuery && matchesRegion && matchesType;
  });

  return {
    ...mockSearchResponse,
    query: query.q || mockSearchResponse.query,
    total: items.length,
    items,
  };
}

function buildErrorSearch(query, error) {
  const normalizedQuery = normalizeSearchQuery(query);
  return {
    ...mockSearchResponse,
    query: normalizedQuery.q || '',
    total: 0,
    items: [],
    summary: '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    error: error?.message || 'search-error',
  };
}

export async function fetchSearch(query) {
  const params = new URLSearchParams(normalizeSearchQuery(query));
  try {
    const payload = await requestJson(`/api/search?${params.toString()}`);
    return normalizeSearch(payload);
  } catch {
    return buildErrorSearch(query);
  }
}

export function normalizeSearchQuery(query = {}) {
  return {
    ...query,
    q: query.q || '',
    region: REGION_MAP[query.region] || query.region || 'all',
    sourceType: SOURCE_TYPE_MAP[query.sourceType] || query.sourceType || 'all',
    sort: SORT_MAP[query.sort] || query.sort || 'relevance',
  };
}

function humanRegion(region = '') {
  return region === 'domestic' ? '국내' : region === 'global' ? '해외' : '전체';
}

function humanType(type = '') {
  return type === 'paper' ? '논문' : type === 'patent' ? '특허' : type === 'report' ? '보고서' : type || '자료';
}

export function toUiPaperShape(item = {}) {
  return {
    ...item,
    id: item.id || item.canonicalId,
    title: item.title || '',
    subtitle: item.englishTitle || item.subtitle || '',
    authors: item.authors || [],
    affiliation: item.organization || item.affiliation || '',
    year: item.year || '',
    source: item.source || '',
    sourceType: humanType(item.type || item.sourceType),
    openAccess: Boolean(item.openAccess),
    badge: item.source || item.badge || 'Scholaxis',
    region: humanRegion(item.region),
    summary: item.summary || '',
    abstract: item.abstract || item.summary || '',
    tags: item.keywords || item.tags || [],
    insight: (item.highlights || []).join(' · ') || item.summary || '',
    matches: item.score || item.matches || 0,
    metrics: item.metrics || {
      citations: item.citations || 0,
      references: item.metrics?.references || 0,
      impact: item.score || 0,
      velocity: item.year >= new Date().getFullYear() - 1 ? '상승' : '안정',
    },
    related: (item.related || []).map((related) => (typeof related === 'string' ? related : related.id)),
  };
}

function toUiPaperDetail(item = {}) {
  const paper = toUiPaperShape(item);
  return {
    ...paper,
    source: [paper.source, paper.year].filter(Boolean).join(' · '),
    sourceUrl: item.links?.detail || item.links?.original || '',
    novelty: item.novelty || item.summary || '',
    related: (item.related || []).map((related) => toUiPaperShape(related)),
    tags: item.keywords || [],
    metrics: item.metrics || paper.metrics,
  };
}

function buildNormalizedSearchPayload(basePayload, rawItems = []) {
  const items = rawItems.map(toUiPaperShape);
  return {
    ...mockSearchResponse,
    ...basePayload,
    filters: {
      ...mockSearchResponse.filters,
      ...(basePayload.filters || {}),
      sources: (basePayload.sourceStatus || []).map((source) => source.source) || mockSearchResponse.filters.sources,
    },
    items,
  };
}

export async function fetchPaper(id) {
  try {
    const payload = await requestJson(`/api/papers/${encodeURIComponent(id)}`);
    return normalizePaper(payload, id);
  } catch {
    return getPaperById(id);
  }
}

export async function analyzeSimilarity(formData) {
  try {
    const payload = await requestJson('/api/similarity/analyze', {
      method: 'POST',
      body: formData,
    });
    return normalizeSimilarity(payload);
  } catch {
    return mockSimilarity;
  }
}

export async function fetchAdminSummary() {
  return requestJson('/api/admin/summary');
}

export async function fetchAdminOps() {
  return requestJson('/api/admin/ops');
}

export async function clearCache(payload = {}) {
  return requestJson('/api/cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchMe() {
  return requestJson('/api/auth/me');
}

export async function fetchProfile() {
  return requestJson('/api/profile');
}

export async function saveProfile(payload) {
  return requestJson('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function login(payload) {
  return requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function register(payload) {
  return requestJson('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function logout() {
  return requestJson('/api/auth/logout', { method: 'POST' });
}

export async function fetchLibrary() {
  return requestJson('/api/library');
}

export async function saveLibraryItem(payload) {
  return requestJson('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function removeLibraryItem(canonicalId) {
  return requestJson(`/api/library/${encodeURIComponent(canonicalId)}`, { method: 'DELETE' });
}

export async function fetchSavedSearches() {
  return requestJson('/api/saved-searches');
}

export async function saveSearchRequest(payload) {
  return requestJson('/api/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function removeSavedSearch(id) {
  return requestJson(`/api/saved-searches/${id}`, { method: 'DELETE' });
}
