import { appConfig } from './config.mjs';
import { seedCatalog, trendingTopics } from './catalog.mjs';
import { deriveGraphEdges } from './graph-service.mjs';
import { searchCatalog } from './search-service.mjs';
import {
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  leaseNextBackgroundJob,
  persistDocuments,
  persistGraphEdges,
  requeueBackgroundJob,
} from './storage.mjs';
import { attachVectors } from './vector-service.mjs';

export function enqueueRecurringInfraJobs() {
  return [
    enqueueBackgroundJob({
      jobType: 'graph-refresh',
      payload: { topic: 'seed-catalog' },
      priority: 5,
    }),
    ...trendingTopics.slice(0, 4).map((topic, index) =>
      enqueueBackgroundJob({
        jobType: 'live-search-sync',
        payload: { query: topic },
        priority: 4 - index,
      })
    ),
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

export async function runBackgroundJob(job) {
  switch (job.jobType) {
    case 'graph-refresh':
      return runGraphRefresh(job.payload);
    case 'live-search-sync':
      return runLiveSearchSync(job.payload);
    case 'citation-refresh':
      return runCitationRefresh(job.payload);
    default:
      return { ok: true, skipped: true, jobType: job.jobType };
  }
}

export async function workNextJob() {
  const leased = leaseNextBackgroundJob({ leaseMs: appConfig.workerLeaseMs });
  if (!leased) return null;
  try {
    const result = await runBackgroundJob(leased);
    completeBackgroundJob(leased.id);
    return { ...leased, result, status: 'completed' };
  } catch (error) {
    failBackgroundJob(leased.id, error.message);
    return { ...leased, status: 'failed', error: error.message };
  }
}

export async function runWorkerLoop({ iterations = 1 } = {}) {
  const processed = [];
  for (let index = 0; index < iterations; index += 1) {
    const next = await workNextJob();
    if (!next) break;
    processed.push(next);
    if (next.status !== 'completed') {
      requeueBackgroundJob(next.id, 5000);
    }
  }
  return processed;
}
