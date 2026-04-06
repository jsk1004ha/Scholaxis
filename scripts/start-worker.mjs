import { appConfig } from '../src/config.mjs';
import { runWorkerLoop } from '../src/job-service.mjs';

const iterations = Number(process.argv[2] || 3);
const processed = await runWorkerLoop({ iterations });

console.log(
  `Worker processed ${processed.length} job(s) with poll hint ${appConfig.workerPollMs}ms.`
);
