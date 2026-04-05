import { getPaperById, mockSearchResponse, mockSimilarity } from './mock-data.js';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function normalizeSearch(payload) {
  if (Array.isArray(payload)) return { ...mockSearchResponse, items: payload };
  if (payload?.items) return { ...mockSearchResponse, ...payload, items: payload.items };
  if (payload?.results) return { ...mockSearchResponse, ...payload, items: payload.results };
  if (payload?.data?.items) return { ...mockSearchResponse, ...payload.data, items: payload.data.items };
  return mockSearchResponse;
}

function normalizePaper(payload, id) {
  if (payload?.paper) return { ...getPaperById(id), ...payload.paper };
  if (payload?.data?.paper) return { ...getPaperById(id), ...payload.data.paper };
  return { ...getPaperById(id), ...(payload ?? {}) };
}

function normalizeSimilarity(payload) {
  if (payload?.analysis) return { ...mockSimilarity, ...payload.analysis };
  if (payload?.data?.analysis) return { ...mockSimilarity, ...payload.data.analysis };
  return { ...mockSimilarity, ...(payload ?? {}) };
}

function buildFallbackSearch(query) {
  const q = (query.q || '').toLowerCase();
  const regionFilter = (query.region || '').split(',').filter(Boolean);
  const typeFilter = (query.sourceType || '').split(',').filter(Boolean);

  const items = mockSearchResponse.items.filter((paper) => {
    const haystack = [paper.title, paper.subtitle, paper.summary, paper.abstract, ...(paper.tags ?? [])]
      .join(' ')
      .toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const matchesRegion = regionFilter.length === 0 || regionFilter.includes(paper.region);
    const matchesType = typeFilter.length === 0 || typeFilter.includes(paper.sourceType);
    return matchesQuery && matchesRegion && matchesType;
  });

  return {
    ...mockSearchResponse,
    query: query.q || mockSearchResponse.query,
    total: items.length,
    items,
  };
}

export async function fetchSearch(query) {
  const params = new URLSearchParams(query);
  try {
    const payload = await requestJson(`/api/search?${params.toString()}`);
    return normalizeSearch(payload);
  } catch {
    return buildFallbackSearch(query);
  }
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
