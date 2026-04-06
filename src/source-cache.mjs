import { appConfig } from './config.mjs';

const cache = new Map();
const staleEntries = new Map();
const queryStats = new Map();
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
  clears: 0,
  staleTracked: 0,
  prewarmRuns: 0,
  prewarmFailures: 0
};
const prewarmState = {
  active: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastQuery: '',
  lastStatus: 'idle',
  recentRuns: []
};

function now() {
  return Date.now();
}

function isoNow(timestamp = Date.now()) {
  return new Date(timestamp).toISOString();
}

function cacheKey(source, query, limit) {
  return `${source}::${query}::${limit}`;
}

function normalizeQuery(query = '') {
  return String(query || '').trim().toLowerCase();
}

function touchQueryStat(query, source, outcome) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return;
  const entry = queryStats.get(normalizedQuery) || {
    query: String(query || '').trim(),
    lookups: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    lastSeenAt: null,
    sources: new Set()
  };
  if (outcome === 'lookup') entry.lookups += 1;
  if (outcome === 'hit') entry.hits += 1;
  if (outcome === 'miss') entry.misses += 1;
  if (outcome === 'set') entry.sets += 1;
  entry.lastSeenAt = isoNow();
  if (source) entry.sources.add(source);
  queryStats.set(normalizedQuery, entry);
}

function trackStaleEntry(key, entry, staleAt = now()) {
  const [source = '', query = '', limit = ''] = key.split('::');
  staleEntries.set(key, {
    source,
    query,
    limit: Number(limit || 0),
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt,
    staleAt,
    ageMs: Math.max(0, staleAt - Number(entry.expiresAt || staleAt))
  });
  stats.staleTracked += 1;
}

function trimRecentPrewarmRuns() {
  prewarmState.recentRuns = prewarmState.recentRuns.slice(0, 10);
}

export function clearExpiredSourceCache() {
  const current = now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= current) {
      trackStaleEntry(key, entry, current);
      cache.delete(key);
      stats.evictions += 1;
    }
  }
}

export function clearSourceCache(filter = {}) {
  const { source = '', query = '' } = filter;
  let removed = 0;
  for (const key of [...cache.keys()]) {
    const sourceMatch = !source || key.startsWith(`${source}::`);
    const queryMatch = !query || key.includes(`::${query}::`);
    if (sourceMatch && queryMatch) {
      cache.delete(key);
      staleEntries.delete(key);
      removed += 1;
    }
  }
  stats.clears += removed;
  return { removed };
}

export function getCachedSourceResult(source, query, limit) {
  clearExpiredSourceCache();
  touchQueryStat(query, source, 'lookup');
  const entry = cache.get(cacheKey(source, query, limit));
  if (!entry) {
    stats.misses += 1;
    touchQueryStat(query, source, 'miss');
    return null;
  }
  stats.hits += 1;
  staleEntries.delete(cacheKey(source, query, limit));
  touchQueryStat(query, source, 'hit');
  return {
    ...entry.value,
    cached: true,
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt
  };
}

export function setCachedSourceResult(source, query, limit, value, ttlMs = appConfig.sourceCacheTtlMs) {
  const cachedAt = now();
  const key = cacheKey(source, query, limit);
  cache.set(key, {
    cachedAt,
    expiresAt: cachedAt + ttlMs,
    value
  });
  staleEntries.delete(key);
  stats.sets += 1;
  touchQueryStat(query, source, 'set');
}

export function listHotSourceQueries(limit = 5) {
  return [...queryStats.values()]
    .sort((a, b) => b.lookups - a.lookups || b.hits - a.hits)
    .slice(0, limit)
    .map((entry) => ({
      query: entry.query,
      lookups: entry.lookups,
      hits: entry.hits,
      misses: entry.misses,
      sets: entry.sets,
      lastSeenAt: entry.lastSeenAt,
      sources: [...entry.sources]
    }));
}

export function markSourceCachePrewarmStart({ query = '', trigger = 'job', forceRefresh = false } = {}) {
  prewarmState.active = true;
  prewarmState.lastStartedAt = isoNow();
  prewarmState.lastQuery = String(query || '');
  prewarmState.lastStatus = 'running';
  prewarmState.recentRuns.unshift({
    query: String(query || ''),
    trigger,
    forceRefresh: Boolean(forceRefresh),
    startedAt: prewarmState.lastStartedAt,
    status: 'running'
  });
  trimRecentPrewarmRuns();
}

export function markSourceCachePrewarmFinish({
  query = '',
  trigger = 'job',
  forceRefresh = false,
  status = 'completed',
  total = 0,
  liveSourceCount = 0,
  error = ''
} = {}) {
  prewarmState.active = false;
  prewarmState.lastFinishedAt = isoNow();
  prewarmState.lastQuery = String(query || prewarmState.lastQuery || '');
  prewarmState.lastStatus = status;
  if (status === 'completed') stats.prewarmRuns += 1;
  if (status === 'failed') stats.prewarmFailures += 1;

  const current = prewarmState.recentRuns[0];
  const nextEntry = {
    query: String(query || ''),
    trigger,
    forceRefresh: Boolean(forceRefresh),
    startedAt: current?.startedAt || prewarmState.lastStartedAt,
    finishedAt: prewarmState.lastFinishedAt,
    status,
    total,
    liveSourceCount,
    error: error || undefined
  };
  if (current?.status === 'running' && current.query === nextEntry.query) prewarmState.recentRuns[0] = nextEntry;
  else prewarmState.recentRuns.unshift(nextEntry);
  trimRecentPrewarmRuns();
}

export function getSourceCacheDiagnostics() {
  clearExpiredSourceCache();
  return {
    entries: cache.size,
    ttlMs: appConfig.sourceCacheTtlMs,
    strategy: {
      ttlMs: appConfig.sourceCacheTtlMs,
      autoLiveOnEmpty: appConfig.autoLiveOnEmpty,
      maxLiveResultsPerSource: appConfig.maxLiveResultsPerSource
    },
    hotQueries: listHotSourceQueries(5),
    staleEntries: [...staleEntries.values()]
      .sort((a, b) => Number(b.staleAt || 0) - Number(a.staleAt || 0))
      .slice(0, 5),
    prewarm: {
      ...prewarmState,
      recentRuns: prewarmState.recentRuns.slice(0, 5)
    },
    ...stats
  };
}
