import { appConfig } from './config.mjs';
import { ensureLocalModelBackend, getLocalModelDiagnostics } from './local-model-runtime.mjs';

export async function ensureRerankerBackend() {
  if (appConfig.rerankerProvider === 'hybrid-local') {
    return ensureLocalModelBackend();
  }
  return getRerankerRuntimeDiagnostics();
}

export function getRerankerRuntimeDiagnostics() {
  if (appConfig.rerankerProvider === 'hybrid-local') {
    return getLocalModelDiagnostics();
  }
  return {
    provider: appConfig.rerankerProvider,
    serviceUrl: appConfig.rerankerServiceUrl,
    autostart: appConfig.rerankerAutostart,
    status: appConfig.rerankerServiceUrl ? 'configured' : 'disabled',
    ready: Boolean(appConfig.rerankerServiceUrl),
    pid: null,
    startedByScholaxis: false,
    launchCommand: '',
    lastError: '',
    lastCheckedAt: null,
  };
}
