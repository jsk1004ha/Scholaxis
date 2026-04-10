import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.join(__dirname, 'search-worker.mjs');
const requestedPoolSize = Number(process.env.SCHOLAXIS_SEARCH_WORKERS || 0);
const defaultPoolSize = Math.max(1, Math.min(2, (availableParallelism?.() || 2) - 1 || 1));
const maxWorkers = Math.max(1, requestedPoolSize || defaultPoolSize);
const requestedQueueSize = Number(process.env.SCHOLAXIS_SEARCH_MAX_QUEUED_TASKS || 0);
const maxQueuedTasks = Math.max(maxWorkers, requestedQueueSize || maxWorkers * 2);
const idleShutdownMs = Number(process.env.SCHOLAXIS_SEARCH_IDLE_SHUTDOWN_MS || 750);
const defaultTimeoutMs = Number(process.env.SCHOLAXIS_SEARCH_REQUEST_TIMEOUT_MS || 60000);
const overloadRetryAfterMs = Number(process.env.SCHOLAXIS_SEARCH_OVERLOAD_RETRY_AFTER_MS || 1000);

const workers = new Map();
const pendingJobs = [];
let workerSequence = 0;
let idleShutdownTimer = null;
let rejectedTasks = 0;
let lastOverloadAt = '';

export class SearchRuntimeOverloadedError extends Error {
  constructor(message = 'search-runtime-overloaded') {
    super(message);
    this.name = 'SearchRuntimeOverloadedError';
    this.code = 'search_runtime_overloaded';
    this.statusCode = 503;
    this.retryAfterMs = overloadRetryAfterMs;
  }
}

function makeWorkerId() {
  workerSequence += 1;
  return `search-worker-${workerSequence}`;
}

function isSettled(job) {
  return job.settled === true;
}

function settleJob(job, action) {
  if (isSettled(job)) return;
  job.settled = true;
  action();
}

function maybeScheduleIdleShutdown() {
  if (pendingJobs.length) return;
  if ([...workers.values()].some((worker) => worker.busy)) return;
  if (idleShutdownTimer) return;
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (pendingJobs.length) return;
    if ([...workers.values()].some((worker) => worker.busy)) return;
    shutdownWorkerPool();
  }, idleShutdownMs);
}

function removeWorker(id) {
  const entry = workers.get(id);
  if (!entry) return;
  workers.delete(id);
  if (entry.timeout) clearTimeout(entry.timeout);
  maybeScheduleIdleShutdown();
}

function cleanupCurrentJob(worker) {
  if (worker.timeout) clearTimeout(worker.timeout);
  worker.timeout = null;
  worker.currentJob = null;
  worker.busy = false;
  maybeScheduleIdleShutdown();
}

function rejectJob(job, error) {
  settleJob(job, () => job.reject(error));
}

function spawnWorker() {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
  if (workers.size >= maxWorkers) return null;

  const id = makeWorkerId();
  const child = fork(workerPath, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
    execArgv: process.execArgv.filter((arg) => !String(arg || '').startsWith('--input-type')),
  });

  const worker = {
    id,
    child,
    ready: false,
    busy: false,
    currentJob: null,
    timeout: null,
  };
  workers.set(id, worker);

  child.on('message', (message = {}) => {
    if (message.type === 'ready') {
      worker.ready = true;
      dispatchJobs();
      return;
    }

    const job = worker.currentJob;
    if (!job || message.taskId !== job.taskId) return;

    if (message.type === 'event') {
      job.onEvent?.(message.event);
      return;
    }

    if (message.type !== 'result') return;

    cleanupCurrentJob(worker);
    if (!message.ok) {
      rejectJob(job, new Error(message.error || `search-task-failed:${job.taskType}`));
      dispatchJobs();
      return;
    }

    settleJob(job, () => job.resolve(message.result));
    dispatchJobs();
  });

  child.on('error', (error) => {
    const job = worker.currentJob;
    cleanupCurrentJob(worker);
    removeWorker(id);
    if (job) rejectJob(job, error);
    dispatchJobs();
  });

  child.on('exit', (code, signal) => {
    const job = worker.currentJob;
    cleanupCurrentJob(worker);
    removeWorker(id);
    if (job && !isSettled(job)) {
      const message = job.cancelled
        ? `search-task-cancelled:${job.taskId}`
        : `search-worker-exit:${job.taskType}:${code || signal || 'unknown'}`;
      rejectJob(job, new Error(message));
    }
    dispatchJobs();
  });

  return worker;
}

function assignJob(worker, job) {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  worker.busy = true;
  worker.currentJob = job;
  worker.timeout = setTimeout(() => {
    const current = worker.currentJob;
    cleanupCurrentJob(worker);
    try {
      worker.child.kill('SIGKILL');
    } catch {
      // ignore kill failures
    }
    removeWorker(worker.id);
    if (current) rejectJob(current, new Error(`search-task-timeout:${current.taskType}`));
    dispatchJobs();
  }, job.timeoutMs);

  worker.child.send({
    taskId: job.taskId,
    taskType: job.taskType,
    payload: job.payload,
  });
}

function dispatchJobs() {
  while (pendingJobs.length) {
    let worker = [...workers.values()].find((entry) => entry.ready && !entry.busy);
    if (!worker && workers.size < maxWorkers) {
      worker = spawnWorker();
    }
    if (!worker || !worker.ready || worker.busy) break;
    assignJob(worker, pendingJobs.shift());
  }
}

function enforceQueueLimit() {
  const activeOrQueuedTasks = pendingJobs.length + [...workers.values()].filter((worker) => worker.busy).length;
  const capacity = maxWorkers + maxQueuedTasks;
  if (activeOrQueuedTasks >= capacity) {
    rejectedTasks += 1;
    lastOverloadAt = new Date().toISOString();
    throw new SearchRuntimeOverloadedError();
  }
}

function enqueueSearchTask(taskType = '', payload = {}, options = {}) {
  enforceQueueLimit();
  const timeoutMs = Number(options.timeoutMs || defaultTimeoutMs);
  const taskId = randomUUID();
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  let rejectPromise = () => {};
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    pendingJobs.push({
      taskId,
      taskType,
      payload,
      timeoutMs,
      resolve,
      reject,
      onEvent: options.onEvent,
      settled: false,
      cancelled: false,
    });
  });

  const cancel = () => {
    const pendingIndex = pendingJobs.findIndex((task) => task.taskId === taskId);
    if (pendingIndex !== -1) {
      const [task] = pendingJobs.splice(pendingIndex, 1);
      task.cancelled = true;
      rejectJob(task, new Error(`search-task-cancelled:${taskId}`));
      return;
    }

    const runningWorker = [...workers.values()].find((worker) => worker.currentJob?.taskId === taskId);
    if (runningWorker?.currentJob) {
      runningWorker.currentJob.cancelled = true;
      try {
        runningWorker.child.kill('SIGTERM');
      } catch {
        // ignore kill failure
      }
    }
  };

  promise.catch(() => {});
  dispatchJobs();

  return {
    taskId,
    promise,
    cancel,
    reject: rejectPromise,
  };
}

export function runSearchCatalogTask(options = {}, runtimeOptions = {}) {
  return enqueueSearchTask('search-catalog', { options }, runtimeOptions);
}

export function runSearchCatalogStreamTask(options = {}, runtimeOptions = {}) {
  return enqueueSearchTask('search-stream', { options }, runtimeOptions);
}

export function isSearchRuntimeOverloadedError(error) {
  return error instanceof SearchRuntimeOverloadedError || error?.code === 'search_runtime_overloaded';
}

export function getSearchRuntimeDiagnostics() {
  const workerEntries = [...workers.values()];
  return {
    poolSize: maxWorkers,
    maxQueuedTasks,
    workerCount: workerEntries.length,
    readyWorkers: workerEntries.filter((worker) => worker.ready).length,
    busyWorkers: workerEntries.filter((worker) => worker.busy).length,
    queuedTasks: pendingJobs.length,
    rejectedTasks,
    lastOverloadAt,
    idleShutdownMs,
    requestTimeoutMs: defaultTimeoutMs,
    overloadRetryAfterMs,
  };
}

function shutdownWorkerPool() {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
  for (const worker of workers.values()) {
    try {
      worker.child.kill('SIGTERM');
    } catch {
      // ignore shutdown failures
    }
  }
  workers.clear();
}

process.once('exit', shutdownWorkerPool);
process.once('SIGINT', () => {
  shutdownWorkerPool();
  process.exit(130);
});
process.once('SIGTERM', () => {
  shutdownWorkerPool();
  process.exit(143);
});
