import { appConfig } from './config.mjs';
import { buildDenseVector, cosineSimilarity } from './vector-service.mjs';

function normalizeVectorHit(hit = {}) {
  return {
    id: hit.id || hit.canonicalId,
    score: Number(hit.score || 0),
    backend: hit.backend || appConfig.vectorBackend,
  };
}

function localVectorSearch(query, documents = [], limit = 12) {
  const queryVector = buildDenseVector(query, appConfig.vectorDimensions);
  return documents
    .map((document) => ({
      id: document.canonicalId || document.id,
      score: cosineSimilarity(queryVector, document.vector || []),
      backend: 'local',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(normalizeVectorHit);
}

async function remoteJson(pathname, body) {
  const response = await fetch(new URL(pathname, appConfig.vectorServiceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`vector backend request failed: ${response.status}`);
  }
  return response.json();
}

export async function syncDocumentVectors(documents = []) {
  if (appConfig.vectorBackend !== 'http' || !appConfig.vectorServiceUrl) {
    return {
      backend: appConfig.vectorBackend,
      synced: documents.length,
      mode: appConfig.vectorBackend === 'pgvector' ? 'pgvector-compatible-export' : 'local-inline',
    };
  }

  try {
    const payload = await remoteJson('/upsert', {
      dimensions: appConfig.vectorDimensions,
      documents: documents.map((document) => ({
        id: document.canonicalId || document.id,
        vector: document.vector || [],
        metadata: {
          title: document.title,
          source: document.source,
          keywords: document.keywords || [],
        },
      })),
    });
    return {
      backend: 'http',
      synced: payload.synced || documents.length,
      mode: 'remote-http',
    };
  } catch (error) {
    return {
      backend: 'http',
      synced: 0,
      mode: 'remote-http-fallback',
      error: error.message,
    };
  }
}

export async function searchVectorCandidates({ query = '', documents = [], limit = 12 } = {}) {
  if (appConfig.vectorBackend === 'http' && appConfig.vectorServiceUrl) {
    try {
      const payload = await remoteJson('/search', {
        query,
        limit,
        dimensions: appConfig.vectorDimensions,
      });
      return (payload.hits || []).map((hit) => normalizeVectorHit({ ...hit, backend: 'http' }));
    } catch {
      return localVectorSearch(query, documents, limit);
    }
  }

  return localVectorSearch(query, documents, limit);
}

export function getVectorBackendDiagnostics() {
  return {
    backend: appConfig.vectorBackend,
    dimensions: appConfig.vectorDimensions,
    serviceUrl: appConfig.vectorServiceUrl || '',
    pgvectorReady: appConfig.vectorBackend === 'pgvector',
  };
}

export function toPgvectorLiteral(vector = []) {
  return `[${vector.map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
}
