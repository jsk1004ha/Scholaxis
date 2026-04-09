import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.join(__dirname, 'analysis-worker.mjs');
const requestedPoolSize = Number(process.env.SCHOLAXIS_ANALYSIS_WORKERS || 0);
const defaultPoolSize = Math.max(2, Math.min(4, (availableParallelism?.() || 2) - 1 || 1));
const maxWorkers = Math.max(1, requestedPoolSize || defaultPoolSize);
const idleShutdownMs = Number(process.env.SCHOLAXIS_ANALYSIS_IDLE_SHUTDOWN_MS || 750);
const asyncJobTtlMs = Number(process.env.SCHOLAXIS_ASYNC_JOB_TTL_MS || 10 * 60 * 1000);

const workers = new Map();
const pendingJobs = [];
let workerSequence = 0;
let idleShutdownTimer = null;
const asyncJobs = new Map();

function makeWorkerId() {
  workerSequence += 1;
  return `analysis-worker-${workerSequence}`;
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

function rejectJob(job, errorMessage) {
  job.reject(new Error(errorMessage));
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

    if (message.type === 'progress') {
      job.onProgress?.(message.progress);
      return;
    }

    if (!message.ok) {
      cleanupCurrentJob(worker);
      rejectJob(job, message.error || `analysis-task-failed:${job.taskType}`);
      dispatchJobs();
      return;
    }

    cleanupCurrentJob(worker);
    job.resolve(message.result);
    dispatchJobs();
  });

  child.on('error', (error) => {
    const job = worker.currentJob;
    cleanupCurrentJob(worker);
    removeWorker(id);
    if (job) job.reject(error);
    dispatchJobs();
  });

  child.on('exit', (code, signal) => {
    const job = worker.currentJob;
    cleanupCurrentJob(worker);
    removeWorker(id);
    if (job) {
      if (job.cancelled) {
        rejectJob(job, `analysis-job-cancelled:${job.asyncJobId || job.taskId}`);
      } else {
        rejectJob(job, `analysis-worker-exit:${job.taskType}:${code || signal || 'unknown'}`);
      }
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
    if (current) rejectJob(current, `analysis-task-timeout:${current.taskType}`);
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
    const job = pendingJobs.shift();
    assignJob(worker, job);
  }
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

export async function runAnalysisTask(taskType = '', payload = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const taskId = randomUUID();
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  return new Promise((resolve, reject) => {
    const task = {
      taskId,
      taskType,
      payload,
      timeoutMs,
      resolve,
      reject,
      asyncJobId: options.asyncJobId || '',
      cancelled: false,
      onProgress: options.onProgress,
    };
    pendingJobs.push(task);
    options.onEnqueue?.(task);
    dispatchJobs();
  });
}

function cleanupExpiredAsyncJobs() {
  const now = Date.now();
  for (const [id, job] of asyncJobs.entries()) {
    const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
    if (completedAt && now - completedAt > asyncJobTtlMs) {
      asyncJobs.delete(id);
    }
  }
}

function normalizeAsyncJob(job = {}) {
  return {
    id: job.id,
    taskType: job.taskType,
    status: job.status,
    progress: job.progress ?? 0,
    stage: job.stage || '',
    stageLabel: job.stageLabel || '',
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    error: job.error || '',
    result: job.result ?? null,
  };
}

export function submitAsyncAnalysisJob(taskType = '', payload = {}, options = {}) {
  cleanupExpiredAsyncJobs();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const job = {
    id,
    taskType,
    payload,
    status: 'queued',
    progress: 10,
    stage: 'queued',
    stageLabel: '작업이 대기열에 있습니다.',
    createdAt,
    startedAt: null,
    completedAt: null,
    error: '',
    result: null,
  };
  asyncJobs.set(id, job);

  queueMicrotask(async () => {
    const current = asyncJobs.get(id);
    if (!current) return;
    if (current.cancelRequested) {
      current.status = 'cancelled';
      current.progress = 100;
      current.stage = 'cancelled';
      current.stageLabel = '작업이 취소되었습니다.';
      current.completedAt = new Date().toISOString();
      return;
    }
    current.status = 'running';
    current.progress = 55;
    current.stage = 'running';
    current.stageLabel = '작업을 계산하고 있습니다.';
    current.startedAt = new Date().toISOString();
    try {
      const result = await runAnalysisTask(taskType, payload, {
        ...options,
        asyncJobId: id,
        onEnqueue: (task) => {
          current.runtimeTaskId = task.taskId;
        },
        onProgress: (progress) => {
          current.progress = Number(progress?.progress || current.progress || 55);
          current.stage = progress?.stage || current.stage || 'running';
          current.stageLabel = progress?.label || current.stageLabel || '작업을 계산하고 있습니다.';
        },
      });
      current.status = 'completed';
      current.progress = 100;
      current.stage = 'completed';
      current.stageLabel = '작업이 완료되었습니다.';
      current.result = result;
      current.completedAt = new Date().toISOString();
      await options.onComplete?.(result);
    } catch (error) {
      const message = error.message || String(error || 'analysis-job-failed');
      if (current.cancelRequested || message.startsWith('analysis-job-cancelled:')) {
        current.status = 'cancelled';
        current.error = '';
        current.stage = 'cancelled';
        current.stageLabel = '작업이 취소되었습니다.';
      } else {
        current.status = 'failed';
        current.error = message;
        current.stage = 'failed';
        current.stageLabel = '작업이 실패했습니다.';
      }
      current.progress = 100;
      current.completedAt = new Date().toISOString();
      await options.onError?.(error);
    }
  });

  return normalizeAsyncJob(job);
}

export function getAsyncAnalysisJob(id = '') {
  cleanupExpiredAsyncJobs();
  const job = asyncJobs.get(id);
  return job ? normalizeAsyncJob(job) : null;
}

export function cancelAsyncAnalysisJob(id = '') {
  cleanupExpiredAsyncJobs();
  const job = asyncJobs.get(id);
  if (!job) return null;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return normalizeAsyncJob(job);

  job.cancelRequested = true;

  const pendingIndex = pendingJobs.findIndex((task) => task.asyncJobId === id);
  if (pendingIndex !== -1) {
    const [task] = pendingJobs.splice(pendingIndex, 1);
    task.cancelled = true;
    rejectJob(task, `analysis-job-cancelled:${id}`);
    job.status = 'cancelled';
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    return normalizeAsyncJob(job);
  }

  const runningWorker = [...workers.values()].find((worker) => worker.currentJob?.asyncJobId === id);
  if (runningWorker?.currentJob) {
    runningWorker.currentJob.cancelled = true;
    try {
      runningWorker.child.kill('SIGTERM');
    } catch {
      // ignore kill failure
    }
  }

  return normalizeAsyncJob(job);
}

export function getAnalysisRuntimeDiagnostics() {
  cleanupExpiredAsyncJobs();
  const workerEntries = [...workers.values()];
  const jobs = [...asyncJobs.values()];
  return {
    poolSize: maxWorkers,
    workerCount: workerEntries.length,
    readyWorkers: workerEntries.filter((worker) => worker.ready).length,
    busyWorkers: workerEntries.filter((worker) => worker.busy).length,
    queuedTasks: pendingJobs.length,
    idleShutdownMs,
    asyncJobs: {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      cancelled: jobs.filter((job) => job.status === 'cancelled').length,
    },
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
