import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appConfig } from './config.mjs';
import { buildDenseVector, cosineSimilarity } from './vector-service.mjs';

const storePath = path.resolve('.data/vector-service.json');

function readStore() {
  try {
    return JSON.parse(readFileSync(storePath, 'utf8'));
  } catch {
    return { documents: [] };
  }
}

function writeStore(store) {
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function createVectorBackendServer() {
  const store = readStore();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, documents: store.documents.length, dimensions: appConfig.vectorDimensions });
    }

    if (url.pathname === '/upsert' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const byId = new Map(store.documents.map((item) => [item.id, item]));
      for (const document of body.documents || []) {
        byId.set(document.id, document);
      }
      store.documents = [...byId.values()];
      writeStore(store);
      return json(res, 200, { ok: true, synced: (body.documents || []).length });
    }

    if (url.pathname === '/search' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const queryVector =
        body.queryVector ||
        buildDenseVector(body.query || '', body.dimensions || appConfig.vectorDimensions);
      const hits = store.documents
        .map((document) => ({
          id: document.id,
          score: cosineSimilarity(queryVector, document.vector || []),
          metadata: document.metadata || {}
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(body.limit || 12));
      return json(res, 200, { hits });
    }

    return json(res, 404, { error: 'not found' });
  });
}
