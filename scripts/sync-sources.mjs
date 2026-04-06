import { clearSourceCache } from '../src/source-adapters.mjs';
import { enqueueBackgroundJob } from '../src/storage.mjs';
import { listTrends } from '../src/search-service.mjs';
import { runWorkerLoop } from '../src/job-service.mjs';

clearSourceCache();
for (const topic of listTrends().slice(0, 6)) {
  enqueueBackgroundJob({
    jobType: 'live-search-sync',
    payload: { query: topic },
    priority: 3,
  });
}

const processed = await runWorkerLoop({ iterations: 6 });
for (const job of processed) {
  console.log(job.payload?.query || job.jobType, job.status, JSON.stringify(job.result || {}));
}
