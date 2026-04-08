import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from './config.mjs';
import { embedText } from './embedding-service.mjs';
import { cosineSimilarity } from './vector-service.mjs';

const execFileAsync = promisify(execFile);

function normalizeVectorHit(hit = {}) {
  return {
    id: hit.id || hit.canonicalId,
    score: Number(hit.score || 0),
    backend: hit.backend || appConfig.vectorBackend,
  };
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildPsqlArgs(sql) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql];
  if (process.env.DATABASE_URL) return [process.env.DATABASE_URL, ...args];
  return args;
}

async function runPsql(sql) {
  const { stdout } = await execFileAsync(process.env.PSQL_BIN || 'psql', buildPsqlArgs(sql), {
    env: process.env,
  });
  return stdout.trim();
}

async function localVectorSearch(query, documents = [], limit = 12, queryVector = null) {
  const resolvedQueryVector = Array.isArray(queryVector) && queryVector.length ? queryVector : await embedText(query);
  return documents
    .map((document) => ({
      id: document.canonicalId || document.id,
      score: cosineSimilarity(resolvedQueryVector, document.vector || []),
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

async function pgvectorSearch(query, documents = [], limit = 12, queryVector = null) {
  const ids = [...new Set(documents.map((document) => document.canonicalId || document.id).filter(Boolean))];
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGSERVICE) {
    return localVectorSearch(query, documents, limit, queryVector);
  }
  const resolvedQueryVector = Array.isArray(queryVector) && queryVector.length ? queryVector : await embedText(query);
  const vectorLiteral = '[' + resolvedQueryVector.map((value) => Number(value || 0).toFixed(6)).join(',') + ']';
  const where = [
    'embedding IS NOT NULL',
    ids.length ? `canonical_id IN (${ids.map((value) => sqlString(value)).join(', ')})` : ''
  ].filter(Boolean).join(' AND ');
  const sql = `
SELECT row_to_json(t)
FROM (
  WITH chunk_hits AS (
    SELECT
      canonical_id,
      MIN(embedding <=> ${sqlString(vectorLiteral)}::vector) AS distance
    FROM document_chunks
    WHERE ${where}
    GROUP BY canonical_id
  ),
  document_hits AS (
    SELECT
      canonical_id,
      embedding <=> ${sqlString(vectorLiteral)}::vector AS distance
    FROM documents
    WHERE ${where}
  ),
  merged AS (
    SELECT canonical_id, distance FROM chunk_hits
    UNION ALL
    SELECT canonical_id, distance FROM document_hits
  )
  SELECT
    canonical_id AS id,
    GREATEST(0, 1 - MIN(distance)) AS score
  FROM merged
  GROUP BY canonical_id
  ORDER BY MIN(distance)
  LIMIT ${Number(limit || 12)}
) t;`.trim();

  try {
    const output = await runPsql(sql);
    if (!output) return [];
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeVectorHit({ ...JSON.parse(line), backend: 'pgvector' }));
  } catch {
    return localVectorSearch(query, documents, limit, resolvedQueryVector);
  }
}

export async function syncDocumentVectors(documents = []) {
  if (appConfig.vectorBackend === 'pgvector') {
    return {
      backend: 'pgvector',
      synced: documents.length,
      mode: 'postgres-inline',
    };
  }

  if (appConfig.vectorBackend !== 'http' || !appConfig.vectorServiceUrl) {
    return {
      backend: appConfig.vectorBackend,
      synced: documents.length,
      mode: 'local-inline',
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

export async function searchVectorCandidates({ query = '', queryVector = null, documents = [], limit = 12 } = {}) {
  if (appConfig.vectorBackend === 'pgvector') {
    return pgvectorSearch(query, documents, limit, queryVector);
  }

  if (appConfig.vectorBackend === 'http' && appConfig.vectorServiceUrl) {
    try {
      const payload = await remoteJson('/search', {
        query,
        limit,
        dimensions: appConfig.vectorDimensions,
      });
      return (payload.hits || []).map((hit) => normalizeVectorHit({ ...hit, backend: 'http' }));
    } catch {
      return localVectorSearch(query, documents, limit, queryVector);
    }
  }

  return localVectorSearch(query, documents, limit, queryVector);
}

export function getVectorBackendDiagnostics() {
  return {
    backend: appConfig.vectorBackend,
    dimensions: appConfig.vectorDimensions,
    serviceUrl: appConfig.vectorServiceUrl || '',
    embeddingProvider: appConfig.embeddingProvider,
    pgvectorReady: appConfig.vectorBackend === 'pgvector',
  };
}

export function toPgvectorLiteral(vector = []) {
  return `[${vector.map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
}
