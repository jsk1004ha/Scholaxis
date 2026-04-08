import { createHash } from 'node:crypto';
import { appConfig } from './config.mjs';
import { ensureLocalModelBackend, getLocalModelDiagnostics } from './local-model-runtime.mjs';
import { buildDenseVector, cosineSimilarity, normalizeText, sparseOverlapScore, textBundle } from './vector-service.mjs';

const embeddingCache = new Map();

function cacheKey(text = '') {
  return createHash('sha1').update(String(text || '')).digest('hex');
}

function serviceEnabled() {
  return (
    appConfig.embeddingProvider === 'hybrid-local' &&
    Boolean(process.env.SCHOLAXIS_LOCAL_MODEL_SERVICE_URL || appConfig.localModelAutostart)
  );
}

async function requestJson(pathname, body) {
  const response = await fetch(new URL(pathname, appConfig.localModelServiceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`local model request failed: ${response.status}`);
  }
  return response.json();
}

function fallbackVector(text = '') {
  return buildDenseVector(text, appConfig.vectorDimensions);
}

export async function getEmbedding(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return fallbackVector('');
  const key = cacheKey(normalized);
  if (embeddingCache.has(key)) return embeddingCache.get(key);

  if (serviceEnabled()) {
    try {
      await ensureLocalModelBackend();
      const payload = await requestJson('/embed', {
        texts: [normalized],
        model: appConfig.embeddingModel,
      });
      const vector = payload.embeddings?.[0] || payload.embedding || [];
      if (Array.isArray(vector) && vector.length) {
        embeddingCache.set(key, vector);
        return vector;
      }
    } catch {
      // fall back below
    }
  }

  const vector = fallbackVector(normalized);
  embeddingCache.set(key, vector);
  return vector;
}

export async function getEmbeddings(texts = []) {
  const values = texts.map((text) => normalizeText(text));
  const vectors = new Array(values.length);
  const missingIndexes = [];
  const missingTexts = [];

  values.forEach((text, index) => {
    const key = cacheKey(text);
    if (embeddingCache.has(key)) {
      vectors[index] = embeddingCache.get(key);
    } else if (text) {
      missingIndexes.push(index);
      missingTexts.push(text);
    } else {
      vectors[index] = fallbackVector('');
    }
  });

  if (missingTexts.length && serviceEnabled()) {
    try {
      await ensureLocalModelBackend();
      const payload = await requestJson('/embed', {
        texts: missingTexts,
        model: appConfig.embeddingModel,
      });
      const embeds = payload.embeddings || [];
      if (embeds.length === missingTexts.length) {
        missingIndexes.forEach((targetIndex, embedIndex) => {
          const vector = embeds[embedIndex];
          vectors[targetIndex] = vector;
          embeddingCache.set(cacheKey(values[targetIndex]), vector);
        });
      }
    } catch {
      // fill with fallback below
    }
  }

  missingIndexes.forEach((targetIndex) => {
    if (!vectors[targetIndex]) {
      const vector = fallbackVector(values[targetIndex]);
      vectors[targetIndex] = vector;
      embeddingCache.set(cacheKey(values[targetIndex]), vector);
    }
  });

  return vectors;
}

export async function attachSemanticVectors(documents = []) {
  const texts = documents.map((document) => textBundle(document));
  const vectors = await getEmbeddings(texts);
  return documents.map((document, index) => ({
    ...document,
    vector: vectors[index],
    semanticVector: vectors[index],
    searchText: normalizeText(texts[index])
  }));
}

export async function semanticSimilarity(query = '', document = {}) {
  const [queryVector] = await getEmbeddings([query]);
  const documentVector = document.semanticVector || document.vector || (await getEmbedding(textBundle(document)));
  const sparse = sparseOverlapScore(document.sparseVector || {}, {});
  return {
    dense: cosineSimilarity(queryVector, documentVector),
    sparse,
    vector: queryVector,
  };
}

export function getSemanticDiagnostics() {
  return {
    provider: appConfig.embeddingProvider,
    model: appConfig.embeddingModel,
    cacheEntries: embeddingCache.size,
    localModel: getLocalModelDiagnostics(),
  };
}
