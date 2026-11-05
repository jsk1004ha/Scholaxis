import { appConfig } from './config.mjs';
import { seedCatalog, trendingTopics } from './catalog.mjs';
import { deriveGraphEdges } from './graph-service.mjs';
import { searchCatalog } from './search-service.mjs';
import {
  listHotSourceQueries,
  markSourceCachePrewarmFinish,
  markSourceCachePrewarmStart
} from './source-cache.mjs';
import {
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  leaseNextBackgroundJob,
  persistDocuments,
  persistGraphEdges,
  renewBackgroundJobLease,
  requeueBackgroundJob,
} from './storage.mjs';
import { attachVectors } from './vector-service.mjs';

export function enqueueRecurringInfraJobs() {
  const hotQueries = listHotSourceQueries(3);
  const prewarmQueries = hotQueries.length
    ? hotQueries.map((item, index) =>
        enqueueBackgroundJob({
          jobType: 'cache-prewarm',
          payload: { query: item.query, preferredSources: item.sources || [], trigger: 'hot-query' },
          priority: 6 - index
        })
      )
    : trendingTopics.slice(0, 2).map((topic, index) =>
        enqueueBackgroundJob({
          jobType: 'cache-prewarm',
          payload: { query: topic, trigger: 'trending-topic' },
          priority: 3 - index
        })
      );

  return [
    enqueueBackgroundJob({
      jobType: 'graph-refresh',
      payload: { topic: 'seed-catalog' },
      priority: 5,
    }),
    enqueueBackgroundJob({
      jobType: 'source-health-check',
      payload: { query: hotQueries[0]?.query || trendingTopics[0] || 'AI research' },
      priority: 5,
    }),
    ...trendingTopics.slice(0, 4).map((topic, index) =>
      enqueueBackgroundJob({
        jobType: 'live-search-sync',
        payload: { query: topic },
        priority: 4 - index,
      })
    ),
    ...prewarmQueries,
  ];
}

async function runGraphRefresh() {
  const documents = seedCatalog.map((document) => attachVectors(document, appConfig.vectorDimensions));
  persistDocuments(documents);
  persistGraphEdges(deriveGraphEdges(documents));
  return { ok: true, documentCount: documents.length };
}

async function runLiveSearchSync(payload = {}) {
  const result = await searchCatalog({
    q: payload.query || 'AI research',
    live: true,
  });
  return { ok: true, total: result.total, query: payload.query || 'AI research' };
}

async function runCitationRefresh(payload = {}) {
  const result = await searchCatalog({
    q: payload.query || payload.paperTitle || 'citation graph',
    live: false,
  });
  return { ok: true, total: result.total };
}

async function runCachePrewarm(payload = {}) {
  const query = payload.query || 'AI research';
  const preferredSources = Array.isArray(payload.preferredSources) ? payload.preferredSources : [];
  const trigger = payload.trigger || 'job';
  const forceRefresh = payload.forceRefresh !== false;
  markSourceCachePrewarmStart({ query, trigger, forceRefresh });
  try {
    const result = await searchCatalog({
      q: query,
      preferredSources,
      live: true,
      autoLive: true,
      forceRefresh,
    });
    markSourceCachePrewarmFinish({
      query,
      trigger,
      forceRefresh,
      status: 'completed',
      total: result.total,
      liveSourceCount: result.liveSourceCount,
    });
    return {
      ok: true,
      query,
      total: result.total,
      liveSourceCount: result.liveSourceCount,
      preferredSources,
    };
  } catch (error) {
    markSourceCachePrewarmFinish({
      query,
      trigger,
      forceRefresh,
      status: 'failed',
      error: error.message,
    });
    throw error;
  }
}

async function runSourceHealthCheck(payload = {}) {
  const query = payload.query || trendingTopics[0] || 'AI research';
  const result = await searchCatalog({
    q: query,
    live: appConfig.enableLiveSources,
    autoLive: appConfig.autoLiveOnEmpty,
    forceRefresh: true,
  });
  const failingSources = (result.sourceStatus || [])
    .filter((item) => ['error', 'timeout'].includes(String(item.status || '').toLowerCase()));
  return {
    ok: failingSources.length === 0,
    query,
    total: result.total,
    failingSources: failingSources.map((item) => item.source),
    sourceCount: (result.sourceStatus || []).length,
  };
}

export async function runBackgroundJob(job) {
  switch (job.jobType) {
    case 'graph-refresh':
      return runGraphRefresh(job.payload);
    case 'live-search-sync':
      return runLiveSearchSync(job.payload);
    case 'citation-refresh':
      return runCitationRefresh(job.payload);
    case 'cache-prewarm':
      return runCachePrewarm(job.payload);
    case 'source-health-check':
      return runSourceHealthCheck(job.payload);
    default:
      return { ok: true, skipped: true, jobType: job.jobType };
  }
}

export async function workNextJob({ runJob = runBackgroundJob } = {}) {
  const leased = leaseNextBackgroundJob({ leaseMs: appConfig.workerLeaseMs });
  if (!leased) return null;
  const ownership = { attempts: leased.attempts };
  let leaseLost = false;
  // Keep asynchronous source/model work owned for longer than the initial lease.
  const heartbeat = setInterval(() => {
    try {
      if (renewBackgroundJobLease(leased.id, { ...ownership, leaseMs: appConfig.workerLeaseMs })) return;
    } catch {
      // If ownership cannot be confirmed, leave recovery to a subsequent claimant.
    }
    leaseLost = true;
    clearInterval(heartbeat);
  }, Math.max(1, Math.floor(appConfig.workerLeaseMs / 3)));
  heartbeat.unref();
  try {
    const result = await runJob(leased);
    const completed = leaseLost ? null : completeBackgroundJob(leased.id, ownership);
    return { ...(completed || leased), result, status: completed ? 'completed' : 'lease-lost' };
  } catch (error) {
    const failed = leaseLost ? null : failBackgroundJob(leased.id, error.message, ownership);
    return { ...(failed || leased), status: failed ? 'failed' : 'lease-lost', error: error.message };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runWorkerLoop({ iterations = 1 } = {}) {
  const processed = [];
  for (let index = 0; index < iterations; index += 1) {
    const next = await workNextJob();
    if (!next) break;
    processed.push(next);
    if (next.status === 'failed') {
      requeueBackgroundJob(next.id, 5000, { attempts: next.attempts });
    }
  }
  return processed;
}
