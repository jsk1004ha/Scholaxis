import { createHash } from 'node:crypto';
import { appConfig } from './config.mjs';
import { ensureLocalModelBackend, getLocalModelDiagnostics } from './local-model-runtime.mjs';
import {
  buildDenseVector,
  buildDocumentPassages,
  buildSparseVector,
  fitVectorDimensions,
  normalizeText,
  textBundle,
} from './vector-service.mjs';

const embeddingCache = new Map();
const PROVIDER_RETRY_WINDOW_MS = 5 * 60 * 1000;

const state = {
  provider: appConfig.embeddingProvider,
  ready: false,
  model: appConfig.embeddingModel,
  url: '',
  lastError: '',
  lastCheckedAt: null,
  cacheHits: 0,
  cacheMisses: 0,
  providerFailures: {
    'hybrid-local': 0,
    ollama: 0,
    http: 0,
  },
};

function cacheKey(provider = '', model = '', text = '') {
  return createHash('sha1').update(`${provider}:${model}:${String(text || '')}`).digest('hex');
}

function setProviderState(provider, model, url = '', ready = true, error = '') {
  state.provider = provider;
  state.model = model;
  state.url = url;
  state.ready = ready;
  state.lastError = error;
  state.lastCheckedAt = new Date().toISOString();
  if (provider in state.providerFailures && ready) {
    state.providerFailures[provider] = 0;
  }
}

function noteProviderFailure(provider, error) {
  if (provider in state.providerFailures) {
    state.providerFailures[provider] = Date.now();
  }
  state.ready = false;
  state.lastError = error?.message || String(error || provider);
  state.lastCheckedAt = new Date().toISOString();
}

function providerCoolingDown(provider) {
  const failedAt = state.providerFailures[provider] || 0;
  return failedAt && Date.now() - failedAt < PROVIDER_RETRY_WINDOW_MS;
}

function fallbackVector(text = '') {
  setProviderState('hash-projection', 'local-hash-projection', '', true, '');
  return buildDenseVector(text, appConfig.vectorDimensions);
}

async function postJson(url, body, timeoutMs = appConfig.modelRequestTimeoutMs) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`embedding-request-failed:${response.status}`);
  }
  return response.json();
}

function localModelEnabled() {
  return Boolean(appConfig.localModelServiceUrl) && (
    Boolean(process.env.SCHOLAXIS_LOCAL_MODEL_SERVICE_URL) ||
    appConfig.localModelAutostart ||
    appConfig.embeddingProvider === 'hybrid-local' ||
    appConfig.rerankerProvider === 'hybrid-local'
  );
}

function ollamaEnabled() {
  return Boolean(appConfig.ollamaUrl) && ['auto', 'ollama'].includes(appConfig.embeddingProvider);
}

function remoteEmbeddingEnabled() {
  return Boolean(appConfig.embeddingServiceUrl) && ['auto', 'http'].includes(appConfig.embeddingProvider);
}

function providerPlan() {
  if (appConfig.embeddingProvider === 'hybrid-local') return ['hybrid-local', 'fallback'];
  if (appConfig.embeddingProvider === 'ollama') return ['ollama', 'fallback'];
  if (appConfig.embeddingProvider === 'http') return ['http', 'fallback'];

  const plan = [];
  if (localModelEnabled()) plan.push('hybrid-local');
  if (ollamaEnabled()) plan.push('ollama');
  if (remoteEmbeddingEnabled()) plan.push('http');
  plan.push('fallback');
  return plan;
}

function currentModelForProvider(provider) {
  if (provider === 'hybrid-local') return appConfig.embeddingModel;
  if (provider === 'ollama') return appConfig.ollamaEmbeddingModel;
  if (provider === 'http') return appConfig.embeddingModel;
  return 'local-hash-projection';
}

async function embedManyWithLocalService(texts = []) {
  await ensureLocalModelBackend();
  const payload = await postJson(new URL('/embed', appConfig.localModelServiceUrl), {
    model: appConfig.embeddingModel,
    texts,
  }, 30000);
  const vectors = Array.isArray(payload.embeddings) ? payload.embeddings : [];
  if (vectors.length !== texts.length) {
    throw new Error(`local-embedding-count-mismatch:${vectors.length}/${texts.length}`);
  }
  setProviderState('hybrid-local', payload.model || appConfig.embeddingModel, appConfig.localModelServiceUrl, true, '');
  return vectors.map((vector) => fitVectorDimensions(vector, appConfig.vectorDimensions));
}

async function postOllamaEmbedding(pathname, body) {
  return postJson(new URL(pathname, appConfig.ollamaUrl), body, Math.min(appConfig.modelRequestTimeoutMs, 4000));
}

async function embedManyWithOllama(texts = []) {
  const vectors = [];
  for (const text of texts) {
    let payload;
    try {
      payload = await postOllamaEmbedding('/api/embed', {
        model: appConfig.ollamaEmbeddingModel,
        input: text,
        keep_alive: appConfig.ollamaKeepAlive,
      });
    } catch (error) {
      payload = await postOllamaEmbedding('/api/embeddings', {
        model: appConfig.ollamaEmbeddingModel,
        prompt: text,
        keep_alive: appConfig.ollamaKeepAlive,
      });
    }
    const vector = payload.embeddings?.[0] || payload.embedding || [];
    if (!Array.isArray(vector) || !vector.length) {
      throw new Error('ollama-embedding-empty');
    }
    vectors.push(fitVectorDimensions(vector, appConfig.vectorDimensions));
  }
  setProviderState('ollama', appConfig.ollamaEmbeddingModel, appConfig.ollamaUrl, true, '');
  return vectors;
}

async function embedManyWithRemoteService(texts = []) {
  const payload = await postJson(appConfig.embeddingServiceUrl, {
    model: appConfig.embeddingModel,
    input: texts,
    texts,
  });
  const vectors = Array.isArray(payload.embeddings)
    ? payload.embeddings
    : Array.isArray(payload.data)
      ? payload.data.map((entry) => entry.embedding || entry.vector || [])
      : [];
  if (vectors.length !== texts.length) {
    throw new Error(`remote-embedding-count-mismatch:${vectors.length}/${texts.length}`);
  }
  setProviderState('http', payload.model || appConfig.embeddingModel, appConfig.embeddingServiceUrl, true, '');
  return vectors.map((vector) => fitVectorDimensions(vector, appConfig.vectorDimensions));
}

async function resolveEmbeddings(texts = []) {
  for (const provider of providerPlan()) {
    if (provider === 'fallback') break;
    if (providerCoolingDown(provider)) continue;

    try {
      if (provider === 'hybrid-local') return await embedManyWithLocalService(texts);
      if (provider === 'ollama') return await embedManyWithOllama(texts);
      if (provider === 'http') return await embedManyWithRemoteService(texts);
    } catch (error) {
      noteProviderFailure(provider, error);
    }
  }

  return texts.map((text) => fallbackVector(text));
}

function combineVectors(vectors = [], weights = []) {
  const dimensions = appConfig.vectorDimensions;
  const combined = new Array(dimensions).fill(0);
  let totalWeight = 0;

  for (let index = 0; index < vectors.length; index += 1) {
    const vector = fitVectorDimensions(vectors[index] || [], dimensions);
    const weight = Number(weights[index] || 1);
    totalWeight += weight;
    for (let valueIndex = 0; valueIndex < dimensions; valueIndex += 1) {
      combined[valueIndex] += (vector[valueIndex] || 0) * weight;
    }
  }

  if (!totalWeight) return fallbackVector('');
  return fitVectorDimensions(combined.map((value) => value / totalWeight), dimensions);
}

export async function embedText(text = '') {
  const [vector] = await embedTexts([text]);
  return vector;
}

export async function embedTexts(texts = []) {
  if (!Array.isArray(texts) || !texts.length) return [];
  const normalizedTexts = texts.map((text) => normalizeText(text) || String(text || ''));
  const vectors = new Array(normalizedTexts.length);
  const missingIndexes = [];
  const missingTexts = [];

  const preferredProvider = state.ready ? state.provider : providerPlan()[0];
  const preferredModel = currentModelForProvider(preferredProvider);

  for (let index = 0; index < normalizedTexts.length; index += 1) {
    const normalized = normalizedTexts[index];
    const key = cacheKey(preferredProvider, preferredModel, normalized);
    if (preferredProvider && embeddingCache.has(key) && !(appConfig.embeddingProvider === 'auto' && preferredProvider === 'hash-projection')) {
      state.cacheHits += 1;
      vectors[index] = embeddingCache.get(key);
      continue;
    }
    state.cacheMisses += 1;
    missingIndexes.push(index);
    missingTexts.push(normalized);
  }

  if (missingTexts.length) {
    const resolved = await resolveEmbeddings(missingTexts);
    const actualProvider = state.provider;
    const actualModel = state.model;
    for (let index = 0; index < missingIndexes.length; index += 1) {
      const targetIndex = missingIndexes[index];
      const vector = fitVectorDimensions(resolved[index] || [], appConfig.vectorDimensions);
      vectors[targetIndex] = vector;
      embeddingCache.set(cacheKey(actualProvider, actualModel, normalizedTexts[targetIndex]), vector);
    }
  }

  return vectors.map((vector, index) => vector || fallbackVector(normalizedTexts[index]));
}

async function embedDocument(document = {}, dimensions = appConfig.vectorDimensions) {
  const passages = buildDocumentPassages(document, 320);
  if (!passages.length) {
    const text = textBundle(document);
    const vector = fitVectorDimensions(await embedText(text), dimensions);
    return {
      text,
      vector,
      sparseVector: buildSparseVector(text),
      searchText: normalizeText(text),
    };
  }

  const passageVectors = await embedTexts(passages.map((passage) => passage.text));
  const weights = passages.map((passage) => {
    switch (passage.label) {
      case 'title':
        return 2.8;
      case 'abstract':
        return 1.9;
      case 'summary':
        return 1.5;
      case 'keywords':
        return 1.35;
      case 'novelty':
        return 1.2;
      case 'methods':
        return 1.1;
      default:
        return 1;
    }
  });
  const combinedText = passages.map((passage) => passage.text).join(' ');
  return {
    text: combinedText,
    vector: fitVectorDimensions(combineVectors(passageVectors, weights), dimensions),
    sparseVector: buildSparseVector(combinedText),
    searchText: normalizeText(combinedText),
  };
}

export async function attachSemanticVectors(input, dimensions = appConfig.vectorDimensions) {
  const items = Array.isArray(input) ? input : [input];
  const enriched = [];

  for (const document of items) {
    const embedded = await embedDocument(document, dimensions);
    enriched.push({
      ...document,
      vector: embedded.vector,
      semanticVector: embedded.vector,
      sparseVector: embedded.sparseVector,
      searchText: embedded.searchText,
      embeddingProvider: state.provider,
      embeddingModel: state.model,
    });
  }

  return Array.isArray(input) ? enriched : enriched[0];
}

export function getEmbeddingDiagnostics() {
  return {
    provider: state.provider,
    ready: state.ready,
    model: state.model,
    url: state.url,
    configuredProvider: appConfig.embeddingProvider,
    configuredModel: appConfig.embeddingModel,
    configuredVectorDimensions: appConfig.vectorDimensions,
    lastError: state.lastError,
    lastCheckedAt: state.lastCheckedAt,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    providerFailures: state.providerFailures,
    localModels: getLocalModelDiagnostics(),
  };
}

export function clearEmbeddingCache() {
  embeddingCache.clear();
}
