import { once } from 'node:events';
import { createServer } from '../src/server.mjs';

const server = createServer();
server.listen(0);
await once(server, 'listening');

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function check(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`Smoke check failed for ${path}: ${response.status} ${body}`);
  return body;
}

await check('/api/health');
await check('/api/search?q=AI');
await check('/api/search/suggestions?q=배터리');
await check('/api/sources/status');
await check('/api/papers/paper:seed-paper-global-quantum');
await check('/api/papers/paper:seed-paper-global-quantum/expand');
await check('/api/similarity/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Smoke test document',
    text: 'knowledge graph retrieval multimodal vector similarity for scholarly search and citation ranking system'
  })
});
await check('/');

server.close();
console.log('Smoke checks passed.');
