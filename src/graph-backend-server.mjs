import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const storePath = path.resolve('.data/graph-service.json');

function readStore() {
  try {
    return JSON.parse(readFileSync(storePath, 'utf8'));
  } catch {
    return { edges: [] };
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

export function createGraphBackendServer() {
  const store = readStore();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, edges: store.edges.length });
    }

    if (url.pathname === '/upsert' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const dedup = new Map(store.edges.map((edge) => [`${edge.sourceId}:${edge.targetId}:${edge.edgeType}`, edge]));
      for (const edge of body.edges || []) {
        dedup.set(`${edge.sourceId}:${edge.targetId}:${edge.edgeType}`, edge);
      }
      store.edges = [...dedup.values()];
      writeStore(store);
      return json(res, 200, { ok: true, synced: (body.edges || []).length });
    }

    if (url.pathname === '/neighbors') {
      const node = url.searchParams.get('node');
      const limit = Number(url.searchParams.get('limit') || 12);
      const direction = url.searchParams.get('direction') || 'out';
      const edgeType = url.searchParams.get('edgeType') || '';
      const edges = store.edges
        .filter((edge) => {
          if (edgeType && edge.edgeType !== edgeType) return false;
          if (direction === 'in') return edge.targetId === node;
          return edge.sourceId === node;
        })
        .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
        .slice(0, limit);
      return json(res, 200, { edges });
    }

    return json(res, 404, { error: 'not found' });
  });
}
