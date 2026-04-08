import { spawn } from 'node:child_process';
import { appConfig } from './config.mjs';

const state = {
  provider: appConfig.localModelProvider,
  serviceUrl: appConfig.localModelServiceUrl,
  autostart: appConfig.localModelAutostart,
  status: appConfig.localModelServiceUrl ? 'configured' : 'disabled',
  ready: false,
  pid: null,
  launchCommand: '',
  lastError: '',
  lastCheckedAt: null,
  startedByScholaxis: false,
};

let launchPromise = null;
let childProcess = null;
let childExitWhileWaiting = false;

function healthUrl() {
  return new URL('/health', appConfig.localModelServiceUrl);
}

async function checkLocalModelBackend() {
  if (!appConfig.localModelServiceUrl) {
    state.status = 'disabled';
    state.ready = false;
    return false;
  }

  state.lastCheckedAt = new Date().toISOString();
  try {
    const response = await fetch(healthUrl(), { signal: AbortSignal.timeout(1200) });
    if (!response.ok) throw new Error(`local model backend probe failed: ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    if (payload?.ok === false || payload?.importError) {
      const reason = payload.importError || 'local model backend is unhealthy';
      state.status = 'failed';
      state.ready = false;
      state.lastError = reason;
      return false;
    }
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

async function waitForReady(timeoutMs = appConfig.localModelStartupTimeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (childExitWhileWaiting) return false;
    if (await checkLocalModelBackend()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function shouldAutostart() {
  return (
    appConfig.localModelAutostart &&
    (
      ['hybrid-local', 'auto'].includes(appConfig.embeddingProvider) ||
      ['hybrid-local', 'auto'].includes(appConfig.rerankerProvider)
    )
  );
}

function shouldProbe() {
  return (
    Boolean(process.env.SCHOLAXIS_LOCAL_MODEL_SERVICE_URL) ||
    shouldAutostart() ||
    appConfig.embeddingProvider === 'hybrid-local' ||
    appConfig.rerankerProvider === 'hybrid-local'
  );
}

export async function ensureLocalModelBackend() {
  if (!shouldProbe()) {
    state.status = 'disabled';
    state.ready = false;
    return getLocalModelDiagnostics();
  }
  if (await checkLocalModelBackend()) return getLocalModelDiagnostics();

  if (!shouldAutostart()) {
    return getLocalModelDiagnostics();
  }

  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    try {
      childExitWhileWaiting = false;
      const env = {
        ...process.env,
        SCHOLAXIS_LOCAL_MODEL_HOST: appConfig.localModelHost,
        SCHOLAXIS_LOCAL_MODEL_PORT: String(appConfig.localModelPort),
        SCHOLAXIS_EMBEDDING_MODEL: appConfig.embeddingModel,
        SCHOLAXIS_RERANKER_MODEL: appConfig.rerankerModel,
        SCHOLAXIS_LOCAL_MODEL_DEVICE: appConfig.localModelTorchDevice,
      };
      if (appConfig.localModelCacheDir) {
        env.HF_HOME = appConfig.localModelCacheDir;
      }
      childProcess = spawn(appConfig.localModelPythonBin, ['scripts/local-model-server.py'], {
        stdio: 'ignore',
        detached: false,
        env,
      });
      state.pid = childProcess.pid || null;
      state.launchCommand = `${appConfig.localModelPythonBin} scripts/local-model-server.py`;
      state.startedByScholaxis = true;
      state.status = 'starting';

      childProcess.on('exit', (code, signal) => {
        childExitWhileWaiting = true;
        state.ready = false;
        state.pid = null;
        state.status = 'stopped';
        state.lastError = `local model backend exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
        childProcess = null;
      });

      if (await waitForReady()) {
        launchPromise = null;
        return getLocalModelDiagnostics();
      }
    } catch (error) {
      state.lastError = error.message;
    }

    state.status = 'failed';
    launchPromise = null;
    return getLocalModelDiagnostics();
  })();

  return launchPromise;
}

export async function localModelReady() {
  return checkLocalModelBackend();
}

export function getLocalModelDiagnostics() {
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
    embeddingModel: appConfig.embeddingModel,
    rerankerModel: appConfig.rerankerModel,
  };
}
