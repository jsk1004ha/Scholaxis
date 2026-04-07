import { spawn } from 'node:child_process';
import { appConfig } from './config.mjs';

const state = {
  provider: appConfig.rerankerProvider,
  serviceUrl: appConfig.rerankerServiceUrl,
  autostart: appConfig.rerankerAutostart,
  status: appConfig.rerankerServiceUrl ? 'configured' : 'disabled',
  ready: false,
  pid: null,
  launchCommand: '',
  lastError: '',
  lastCheckedAt: null,
  startedByScholaxis: false,
};

let launchPromise = null;
let childProcess = null;

function healthUrl() {
  const url = new URL(appConfig.rerankerServiceUrl);
  url.pathname = '/health';
  url.search = '';
  return url;
}

async function checkRerankerBackend() {
  if (!appConfig.rerankerServiceUrl) {
    state.status = 'disabled';
    state.ready = false;
    return false;
  }

  state.lastCheckedAt = new Date().toISOString();
  try {
    const response = await fetch(healthUrl(), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`reranker backend probe failed: ${response.status}`);
    state.status = 'ready';
    state.ready = true;
    state.lastError = '';
    return true;
  } catch (error) {
    state.status = state.startedByScholaxis ? 'starting' : 'unavailable';
    state.ready = false;
    state.lastError = error.message;
    return false;
  }
}

async function waitForReady(timeoutMs = appConfig.rerankerStartupTimeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkRerankerBackend()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function ensureRerankerBackend() {
  if (await checkRerankerBackend()) return getRerankerRuntimeDiagnostics();

  if (
    appConfig.rerankerProvider !== 'local-http' ||
    !appConfig.rerankerAutostart ||
    !appConfig.rerankerServiceUrl
  ) {
    return getRerankerRuntimeDiagnostics();
  }

  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    try {
      childProcess = spawn(process.execPath, ['scripts/start-reranker-service.mjs'], {
        stdio: 'ignore',
        detached: false,
      });
      state.pid = childProcess.pid || null;
      state.launchCommand = `${process.execPath} scripts/start-reranker-service.mjs`;
      state.startedByScholaxis = true;
      state.status = 'starting';

      childProcess.on('exit', (code, signal) => {
        state.ready = false;
        state.pid = null;
        state.status = 'stopped';
        state.lastError = `reranker backend exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
        childProcess = null;
      });

      if (await waitForReady()) {
        launchPromise = null;
        return getRerankerRuntimeDiagnostics();
      }
    } catch (error) {
      state.lastError = error.message;
    }

    state.status = 'failed';
    launchPromise = null;
    return getRerankerRuntimeDiagnostics();
  })();

  return launchPromise;
}

export function getRerankerRuntimeDiagnostics() {
  return {
    provider: state.provider,
    serviceUrl: state.serviceUrl,
    autostart: state.autostart,
    status: state.status,
    ready: state.ready,
    pid: state.pid,
    startedByScholaxis: state.startedByScholaxis,
    launchCommand: state.launchCommand,
    lastError: state.lastError,
    lastCheckedAt: state.lastCheckedAt,
  };
}
