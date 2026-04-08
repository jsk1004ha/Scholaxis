const EMPTY_SEARCH_RESPONSE = {
  query: '',
  total: 0,
  summary: '',
  relatedQueries: [],
  filters: {
    regions: ['전체'],
    sourceTypes: ['전체'],
    sources: [],
  },
  items: [],
};

const EMPTY_SIMILARITY_RESPONSE = {
  similarityScore: 0,
  comparedPaperId: null,
  sharedContext: '',
  novelty: '',
  structure: '',
  differentiation: '',
  differentiators: [],
  verdict: 'topic-overlap-uncertain',
  topicVerdict: '',
  risk: '',
  recommendations: [],
  topMatches: [],
  sectionComparisons: [],
  semanticDiff: { summary: '', insights: [] },
};

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
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
  }
  return payload;
}

function normalizeSearch(payload) {
  if (Array.isArray(payload)) return { ...EMPTY_SEARCH_RESPONSE, items: payload.map(toUiPaperShape) };
  if (payload?.items) return buildNormalizedSearchPayload(payload, payload.items);
  if (payload?.results) return buildNormalizedSearchPayload(payload, payload.results);
  if (payload?.data?.items) return buildNormalizedSearchPayload(payload.data, payload.data.items);
  return EMPTY_SEARCH_RESPONSE;
}

function normalizePaper(payload, id) {
  if (payload?.paper || payload?.expansion) {
    return toUiPaperDetail({ ...(payload.paper || {}), ...(payload.expansion || {}), id: payload.paper?.id || id });
  }
  if (payload?.data?.paper || payload?.data?.expansion) {
    return toUiPaperDetail({ ...(payload.data.paper || {}), ...(payload.data.expansion || {}), id: payload.data.paper?.id || id });
  }
  return toUiPaperDetail({ ...(payload ?? {}), id: payload?.id || id });
}

function normalizeSimilarity(payload) {
  if (payload?.analysis) return { ...EMPTY_SIMILARITY_RESPONSE, ...payload.analysis, ...payload };
  if (payload?.data?.analysis) return { ...EMPTY_SIMILARITY_RESPONSE, ...payload.data.analysis, ...(payload.data || {}) };
  return { ...EMPTY_SIMILARITY_RESPONSE, ...(payload ?? {}) };
}

function buildErrorSearch(query, error) {
  const normalizedQuery = normalizeSearchQuery(query);
  return {
    ...EMPTY_SEARCH_RESPONSE,
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
  } catch (error) {
    return buildErrorSearch(query, error);
  }
}

function parseStreamEventPayload(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

export async function fetchSearchStream(query, handlers = {}) {
  if (typeof EventSource === 'undefined') {
    const payload = await fetchSearch(query);
    handlers.onDone?.(payload);
    return payload;
  }

  const params = new URLSearchParams(normalizeSearchQuery(query));

  return new Promise((resolve, reject) => {
    const stream = new EventSource(`/api/search/stream?${params.toString()}`);
    let completed = false;

    const finishWithFallback = async () => {
      if (completed) return;
      completed = true;
      stream.close();
      try {
        const payload = await fetchSearch(query);
        handlers.onDone?.(payload);
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    };

    stream.addEventListener('summary', (event) => {
      const payload = parseStreamEventPayload(event);
      if (payload) handlers.onSummary?.(payload);
    });

    stream.addEventListener('progress', (event) => {
      const payload = parseStreamEventPayload(event);
      if (payload) handlers.onProgress?.(payload);
    });

    stream.addEventListener('results', (event) => {
      const payload = parseStreamEventPayload(event);
      if (payload) handlers.onResults?.(normalizeSearch(payload));
    });

    stream.addEventListener('done', (event) => {
      if (completed) return;
      completed = true;
      stream.close();
      const payload = normalizeSearch(parseStreamEventPayload(event));
      handlers.onDone?.(payload);
      resolve(payload);
    });

    stream.addEventListener('error', () => {
      void finishWithFallback();
    });
  });
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
    sourceUrl: item.links?.detail || item.sourceUrl || '',
    originalUrl: item.links?.original || item.originalUrl || item.links?.detail || '',
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
    source: paper.source,
    sourceUrl: item.sourceLinks?.detail || item.links?.detail || item.links?.original || '',
    originalUrl: item.sourceLinks?.original || item.links?.original || item.links?.detail || '',
    novelty: item.novelty || item.summary || '',
    methods: item.methods || [],
    highlights: item.highlights || [],
    related: (item.related || []).map((related) => toUiPaperShape(related)),
    citations: (item.citations || []).map((related) => toUiPaperShape(related)),
    references: (item.references || []).map((related) => toUiPaperShape(related)),
    recommendations: (item.recommendations || []).map((related) => toUiPaperShape(related)),
    graphPaths: item.graphPaths || [],
    graphTraversal: item.graphTraversal || item.expansion?.graphTraversal || null,
    explanation: item.explanation || null,
    comparisonMatrix: item.comparisonMatrix || item.expansion?.comparisonMatrix || [],
    graphNarrative: item.graphNarrative || item.expansion?.graphNarrative || null,
    suggestedQueries: item.suggestedQueries || item.expansion?.suggestedQueries || [],
    graph: item.graph || {},
    sourceStatus: item.sourceStatus || [],
    alternateSources: item.alternateSources || [],
    detailHealth: item.detailHealth || null,
    tags: item.keywords || [],
    metrics: item.metrics || paper.metrics,
  };
}

function buildNormalizedSearchPayload(basePayload, rawItems = []) {
  const items = rawItems.map(toUiPaperShape);
  return {
    ...EMPTY_SEARCH_RESPONSE,
    ...basePayload,
    filters: {
      ...EMPTY_SEARCH_RESPONSE.filters,
      ...(basePayload.filters || {}),
      sources: (basePayload.sourceStatus || []).map((source) => source.source) || EMPTY_SEARCH_RESPONSE.filters.sources,
    },
    items,
  };
}

export async function fetchPaper(id) {
  const payload = await requestJson(`/api/papers/${encodeURIComponent(id)}/expand`);
  return normalizePaper(payload, id);
}

export async function analyzeSimilarity(formData) {
  const payload = await requestJson('/api/similarity/analyze', {
    method: 'POST',
    body: formData,
  });
  return normalizeSimilarity(payload);
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

export async function fetchSharedLibraryItem(shareToken) {
  return requestJson(`/api/library/shared/${encodeURIComponent(shareToken)}`);
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

export async function fetchRecommendationFeed(limit = 8) {
  return requestJson(`/api/recommendations/feed?limit=${encodeURIComponent(limit)}`);
}
