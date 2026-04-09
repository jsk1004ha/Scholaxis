import { once } from 'node:events';
import { createServer } from '../src/server.mjs';

process.env.SCHOLAXIS_ADMIN_EMAILS = process.env.SCHOLAXIS_ADMIN_EMAILS || 'admin-smoke@example.com';

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function check(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`Smoke check failed for ${path}: ${response.status} ${body}`);
  return body;
}

const adminEmail = 'admin-smoke@example.com';
const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: adminEmail,
    password: 'test-password',
    displayName: 'Smoke Admin',
  }),
});
if (!registerResponse.ok) {
  throw new Error(`Smoke admin registration failed: ${registerResponse.status} ${await registerResponse.text()}`);
}
const adminCookie = registerResponse.headers.get('set-cookie');
if (!adminCookie) {
  throw new Error('Smoke admin registration did not return a session cookie');
}

await check('/api/health');
await check('/api/search?q=AI');
await check('/api/search/suggestions?q=배터리');
await check('/api/sources/status');
await check('/api/papers/paper:seed-paper-global-quantum');
await check('/api/papers/paper:seed-paper-global-quantum/citations');
await check('/api/papers/paper:seed-paper-global-quantum/references');
await check('/api/papers/paper:seed-paper-global-quantum/expand');
await check('/api/admin/infra', { headers: { cookie: adminCookie } });
await check('/api/admin/jobs', { headers: { cookie: adminCookie } });
await check('/api/similarity/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Smoke test document',
    text: 'knowledge graph retrieval multimodal vector similarity for scholarly search and citation ranking system'
  })
});
await check('/');

await closeServer(server);
console.log('Smoke checks passed.');
