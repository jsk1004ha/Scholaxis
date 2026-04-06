import { appConfig } from '../src/config.mjs';
import { enqueueRecurringInfraJobs } from '../src/job-service.mjs';

const jobs = enqueueRecurringInfraJobs();
console.log(
  `Scheduled ${jobs.length} infra jobs (interval hint ${appConfig.schedulerIntervalMs}ms).`
);
