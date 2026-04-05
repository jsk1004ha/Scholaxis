import { appConfig } from './config.mjs';

const cache = new Map();
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
  clears: 0
};

function now() {
  return Date.now();
}

function cacheKey(source, query, limit) {
  return `${source}::${query}::${limit}`;
}

export function clearExpiredSourceCache() {
  const current = now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= current) {
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
      removed += 1;
    }
  }
  stats.clears += removed;
  return { removed };
}

export function getCachedSourceResult(source, query, limit) {
  clearExpiredSourceCache();
  const entry = cache.get(cacheKey(source, query, limit));
  if (!entry) {
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return {
    ...entry.value,
    cached: true,
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt
  };
}

export function setCachedSourceResult(source, query, limit, value, ttlMs = appConfig.sourceCacheTtlMs) {
  const cachedAt = now();
  cache.set(cacheKey(source, query, limit), {
    cachedAt,
    expiresAt: cachedAt + ttlMs,
    value
  });
  stats.sets += 1;
}

export function getSourceCacheDiagnostics() {
  clearExpiredSourceCache();
  return {
    entries: cache.size,
    ttlMs: appConfig.sourceCacheTtlMs,
    ...stats
  };
}
