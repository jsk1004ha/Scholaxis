import { spawn } from 'node:child_process';
import { appConfig } from './config.mjs';

const state = {
  provider: appConfig.translationProvider,
  serviceUrl: appConfig.translationServiceUrl,
  autostart: appConfig.translationAutostart,
  status: appConfig.translationServiceUrl ? 'configured' : 'disabled',
  ready: false,
  pid: null,
  launchCommand: '',
  lastError: '',
  lastCheckedAt: null,
  startedByScholaxis: false,
};

let launchPromise = null;
let childProcess = null;

function languagesUrl() {
  const url = new URL(appConfig.translationServiceUrl);
  url.pathname = '/languages';
  url.search = '';
  return url;
}

async function checkTranslationBackend() {
  if (!appConfig.translationServiceUrl) {
    state.status = 'disabled';
    state.ready = false;
    return false;
  }

  state.lastCheckedAt = new Date().toISOString();
  try {
    const response = await fetch(languagesUrl(), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`translation backend probe failed: ${response.status}`);
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

function candidateCommands() {
  return [
    {
      command: 'libretranslate',
      args: ['--host', appConfig.translationHost, '--port', String(appConfig.translationPort)],
    },
    {
      command: 'python3',
      args: ['-m', 'libretranslate', '--host', appConfig.translationHost, '--port', String(appConfig.translationPort)],
    },
  ];
}

async function waitForReady(timeoutMs = appConfig.translationStartupTimeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkTranslationBackend()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function ensureTranslationBackend() {
  if (await checkTranslationBackend()) return getTranslationDiagnostics();

  if (
    appConfig.translationProvider !== 'libretranslate' ||
    !appConfig.translationAutostart ||
    !appConfig.translationServiceUrl
  ) {
    return getTranslationDiagnostics();
  }

  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    for (const candidate of candidateCommands()) {
      try {
        childProcess = spawn(candidate.command, candidate.args, {
          stdio: 'ignore',
          detached: false,
        });
        state.pid = childProcess.pid || null;
        state.launchCommand = [candidate.command, ...candidate.args].join(' ');
        state.startedByScholaxis = true;
        state.status = 'starting';

        childProcess.on('exit', (code, signal) => {
          state.ready = false;
          state.pid = null;
          state.status = 'stopped';
          state.lastError = `translation backend exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
          childProcess = null;
        });

        if (await waitForReady()) {
          launchPromise = null;
          return getTranslationDiagnostics();
        }
      } catch (error) {
        state.lastError = error.message;
      }
    }

    state.status = 'failed';
    launchPromise = null;
    return getTranslationDiagnostics();
  })();

  return launchPromise;
}

export function getTranslationDiagnostics() {
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
