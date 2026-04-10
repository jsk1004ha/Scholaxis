import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Blob } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, startServer } from '../src/server.mjs';
import { appConfig } from '../src/config.mjs';
import { createGraphBackendServer } from '../src/graph-backend-server.mjs';
import { buildPostgresMigrationSql } from '../src/postgres-migration.mjs';
import { getPostgresSchemaSql, getPostgresSeriousUsePathDiagnostics } from '../src/postgres-store.mjs';
import { createRerankerBackendServer } from '../src/reranker-backend-server.mjs';
import { createVectorBackendServer } from '../src/vector-backend-server.mjs';
import { extractHwpText, extractHwpxText } from '../src/hwp-text-extractor.mjs';
import { normalizeSearchQuery, toUiPaperShape } from '../public/api.js';
import { buildCrossLingualQueryContext, classifyQueryProfile, expandQueryVariants, hasBrokenEncoding, isUsableSearchText, looksLikeNoise } from '../src/source-helpers.mjs';
import { getSourceRuntimeDiagnostics, searchLiveSources, sourceRegistrySummary } from '../src/source-adapters.mjs';
import { extractPdfTextWithOcr } from '../src/ocr-service.mjs';
import {
  extractBlackHatDocumentsFromHtml,
  extractCveDocumentsFromPayload,
  extractDefconDocumentsFromHtml,
  extractKciDocumentsFromHtml,
  extractKissDocumentsFromHtml,
  extractNanetDocumentsFromHtml,
  extractNtisDocumentsFromHtml,
  extractPreprintDocumentsFromHtml,
  extractPubMedDocumentsFromXml,
  extractRneReportDocumentsFromHtml,
  extractScienceGoDocumentsFromHtml
} from '../src/source-adapters.mjs';
import { dedupeDocuments } from '../src/dedup-service.mjs';
import { extractPdfText } from '../src/pdf-text-extractor.mjs';
import { extractDocxText } from '../src/docx-text-extractor.mjs';
import { persistDocuments } from '../src/storage.mjs';
import { buildDenseVector, cosineSimilarity } from '../src/vector-service.mjs';
import { rankSourcesByProfile, splitSourcesForCrossLingual } from '../src/search-service.mjs';

async function startTestServer() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function startStandaloneServer(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function waitForListening(server, timeoutMs = 2000) {
  if (server.listening) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for server listening after ${timeoutMs}ms`));
    }, timeoutMs);

    function onListening() {
      cleanup();
      resolve();
    }

    function cleanup() {
      clearTimeout(timer);
      server.off('listening', onListening);
    }

    server.on('listening', onListening);
  });
}

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



async function sampleDocxBuffer() {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX world</w:t></w:r></w:p></w:body></w:document>`;
  const py = [
    'import io, zipfile, sys',
    `xml = ${JSON.stringify(xml)}`,
    'buf = io.BytesIO()',
    "with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:",
    `    zf.writestr('[Content_Types].xml', ${JSON.stringify('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')})`,
    `    zf.writestr('_rels/.rels', ${JSON.stringify('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')})`,
    "    zf.writestr('word/document.xml', xml)",
    'sys.stdout.buffer.write(buf.getvalue())'
  ].join('\n');
  const { execFileSync } = await import('node:child_process');
  return execFileSync('python3', ['-c', py]);
}

async function sampleHwpxBuffer() {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>안녕하세요 HWPX 세계</hp:t></hp:run></hp:p>
</hp:section>`;
  const py = [
    'import io, zipfile, sys',
    `xml = ${JSON.stringify(xml)}`,
    'buf = io.BytesIO()',
    "with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:",
    "    zf.writestr('Contents/section0.xml', xml)",
    "    zf.writestr('mimetype', 'application/haansofthwpx')",
    'sys.stdout.buffer.write(buf.getvalue())',
  ].join('\n');
  const { execFileSync } = await import('node:child_process');
  return execFileSync('python3', ['-c', py]);
}

async function sampleStructuredHwpxBuffer() {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>연구 배경</hp:t></hp:run></hp:p>
  <hp:tbl>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>값</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>정확도</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>92%</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
  </hp:tbl>
  <hp:p><hp:run><hp:t>결론</hp:t></hp:run></hp:p>
</hp:section>`;
  const py = [
    'import io, zipfile, sys',
    `xml = ${JSON.stringify(xml)}`,
    'buf = io.BytesIO()',
    "with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:",
    "    zf.writestr('Contents/section0.xml', xml)",
    "    zf.writestr('mimetype', 'application/haansofthwpx')",
    'sys.stdout.buffer.write(buf.getvalue())',
  ].join('\n');
  const { execFileSync } = await import('node:child_process');
  return execFileSync('python3', ['-c', py]);
}

function samplePdfBuffer(text = 'Hello PDF world') {
  const escaped = String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\n', '\\n');
  const stream = `BT\n/F1 12 Tf\n72 72 Td\n(${escaped}) Tj\nET`;
  const length = Buffer.byteLength(stream, 'latin1');
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${length} >>\nstream\n${stream}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`,
    'latin1'
  );
}

function runIsolatedSearchQueries(queries = []) {
  const dbPath = path.join(tmpdir(), `scholaxis-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const script = `
    import { searchCatalog } from './src/search-service.mjs';
    const queries = ${JSON.stringify(queries)};
    const output = [];
    for (const query of queries) {
      const result = await searchCatalog({ q: query, autoLive: false, live: false, forceRefresh: false });
      output.push({
        query,
        total: result.total,
        fallbackMode: result.fallbackMode,
        items: result.items.slice(0, 5).map((item) => ({
          canonicalId: item.canonicalId,
          sourceKey: item.sourceKey,
          type: item.type,
          title: item.title
        }))
      });
    }
    process.stdout.write(JSON.stringify(output));
  `;

  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(process.cwd()),
    env: {
      ...process.env,
      SCHOLAXIS_DB_PATH: dbPath,
      SCHOLAXIS_EMBEDDING_PROVIDER: 'hash',
      SCHOLAXIS_RERANKER_PROVIDER: 'heuristic',
      SCHOLAXIS_LOCAL_MODEL_AUTOSTART: '0',
    },
    encoding: 'utf8',
  });

  return JSON.parse(stdout.trim().split('\n').at(-1) || '[]');
}

test('health endpoint returns ok', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(payload.runtime);
  assert.ok(payload.runtime.ocr);
  assert.ok(payload.runtime.sourceRuntime);
  assert.ok(payload.runtime.storage);
  await closeServer(server);
});

test('startServer falls back to the next port when requested port is already occupied', async () => {
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const occupiedPort = blocker.address().port;

  const server = startServer(occupiedPort, '127.0.0.1', { maxFallbackAttempts: 3 });
  await waitForListening(server);
  const address = server.address();
  assert.notEqual(address.port, occupiedPort);

  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  await closeServer(server);
  await closeServer(blocker);
});



test('cache clear endpoint responds with diagnostics', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/cache/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'dbpia', query: '배터리 AI' })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(payload.runtime.cache || payload.runtime);
  await closeServer(server);
});

test('sources status endpoint exposes cache/runtime diagnostics', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/sources/status`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.sources));
  assert.ok(payload.sources.length >= 1);
  assert.ok(payload.runtime.cache);
  assert.equal(typeof payload.runtime.cache.entries, 'number');
  assert.equal(typeof payload.runtime.cache.ttlMs, 'number');
  assert.ok(payload.runtime.storage);
  await closeServer(server);
});

test('storage stats endpoint returns sqlite diagnostics', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/storage/stats`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ready, true);
  assert.ok(payload.dbPath);
  await closeServer(server);
});

test('auth and library flow works end-to-end', async () => {
  const { server, baseUrl } = await startTestServer();
  const email = `user-${Date.now()}@example.com`;
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'test-password',
      displayName: 'Tester',
    }),
  });
  const registerPayload = await registerResponse.json();
  assert.equal(registerResponse.status, 200);
  const cookie = registerResponse.headers.get('set-cookie');
  assert.ok(cookie);
  assert.equal(registerPayload.ok, true);

  const libraryAddResponse = await fetch(`${baseUrl}/api/library`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      canonicalId: 'paper:seed-paper-global-quantum',
      note: 'important',
      highlights: ['핵심 주장', '실험 포인트'],
      share: true,
    }),
  });
  const libraryAddPayload = await libraryAddResponse.json();
  assert.equal(libraryAddResponse.status, 200);
  assert.equal(libraryAddPayload.ok, true);
  assert.ok(libraryAddPayload.items.length > 0);

  const savedSearchResponse = await fetch(`${baseUrl}/api/saved-searches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      label: '배터리 검색',
      queryText: '배터리 AI',
      filters: { region: 'domestic' },
      alertEnabled: true,
      alertFrequency: 'weekly',
    }),
  });
  const savedSearchPayload = await savedSearchResponse.json();
  assert.equal(savedSearchResponse.status, 200);
  assert.equal(savedSearchPayload.ok, true);
  assert.ok(savedSearchPayload.searches.length > 0);
  assert.deepEqual(savedSearchPayload.searches[0].filters, { region: 'domestic' });
  assert.ok(savedSearchPayload.searches[0].createdAt);

  const libraryResponse = await fetch(`${baseUrl}/api/library`, {
    headers: { cookie },
  });
  const libraryPayload = await libraryResponse.json();
  assert.equal(libraryResponse.status, 200);
  assert.equal(libraryPayload.items[0].note, 'important');
  assert.deepEqual(libraryPayload.items[0].highlights, ['핵심 주장', '실험 포인트']);
  assert.ok(libraryPayload.items[0].shareToken);
  assert.ok(libraryPayload.items[0].createdAt);
  assert.equal(libraryPayload.items[0].title, 'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval');
  assert.equal(libraryPayload.items[0].source, 'arxiv');
  assert.equal(libraryPayload.items[0].sourceType, 'paper');
  assert.ok(libraryPayload.items[0].originalUrl);

  const sharedLibraryResponse = await fetch(`${baseUrl}/api/library/shared/${libraryPayload.items[0].shareToken}`);
  const sharedLibraryPayload = await sharedLibraryResponse.json();
  assert.equal(sharedLibraryResponse.status, 200);
  assert.equal(sharedLibraryPayload.item.canonicalId, 'paper:seed-paper-global-quantum');
  assert.equal(sharedLibraryPayload.item.title, 'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval');

  const savedSearchListResponse = await fetch(`${baseUrl}/api/saved-searches`, {
    headers: { cookie },
  });
  const savedSearchListPayload = await savedSearchListResponse.json();
  assert.equal(savedSearchListResponse.status, 200);
  assert.equal(savedSearchListPayload.searches[0].label, '배터리 검색');
  assert.deepEqual(savedSearchListPayload.searches[0].filters, { region: 'domestic' });
  assert.equal(savedSearchListPayload.searches[0].alertEnabled, true);
  assert.equal(savedSearchListPayload.searches[0].alertFrequency, 'weekly');

  const deleteSavedSearchResponse = await fetch(
    `${baseUrl}/api/saved-searches/${savedSearchListPayload.searches[0].id}`,
    {
      method: 'DELETE',
      headers: { cookie },
    }
  );
  const deleteSavedSearchPayload = await deleteSavedSearchResponse.json();
  assert.equal(deleteSavedSearchResponse.status, 200);
  assert.deepEqual(deleteSavedSearchPayload.searches, []);

  const deleteLibraryResponse = await fetch(
    `${baseUrl}/api/library/${encodeURIComponent('paper:seed-paper-global-quantum')}`,
    {
      method: 'DELETE',
      headers: { cookie },
    }
  );
  const deleteLibraryPayload = await deleteLibraryResponse.json();
  assert.equal(deleteLibraryResponse.status, 200);
  assert.deepEqual(deleteLibraryPayload.items, []);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  const mePayload = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.user.email, email);

  await closeServer(server);
});

test('auth login/logout endpoints rotate session state cleanly', async () => {
  const { server, baseUrl } = await startTestServer();
  const email = `login-${Date.now()}@example.com`;
  const password = 'test-password';

  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      displayName: 'Login Tester',
    }),
  });
  const cookie = registerResponse.headers.get('set-cookie');
  assert.ok(cookie);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  });
  const logoutPayload = await logoutResponse.json();
  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutPayload.ok, true);
  assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/);

  const loggedOutMeResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  const loggedOutMePayload = await loggedOutMeResponse.json();
  assert.equal(loggedOutMeResponse.status, 200);
  assert.equal(loggedOutMePayload.user, null);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginPayload = await loginResponse.json();
  const loginCookie = loginResponse.headers.get('set-cookie');
  assert.equal(loginResponse.status, 200);
  assert.equal(loginPayload.ok, true);
  assert.ok(loginCookie);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: loginCookie },
  });
  const mePayload = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.user.email, email);

  await closeServer(server);
});

test('profile endpoint saves user preferences', async () => {
  const { server, baseUrl } = await startTestServer();
  const email = `profile-${Date.now()}@example.com`;
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'test-password',
      displayName: 'Profile Tester',
    }),
  });
  const cookie = registerResponse.headers.get('set-cookie');
  assert.ok(cookie);

  const updateResponse = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      displayName: 'Updated Tester',
      researchInterests: ['OCR', '추천 시스템'],
      preferredSources: ['kci', 'dbpia'],
      defaultRegion: 'domestic',
      alertOptIn: true,
      crossLanguageOptIn: true,
    }),
  });
  const updatePayload = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.ok, true);
  assert.equal(updatePayload.profile.displayName, 'Updated Tester');
  assert.deepEqual(updatePayload.profile.preferredSources, ['kci', 'dbpia']);

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    headers: { cookie },
  });
  const profilePayload = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profilePayload.profile.defaultRegion, 'domestic');
  assert.equal(profilePayload.profile.alertOptIn, true);
  assert.equal(profilePayload.profile.crossLanguageOptIn, true);
  assert.deepEqual(profilePayload.profile.researchInterests, ['OCR', '추천 시스템']);

  await closeServer(server);
});



test('recommendations endpoint returns data', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/recommendations`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.recommendations));
  assert.ok(payload.recommendations[0].recommendationScore >= payload.recommendations.at(-1).recommendationScore);
  assert.ok(payload.recommendations[0].recommendationRationale);
  assert.ok(payload.recommendations[0].recommendationRationale.sourceGrounding);
  assert.equal(typeof payload.recommendations[0].recommendationRationale.sourceGrounding.evidenceCount, 'number');
  assert.ok(Array.isArray(payload.recommendations[0].recommendationRationale.sourceGrounding.graphSignals));
  await closeServer(server);
});

test('personalized recommendation feed uses profile and library context', async () => {
  const { server, baseUrl } = await startTestServer();
  const email = `feed-${Date.now()}@example.com`;
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password', displayName: 'Feed Tester' }),
  });
  const cookie = registerResponse.headers.get('set-cookie');
  assert.ok(cookie);

  await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      researchInterests: ['graph', 'battery'],
      preferredSources: ['semantic_scholar'],
      defaultRegion: 'global',
      crossLanguageOptIn: true,
    }),
  });

  await fetch(`${baseUrl}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ canonicalId: 'paper:seed-paper-global-quantum', note: 'seed library item' }),
  });

  const response = await fetch(`${baseUrl}/api/recommendations/feed`, {
    headers: { cookie },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.ok(Array.isArray(payload.items[0].explanation));
  await closeServer(server);
});

test('citations and references endpoints return graph-backed expansions', async () => {
  const { server, baseUrl } = await startTestServer();
  await fetch(`${baseUrl}/api/search?q=knowledge graph&sort=relevance`);

  const citationsResponse = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/citations`);
  const citationsPayload = await citationsResponse.json();
  assert.equal(citationsResponse.status, 200);
  assert.ok(Array.isArray(citationsPayload.citations));

  const referencesResponse = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/references`);
  const referencesPayload = await referencesResponse.json();
  assert.equal(referencesResponse.status, 200);
  assert.ok(Array.isArray(referencesPayload.references));

  await closeServer(server);
});

test('graph and postgres migration endpoints expose expected payload formats', async () => {
  process.env.SCHOLAXIS_ADMIN_EMAILS = 'admin@example.com';
  const { server, baseUrl } = await startTestServer();
  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'test-password', displayName: 'Admin' }),
    });
    const cookie = registerResponse.headers.get('set-cookie');
    assert.ok(cookie);

    const graphResponse = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/graph`);
    const graphPayload = await graphResponse.json();
    assert.equal(graphResponse.status, 200);
    assert.ok(graphPayload.graph);
    assert.ok(Array.isArray(graphPayload.graph.references));
    assert.ok(graphPayload.graph.references.length >= 1);
    assert.equal(graphPayload.graph.references[0].sourceId, 'paper:seed-paper-global-quantum');

    const expansionResponse = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/expand`);
    const expansionPayload = await expansionResponse.json();
    assert.equal(expansionResponse.status, 200);
    assert.ok(Array.isArray(expansionPayload.expansion.recommendations));
    assert.ok(expansionPayload.expansion.recommendations.length >= 1);
    assert.ok(expansionPayload.expansion.graphNarrative);
    assert.ok(Array.isArray(expansionPayload.expansion.comparisonMatrix));

    const migrationResponse = await fetch(`${baseUrl}/api/admin/postgres-migration`, { headers: { cookie } });
    const migrationText = await migrationResponse.text();
    assert.equal(migrationResponse.status, 200);
    assert.match(migrationResponse.headers.get('content-type') || '', /^text\/plain/);
    assert.equal(migrationText, buildPostgresMigrationSql());
  } finally {
    delete process.env.SCHOLAXIS_ADMIN_EMAILS;
    await closeServer(server);
  }
});

test('admin summary endpoint returns runtime and recent requests', async () => {
  const adminEmail = `admin-summary-${Date.now()}@example.com`;
  process.env.SCHOLAXIS_ADMIN_EMAILS = adminEmail;
  const { server, baseUrl } = await startTestServer();
  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'test-password', displayName: 'Admin' }),
    });
    const cookie = registerResponse.headers.get('set-cookie');
    assert.ok(cookie);

    const response = await fetch(`${baseUrl}/api/admin/summary`, { headers: { cookie } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.ok(payload.storage);
    assert.ok(payload.runtime);
    assert.ok(payload.runtime.analysis);
    assert.equal(typeof payload.runtime.analysis.poolSize, 'number');
    assert.ok(Array.isArray(payload.recentRequests));
  } finally {
    delete process.env.SCHOLAXIS_ADMIN_EMAILS;
    await closeServer(server);
  }
});

test('admin ops endpoint returns startup, alerts, and similarity runs', async () => {
  const adminEmail = `admin-ops-${Date.now()}@example.com`;
  process.env.SCHOLAXIS_ADMIN_EMAILS = adminEmail;
  const { server, baseUrl } = await startTestServer();
  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'test-password', displayName: 'Admin' }),
    });
    const cookie = registerResponse.headers.get('set-cookie');
    assert.ok(cookie);

    await fetch(`${baseUrl}/api/similarity/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '운영 대시보드 샘플',
        text: '운영 대시보드에서 최근 유사도 실행 이력을 확인하기 위한 샘플 문서입니다.',
      }),
    });

    const response = await fetch(`${baseUrl}/api/admin/ops`, { headers: { cookie } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.startup.host, process.env.HOST || '127.0.0.1');
    assert.ok(Array.isArray(payload.alerts));
    assert.ok(Array.isArray(payload.recentRequests));
    assert.ok(Array.isArray(payload.recentSimilarityRuns));
    assert.ok(payload.recentSimilarityRuns.length >= 1);
    assert.ok(payload.runtime.sourceRuntime);
    assert.ok(payload.runtime.sourceRuntime.cache);
    assert.equal(typeof payload.runtime.sourceRuntime.cache.entries, 'number');
    assert.ok(payload.runtime.postgres);
    assert.ok(payload.runtime.vectorBackend);
    assert.ok(payload.runtime.graphBackend);
    assert.ok(payload.runtime.analysis);
    assert.equal(typeof payload.runtime.analysis.workerCount, 'number');
    assert.equal(typeof payload.runtime.analysis.asyncJobs.total, 'number');
    assert.ok(payload.runtime.parserMonitor);
    assert.ok(payload.runtime.worker);
    assert.ok(Array.isArray(payload.jobs));
  } finally {
    delete process.env.SCHOLAXIS_ADMIN_EMAILS;
    await closeServer(server);
  }
});

test('admin infra and jobs endpoints expose search infrastructure controls', async () => {
  const adminEmail = `admin-infra-${Date.now()}@example.com`;
  process.env.SCHOLAXIS_ADMIN_EMAILS = adminEmail;
  const { server, baseUrl } = await startTestServer();
  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'test-password', displayName: 'Admin' }),
    });
    const cookie = registerResponse.headers.get('set-cookie');
    assert.ok(cookie);

    const infraResponse = await fetch(`${baseUrl}/api/admin/infra`, { headers: { cookie } });
    const infraPayload = await infraResponse.json();
    assert.equal(infraResponse.status, 200);
    assert.equal(infraPayload.storageBackend, process.env.SCHOLAXIS_STORAGE_BACKEND || 'sqlite');
    assert.ok(infraPayload.vectorBackend);
    assert.ok(infraPayload.graphBackend);
    assert.ok(infraPayload.seriousUsePath);
    assert.equal(infraPayload.seriousUsePath.recommended.storageBackend, 'postgres');
    assert.equal(infraPayload.seriousUsePath.recommended.vectorBackend, 'pgvector');
    assert.equal(infraPayload.seriousUsePath.validationCommand, 'npm run validate:postgres');
    assert.equal(infraPayload.postgres.seriousUsePath.validationCommand, 'npm run validate:postgres');
    assert.match(infraPayload.postgresMigrationPreview, /CREATE EXTENSION IF NOT EXISTS vector/);

    const scheduleResponse = await fetch(`${baseUrl}/api/admin/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ action: 'schedule-defaults' }),
    });
    const schedulePayload = await scheduleResponse.json();
    assert.equal(scheduleResponse.status, 200);
    assert.ok(Array.isArray(schedulePayload.jobs));
    assert.ok(schedulePayload.jobs.length >= 1);
    assert.ok(schedulePayload.jobs.some((job) => job.jobType === 'source-health-check'));

    const jobsResponse = await fetch(`${baseUrl}/api/admin/jobs`, { headers: { cookie } });
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsResponse.status, 200);
    assert.ok(Array.isArray(jobsPayload.jobs));
    assert.ok(jobsPayload.jobs.length >= 1);
  } finally {
    delete process.env.SCHOLAXIS_ADMIN_EMAILS;
    await closeServer(server);
  }
});

test('admin endpoints reject unauthenticated and non-admin users', async () => {
  process.env.SCHOLAXIS_ADMIN_EMAILS = 'admin@example.com';
  const { server, baseUrl } = await startTestServer();
  try {
    const anonymousResponse = await fetch(`${baseUrl}/api/admin/summary`);
    const anonymousPayload = await anonymousResponse.json();
    assert.equal(anonymousResponse.status, 401);
    assert.match(anonymousPayload.error, /로그인/);

    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'test-password', displayName: 'User' }),
    });
    const cookie = registerResponse.headers.get('set-cookie');
    assert.ok(cookie);

    const userResponse = await fetch(`${baseUrl}/api/admin/summary`, { headers: { cookie } });
    const userPayload = await userResponse.json();
    assert.equal(userResponse.status, 403);
    assert.match(userPayload.error, /관리자/);

    const adminPageResponse = await fetch(`${baseUrl}/admin.html`, { redirect: 'manual' });
    assert.equal(adminPageResponse.status, 302);
    assert.equal(adminPageResponse.headers.get('location'), '/index.html');
  } finally {
    delete process.env.SCHOLAXIS_ADMIN_EMAILS;
    await closeServer(server);
  }
});

test('search stream endpoint emits summary, progress, results, and done events', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search/stream?q=배터리%20AI&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /event: summary/);
  assert.match(text, /event: progress/);
  assert.match(text, /event: results/);
  assert.match(text, /event: done/);
  await closeServer(server);
});

test('search endpoint returns canonicalized Korean-first research results', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=배터리 AI&region=domestic&sourceType=paper&sort=relevance`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.filters.region, 'domestic');
  assert.ok(payload.results[0].id);
  assert.equal(payload.reranking.applied, true);
  assert.ok(['heuristic', 'http', 'hybrid-local', 'ollama'].includes(payload.reranking.backend));
  assert.equal(payload.crossLingual.enabled, false);
  assert.ok(payload.canonicalCount >= 1);
  await closeServer(server);
});

test('search endpoint returns a relevant science fair result for 자기진자 queries', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=자기진자&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.items.some((item) => item.sourceKey === 'science_fair' && /자석진자/.test(item.title)));
  await closeServer(server);
});

test('search endpoint keeps 자석진자 queries on relevant fair-entry results', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=자석진자&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.items.some((item) => item.sourceKey === 'science_fair' && /자석진자/.test(item.title)));
  await closeServer(server);
});

test('fair-entry search results can open detail expansion successfully', async () => {
  const { server, baseUrl } = await startTestServer();
  const searchResponse = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent('자기진자 전람회')}&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const searchPayload = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  const fairEntry = searchPayload.items.find((item) => item.sourceKey === 'science_fair');
  assert.ok(fairEntry?.id || fairEntry?.canonicalId);

  const detailResponse = await fetch(`${baseUrl}/api/papers/${encodeURIComponent(fairEntry.id || fairEntry.canonicalId)}/expand`);
  const detailPayload = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.match(detailPayload.paper?.title || '', /자석진자/);
  await closeServer(server);
});

test('search endpoint rejects generic multi-term semantic collisions', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=%EC%96%91%EC%9E%90%20%EC%95%94%ED%98%B8&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  if (payload.total > 0) {
    assert.equal(payload.fallbackMode, 'exploratory');
  }
  await closeServer(server);
});

test('detail endpoint returns related materials and alternate source metadata', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.id || payload.canonicalId);
  assert.ok(payload.related.length > 0);
  assert.ok(Array.isArray(payload.citations));
  assert.ok(Array.isArray(payload.references));
  assert.ok(payload.sourceLinks);
  assert.ok(payload.sourceLinks.original || payload.sourceLinks.detail);
  assert.ok(payload.explanation);
  assert.ok(Array.isArray(payload.explanation.whyItMatters));
  assert.ok(Array.isArray(payload.explanation.evidenceTrail));
  assert.ok(payload.explanation.evidenceTrail.length >= 1);
  assert.ok(Array.isArray(payload.recommendations));
  assert.ok(payload.metrics.alternateSourceCount >= 1);
  assert.ok(payload.metrics.references >= 0);
  assert.ok(Array.isArray(payload.graphPaths));
  assert.ok(payload.graphPaths.length >= 1);
  assert.ok(payload.detailHealth);
  assert.ok(['healthy', 'degraded', 'unavailable'].includes(payload.detailHealth.status));
  assert.ok(Array.isArray(payload.detailHealth.metadata));
  assert.ok(Array.isArray(payload.detailHealth.links));
  assert.ok(Array.isArray(payload.detailHealth.sections));
  assert.ok(payload.detailHealth.sections.some((section) => section.key === 'graph'));
  await closeServer(server);
});

test('detail expansion endpoint returns graph narrative and comparison matrix', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/expand`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.paper);
  assert.ok(payload.expansion);
  assert.ok(Array.isArray(payload.expansion.recommendations));
  assert.ok(Array.isArray(payload.expansion.comparisonMatrix));
  assert.ok(Array.isArray(payload.expansion.graph?.references));
  assert.equal(typeof payload.expansion.graphNarrative?.summary, 'string');
  assert.ok(Array.isArray(payload.expansion.graphNarrative?.evidenceTrail));
  assert.ok(payload.expansion.graphNarrative.evidenceTrail.length >= 1);
  assert.ok(payload.expansion.detailHealth);
  assert.ok(Array.isArray(payload.expansion.detailHealth.warnings));
  assert.ok(payload.expansion.detailHealth.sections.some((section) => section.key === 'recommendations'));
  await closeServer(server);
});

test('similarity report returns matches and recommendations', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/similarity/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '배터리 AI 초안',
      text: `서론
배터리 열폭주 예측과 센서융합 딥러닝 기반 진단을 통해 생산 설비 안전성과 예측정비 전략을 강화하는 연구 초안입니다.

방법
멀티모달 센서와 적외선 영상을 함께 사용하고, 그래프 특징과 transformer 기반 분류기를 결합합니다.

결과
기존 대비 조기 탐지 성능을 높이고 실시간 알림 정확도를 향상합니다.`
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.topMatches.length > 0);
  assert.ok(payload.recommendations.length > 0);
  assert.ok(Array.isArray(payload.sectionComparisons));
  assert.ok(payload.sectionComparisons.length > 0);
  assert.ok(payload.sectionComparisons[0].matchedBy);
  assert.ok(payload.sectionComparisons[0].sectionConfidence);
  assert.ok(payload.differentiationAnalysis);
  assert.ok(payload.differentiationAnalysis.summary);
  assert.ok(payload.differentiationAnalysis.strengthLevel);
  assert.ok(Array.isArray(payload.differentiationAnalysis.lowOverlapSections));
  assert.ok(Array.isArray(payload.differentiationAnalysis.strategyRecommendations));
  assert.ok(payload.semanticDiff);
  assert.ok(Array.isArray(payload.semanticDiff.insights));
  assert.ok(payload.confidence);
  assert.ok(['high', 'moderate', 'low'].includes(payload.confidence.label));
  assert.ok(Array.isArray(payload.confidence.reasons));
  assert.ok(Array.isArray(payload.confidence.warnings));
  assert.ok(Array.isArray(payload.priorStudies));
  assert.ok(payload.topMatches[0].denseScore >= 0);
  assert.ok(payload.topMatches[0].sparseScore >= 0);
  assert.equal(typeof payload.verdict, 'string');
  await closeServer(server);
});

test('similarity report prioritizes reference-derived prior studies when a references section exists', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/similarity/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '멀티모달 연구 초안',
      text: `Abstract
멀티모달 학술 그래프 검색과 연구 추천을 다루는 초안입니다.

Method
벡터 검색, 인용 그래프, 주제 키워드 결합 랭킹을 사용합니다.

References
[1] Smith, J. 2024. Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval.
[2] Lee, H. 2023. Climate Risk Knowledge Distillation for Public Policy Research.`
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.priorStudies));
  assert.ok(payload.priorStudies.length >= 2);
  assert.equal(payload.priorStudies[0].sourceType, 'reference');
  assert.match(payload.priorStudies[0].title, /Quantum Neural Architectures/i);
  assert.equal(payload.analysis.priorStudies[0].sourceType, 'reference');
  assert.ok(payload.priorStudiesMeta.referenceDerivedCount >= 2);
  assert.ok(payload.topMatches.length > 0);
  await closeServer(server);
});

test('search remains stable across repeated Korean, English, and mixed-language exact queries', async () => {
  const { server, baseUrl } = await startTestServer();
  const queries = [
    '차세대 배터리 열폭주 예측',
    'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval',
    '배터리 thermal runaway multimodal'
  ];

  for (const query of queries) {
    for (let run = 0; run < 3; run += 1) {
      const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&region=all&sourceType=all&sort=relevance&autoLive=0`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(payload.items));
      assert.ok(payload.items.length >= 1);
      assert.ok(payload.items[0].title || payload.items[0].englishTitle);
      assert.ok(payload.items[0].score >= 0);
    }
  }

  await closeServer(server);
});

test('search includes documents persisted in local storage', async () => {
  const storedId = `paper:stored-search-${Date.now()}`;
  persistDocuments([
    {
      id: storedId,
      canonicalId: storedId,
      source: 'scienceon',
      sourceLabel: 'ScienceON',
      type: 'paper',
      title: '수질 이상 탐지를 위한 저장 인덱스 검증 문헌',
      englishTitle: 'Stored-index validation paper for water-quality anomaly detection',
      authors: ['홍길동'],
      organization: 'Stored Index Lab',
      year: 2024,
      region: 'domestic',
      language: 'ko',
      summary: '저장된 문헌이 검색 인덱스에 포함되는지 확인하는 테스트용 레코드입니다.',
      abstract: '수질 이상 탐지와 저장 인덱스 검증을 결합한 테스트 논문입니다.',
      keywords: ['수질 이상 탐지', '저장 인덱스', '검증'],
      highlights: ['persistent storage path'],
      methods: ['hybrid retrieval'],
      links: {
        detail: 'https://scienceon.kisti.re.kr/',
        original: 'https://scienceon.kisti.re.kr/'
      }
    }
  ]);

  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent('저장 인덱스 검증 문헌')}&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.items.some((item) => item.canonicalId === storedId || item.id === storedId));
  await closeServer(server);
});

test('search supports Korean to English and English to Korean semantic retrieval', async () => {
  const { server, baseUrl } = await startTestServer();

  const koreanToEnglish = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent('학술 그래프 검색')}&region=all&sourceType=all&sort=relevance&autoLive=0`
  );
  const koreanPayload = await koreanToEnglish.json();
  assert.equal(koreanToEnglish.status, 200);
  assert.ok(koreanPayload.items.some((item) => /Quantum Neural Architectures/i.test(item.title)));
  assert.equal(koreanPayload.crossLingual?.enabled, true);
  assert.equal(koreanPayload.crossLingual?.direction, 'ko-to-en');

  const englishToKorean = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent('portable voltage supply')}&region=all&sourceType=all&sort=relevance&autoLive=0`
  );
  const englishPayload = await englishToKorean.json();
  assert.equal(englishToKorean.status, 200);
  assert.ok(englishPayload.items.some((item) => /휴대용 전압 공급장치/.test(item.title)));
  assert.equal(englishPayload.crossLingual?.enabled, true);
  assert.equal(englishPayload.crossLingual?.direction, 'en-to-ko');

  await closeServer(server);
});

test('search recalls English-only and Korean-only documents through semantic cross-lingual evidence', async () => {
  await persistDocuments([
    {
      canonicalId: 'paper:cross-en-only-graph',
      id: 'paper:cross-en-only-graph',
      type: 'paper',
      source: 'arxiv',
      sourceLabel: 'arXiv',
      title: 'Scholarly Graph Retrieval with Quantum Neural Ranking',
      englishTitle: 'Scholarly Graph Retrieval with Quantum Neural Ranking',
      authors: ['Dana Smith'],
      organization: 'Open Retrieval Lab',
      year: 2026,
      language: 'en',
      abstract: 'This paper improves scholarly graph retrieval and citation discovery with quantum neural ranking.',
      summary: 'English-only abstract and summary for scholarly graph retrieval.',
      keywords: ['scholarly graph', 'graph retrieval', 'citation discovery', 'quantum neural ranking'],
      links: {
        detail: 'https://example.com/cross-en-only-graph',
        original: 'https://example.com/cross-en-only-graph'
      }
    },
    {
      canonicalId: 'fair_entry:cross-ko-only-voltage',
      id: 'fair_entry:cross-ko-only-voltage',
      type: 'fair_entry',
      source: 'student_invention_fair',
      sourceLabel: '학생발명품경진대회',
      title: '태양광 기반 휴대용 전압 공급장치 설계',
      englishTitle: '',
      authors: ['김하늘'],
      organization: '학생발명품경진대회',
      year: 2024,
      language: 'ko',
      abstract: '태양광 에너지를 활용해 야외 활동용 휴대용 전압 공급장치를 설계한 학생 발명 사례다.',
      summary: '한국어 전용 설명으로 구성된 휴대용 전압 공급장치 사례.',
      keywords: ['태양광', '휴대용 전압 공급장치', '학생 발명', '전원 공급'],
      links: {
        detail: 'https://example.com/cross-ko-only-voltage',
        original: 'https://example.com/cross-ko-only-voltage'
      }
    }
  ]);

  const { server, baseUrl } = await startTestServer();

  const koreanToEnglish = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent('학술 그래프 검색')}&region=all&sourceType=all&sort=relevance&autoLive=0`
  );
  const koreanPayload = await koreanToEnglish.json();
  assert.equal(koreanToEnglish.status, 200);
  assert.ok(koreanPayload.items.some((item) => item.canonicalId === 'paper:cross-en-only-graph'));

  const englishToKorean = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent('portable voltage supply')}&region=all&sourceType=all&sort=relevance&autoLive=0`
  );
  const englishPayload = await englishToKorean.json();
  assert.equal(englishToKorean.status, 200);
  assert.ok(englishPayload.items.some((item) => item.canonicalId === 'fair_entry:cross-ko-only-voltage'));

  await closeServer(server);
});

test('async similarity job API returns accepted job and polling result', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/similarity/report?async=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '비동기 배터리 AI 초안',
      text: '배터리 열폭주 예측과 센서융합 딥러닝 기반 진단 연구 초안입니다.',
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.async, true);
  assert.ok(payload.job?.id);

  let finalJob = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const jobResponse = await fetch(`${baseUrl}${payload.statusUrl}`);
    const jobPayload = await jobResponse.json();
    assert.equal(jobResponse.status, 200);
    if (['completed', 'failed'].includes(jobPayload.job?.status)) {
      finalJob = jobPayload.job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.ok(finalJob);
  assert.equal(finalJob.status, 'completed');
  assert.ok(finalJob.result?.topMatches?.length > 0);
  await closeServer(server);
});

test('async paper expand job API returns accepted job and polling result', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/${encodeURIComponent('paper:seed-paper-global-quantum')}/expand?async=1`);
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.async, true);
  assert.ok(payload.job?.id);

  let finalJob = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const jobResponse = await fetch(`${baseUrl}${payload.statusUrl}`);
    const jobPayload = await jobResponse.json();
    assert.equal(jobResponse.status, 200);
    if (['completed', 'failed'].includes(jobPayload.job?.status)) {
      finalJob = jobPayload.job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.ok(finalJob);
  assert.equal(finalJob.status, 'completed');
  assert.match(finalJob.result?.paper?.title || '', /Quantum Neural Architectures/);
  await closeServer(server);
});

test('async analysis job API supports cancellation', async () => {
  process.env.SCHOLAXIS_TEST_ANALYSIS_DELAY_MS = '1000';
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/similarity/report?async=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '취소 테스트',
        text: '배터리 열폭주 예측과 센서융합 딥러닝 기반 진단 연구 초안입니다.',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.ok(payload.job?.id);

    const cancelResponse = await fetch(`${baseUrl}${payload.statusUrl}`, { method: 'DELETE' });
    const cancelPayload = await cancelResponse.json();
    assert.equal(cancelResponse.status, 200);
    assert.ok(['queued', 'running', 'cancelled'].includes(cancelPayload.job.status));

    let finalJob = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const jobResponse = await fetch(`${baseUrl}${payload.statusUrl}`);
      const jobPayload = await jobResponse.json();
      assert.equal(jobResponse.status, 200);
      if (['completed', 'failed', 'cancelled'].includes(jobPayload.job?.status)) {
        finalJob = jobPayload.job;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(finalJob);
    assert.equal(finalJob.status, 'cancelled');
  } finally {
    delete process.env.SCHOLAXIS_TEST_ANALYSIS_DELAY_MS;
    await closeServer(server);
  }
});

test('generic fair/RNE source queries surface representative seeded category results', () => {
  const results = runIsolatedSearchQueries(['전람회', 'RNE', '발명품']);
  const byQuery = new Map(results.map((item) => [item.query, item]));

  assert.ok(byQuery.get('전람회')?.items.some((item) => item.sourceKey === 'science_fair'));
  assert.ok(byQuery.get('RNE')?.items.some((item) => item.sourceKey === 'rne_report' && item.type === 'report'));
  assert.ok(byQuery.get('발명품')?.items.some((item) => item.sourceKey === 'student_invention_fair'));
});



test('docx extractor pulls text from a DOCX buffer', async () => {
  const extraction = await extractDocxText(await sampleDocxBuffer());
  assert.match(extraction.text, /Hello DOCX world/);
});

test('hwpx extractor pulls text from an HWPX buffer', async () => {
  const extraction = await extractHwpxText(await sampleHwpxBuffer());
  assert.match(extraction.text, /안녕하세요 HWPX 세계/);
});

test('hwpx extractor preserves table markers and paragraph order', async () => {
  const extraction = await extractHwpxText(await sampleStructuredHwpxBuffer());
  assert.match(extraction.text, /연구 배경/);
  assert.match(extraction.text, /\[TABLE\]/);
  assert.match(extraction.text, /항목 \| 값/);
  assert.match(extraction.text, /정확도 \| 92%/);
  assert.match(extraction.text, /결론/);
});

test('hwp extractor returns best-effort text with warning', async () => {
  const extraction = await extractHwpText(Buffer.from('테스트 HWP 텍스트'));
  assert.match(extraction.text, /테스트 HWP 텍스트/);
  assert.ok(extraction.warnings.includes('binary-hwp-best-effort-only'));
});

test('hwp extractor can recover utf16-encoded korean text heuristically', async () => {
  const extraction = await extractHwpText(Buffer.from('국문 보고서 테스트', 'utf16le'));
  assert.match(extraction.text, /국문 보고서 테스트/);
});

test('pdf extractor pulls simple text from a PDF buffer', async () => {
  const extraction = await extractPdfText(samplePdfBuffer());
  assert.match(extraction.text, /Hello PDF world/);
});

test('similarity analyze accepts multipart PDF uploads', async () => {
  const { server, baseUrl } = await startTestServer();
  const form = new FormData();
  form.set('title', 'PDF 업로드 테스트');
  form.set('report', new Blob([samplePdfBuffer()], { type: 'application/pdf' }), 'sample.pdf');

  const response = await fetch(`${baseUrl}/api/similarity/analyze`, {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.extraction);
  assert.match(payload.extraction.preview, /Hello PDF world/);
  assert.ok(['high', 'moderate', 'low'].includes(payload.extraction.confidenceLabel));
  assert.ok(payload.confidence);
  await closeServer(server);
});

test('similarity analyze lifts bibliography entries from uploaded PDFs into prior studies', async () => {
  const { server, baseUrl } = await startTestServer();
  const form = new FormData();
  form.set('title', '참고문헌 PDF 테스트');
  form.set(
    'report',
    new Blob([
      samplePdfBuffer(`Abstract
멀티모달 학술 그래프 검색 초안입니다.
References
[1] Smith, J. 2024. Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval.
[2] Lee, H. 2023. Climate Risk Knowledge Distillation for Public Policy Research.`)
    ], { type: 'application/pdf' }),
    'references.pdf',
  );

  const response = await fetch(`${baseUrl}/api/similarity/analyze`, {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.priorStudies));
  assert.equal(payload.priorStudies[0].sourceType, 'reference');
  assert.match(payload.priorStudies[0].title, /Quantum Neural Architectures/i);
  assert.ok(payload.priorStudiesMeta.referenceDerivedCount >= 1);
  assert.ok(payload.analysis.priorStudies.length >= payload.priorStudies.length);
  await closeServer(server);
});

test('similarity analyze accepts multipart DOCX uploads with structured extraction confidence', async () => {
  const { server, baseUrl } = await startTestServer();
  const form = new FormData();
  form.set('title', 'DOCX 업로드 테스트');
  form.set(
    'report',
    new Blob([await sampleDocxBuffer()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    'sample.docx',
  );

  const response = await fetch(`${baseUrl}/api/similarity/analyze`, {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.extraction);
  assert.equal(payload.extraction.structured, true);
  assert.ok(payload.extraction.confidence >= 80);
  assert.equal(payload.extraction.degraded, false);
  assert.ok(payload.confidence);
  await closeServer(server);
});

test('similarity analyze accepts multipart HWPX uploads', async () => {
  const { server, baseUrl } = await startTestServer();
  const form = new FormData();
  form.set('title', 'HWPX 업로드 테스트');
  form.set('report', new Blob([await sampleHwpxBuffer()], { type: 'application/haansofthwpx' }), 'sample.hwpx');

  const response = await fetch(`${baseUrl}/api/similarity/analyze`, {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.extraction);
  assert.match(payload.extraction.preview, /안녕하세요 HWPX 세계/);
  assert.equal(payload.extraction.structured, true);
  assert.ok(payload.extraction.confidence >= 80);
  assert.ok(Array.isArray(payload.sectionComparisons));
  await closeServer(server);
});

test('similarity analyze marks binary HWP extraction as degraded when confidence is limited', async () => {
  const { server, baseUrl } = await startTestServer();
  const form = new FormData();
  form.set('title', 'HWP 업로드 테스트');
  form.set('report', new Blob([Buffer.from('테스트 HWP 텍스트')], { type: 'application/x-hwp' }), 'sample.hwp');

  const response = await fetch(`${baseUrl}/api/similarity/analyze`, {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.extraction);
  assert.equal(payload.extraction.degraded, true);
  assert.ok(payload.extraction.confidence < 55);
  assert.ok(payload.extraction.warnings.includes('binary-hwp-best-effort-only'));
  assert.ok(payload.confidence);
  assert.ok(['high', 'moderate', 'low'].includes(payload.confidence.label));
  await closeServer(server);
});



test('kci parser extracts article metadata from public landing html', () => {
  const html = `
    <a href="/kciportal/landing/article.kci?arti_id=ART002988833">唐玄宗의 執權과 擊毬</a>
    @article{ART002988833,author={서영교 and 김은정},title={唐玄宗의 執權과 擊毬},journal={동국사학},year={2023},doi={10.22912/dgsh.2023..77.335}}
  `;
  const docs = extractKciDocumentsFromHtml(html, '격구', 'https://www.kci.go.kr/kciportal/mobile/po/search/poTotalSearList.kci');
  assert.ok(docs.length >= 1);
  assert.equal(docs[0].source, 'kci');
  assert.match(docs[0].links.detail, /ART002988833/);
});

test('rne report parser extracts report titles from listing html', () => {
  const html = `
    <a href="http://www.rne.or.kr/gnuboard5/rs_report/2295">HPLC 데이터 기반 최적의 기울기 용리 Method 추천 AI 개발에 관한 연구</a>
    <a href="http://www.rne.or.kr/gnuboard5/rs_report/2294">MOF가 포함된 키토산-리그닌 복합체 멤브레인 제작 및 활용 방안에 관한 연구</a>
  `;
  const docs = extractRneReportDocumentsFromHtml(html, 'HPLC 데이터');
  assert.ok(docs.length >= 1);
  assert.equal(docs[0].source, 'rne_report');
  assert.match(docs[0].links.detail, /rs_report\/2295/);
});

test('preprint parser extracts bioRxiv search results', () => {
  const html = `
    <div class="highwire-cite">
      <span class="highwire-cite-title">Single-cell atlas of liver regeneration</span>
      <span class="highwire-cite-authors">Jane Doe, John Roe</span>
      <a href="/content/10.1101/2026.01.02.123456v1">view</a>
      <div class="highwire-cite-snippet">We profile regenerative liver tissue with single-cell RNA sequencing.</div>
      <div class="highwire-cite-metadata">Posted January 03, 2026.</div>
    </div>
  `;
  const docs = extractPreprintDocumentsFromHtml('biorxiv', html, 'liver regeneration', 5);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'biorxiv');
  assert.equal(docs[0].sourceIds.doi, '10.1101/2026.01.02.123456v1');
  assert.match(docs[0].links.detail, /biorxiv\.org\/content\/10\.1101/);
});

test('pubmed parser extracts metadata from efetch xml', () => {
  const xml = `
    <PubmedArticleSet>
      <PubmedArticle>
        <MedlineCitation>
          <PMID>41763198</PMID>
          <Article>
            <Journal><Title>Nature Medicine</Title></Journal>
            <ArticleTitle>Pyruvate suppresses interferon signaling</ArticleTitle>
            <Abstract>
              <AbstractText>Pyruvate induces STAT1 pyruvylation and modulates immune signaling.</AbstractText>
            </Abstract>
            <AuthorList>
              <Author><ForeName>Alice</ForeName><LastName>Kim</LastName></Author>
              <Author><ForeName>Brian</ForeName><LastName>Park</LastName></Author>
            </AuthorList>
          </Article>
          <DateCompleted><Year>2026</Year></DateCompleted>
        </MedlineCitation>
        <PubmedData>
          <ArticleIdList>
            <ArticleId IdType="doi">10.1038/test-doi</ArticleId>
          </ArticleIdList>
        </PubmedData>
      </PubmedArticle>
    </PubmedArticleSet>
  `;
  const docs = extractPubMedDocumentsFromXml(xml, 'pyruvate', 5);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'pubmed');
  assert.equal(docs[0].authors[0], 'Alice Kim');
  assert.equal(docs[0].sourceIds.doi, '10.1038/test-doi');
});

test('cve payload parser extracts severity and detail link', () => {
  const payload = {
    vulnerabilities: [
      {
        cve: {
          id: 'CVE-2026-12345',
          published: '2026-03-01T12:00:00.000',
          descriptions: [{ lang: 'en', value: 'Buffer overflow in parser component.' }],
          metrics: {
            cvssMetricV31: [{ cvssData: { baseSeverity: 'HIGH' } }]
          },
          references: [{ url: 'https://example.com/advisory' }],
          weaknesses: [{ description: [{ lang: 'en', value: 'CWE-120' }] }]
        }
      }
    ]
  };
  const docs = extractCveDocumentsFromPayload(payload, 'parser overflow', 5);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'cve');
  assert.equal(docs[0].highlights[0], 'HIGH');
  assert.match(docs[0].links.detail, /CVE-2026-12345/);
});

test('kiss parser extracts article detail links', () => {
  const html = `
    <section class="result">
      <a href="/Detail/Ar?key=54577874">검색어 특성과 소비자의 의사결정 여정이 구매 전환에 미치는 효과</a>
      <div>안정태, 조단비, 강윤희 / 한국심리학회지: 소비자·광고 / 2024.08 / DOI 10.21074/kjlcap.2024.25.3.285</div>
    </section>
  `;
  const docs = extractKissDocumentsFromHtml(html, '의사결정', 5);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'kiss');
  assert.match(docs[0].links.detail, /Detail\/Ar\?key=54577874/);
});

test('nanet parser extracts catalog detail links', () => {
  const html = `
    <div class="result">
      <a href="/detail/MONO12025000067308">배터리 워 = Battery war : 누가 배터리 전쟁의 최후 승자가 될 것인가</a>
      <div>강희종 지음 / 서울 : 부키, 2025 / 일반도서</div>
    </div>
  `;
  const docs = extractNanetDocumentsFromHtml(html, '배터리 전쟁', 5);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'nanet');
  assert.match(docs[0].links.detail, /detail\/MONO12025000067308/);
});

test('blackhat and defcon parsers extract archive sessions', () => {
  const blackhatHtml = `
    <div class="session">
      <a href="/us-25/briefings/schedule/#breaking-kernel">Breaking the Kernel Barrier</a>
      <div>Speaker One, Speaker Two</div>
      <p>Advanced exploitation research on kernel attack surfaces in 2025.</p>
    </div>
  `;
  const defconHtml = `
    <div class="thread">
      <a href="/node/228049">Testing Photo Albums</a>
      <div>May 13, 2019, archive thread with village media workflow details.</div>
    </div>
  `;
  const blackhatDocs = extractBlackHatDocumentsFromHtml(blackhatHtml, 'kernel attack', 5, 'https://www.blackhat.com/us-25/briefings/schedule/index.html');
  const defconDocs = extractDefconDocumentsFromHtml(defconHtml, 'photo albums', 5, 'https://forum.defcon.org/search?query=photo');
  assert.equal(blackhatDocs.length, 1);
  assert.equal(blackhatDocs[0].source, 'blackhat');
  assert.equal(defconDocs.length, 1);
  assert.equal(defconDocs[0].source, 'defcon');
});

test('ntis parser ignores no-result guidance text', () => {
  const html = `
    <h4><span class="noData">자기진자 전람회</span> 또는 선택한 조건에 대한 검색결과가 없습니다.</h4>
    <ul>
      <li>검색어의 철자가 정확한지 확인해 주세요.</li>
      <li>검색어의 단어 수를 줄이거나, 다른 검색어로 검색해 보세요.</li>
    </ul>
  `;
  const docs = extractNtisDocumentsFromHtml(
    html,
    '자기진자 전람회',
    5,
    'https://www.ntis.go.kr/ThSearchProjectList.do?searchWord=%EC%9E%90%EA%B8%B0%EC%A7%84%EC%9E%90'
  );
  assert.equal(docs.length, 0);
});

test('science fair parser excludes 지도논문 rows and avoids query leakage in keywords', () => {
  const html = `
    <tbody class="singlerow" style="cursor: pointer" onclick="fn_moveBbsNttDetail('23152', '')">
      <tr><td>1</td><td>2006</td><td>물리</td><td>자석진자를 이용한 카오스 운동에 대한 연구</td><td>특상</td></tr>
    </tbody>
    <tbody class="singlerow" style="cursor: pointer" onclick="fn_moveBbsNttDetail('29386', '')">
      <tr><td>2</td><td>2025</td><td>지구및환경</td><td>(지도논문)비틀림 진자 실험의 정교화와 꼬임에 관한 연구 지도</td><td>지도논문단체상</td></tr>
    </tbody>
  `;
  const docs = extractScienceGoDocumentsFromHtml(
    'science_fair',
    html,
    '자기진자 전람회',
    10,
    {
      baseUrl: 'https://www.science.go.kr/mps/1079/bbs/423/moveBbsNttList.do',
      page: 4,
      searchTerm: '진자',
    }
  );
  assert.equal(docs.length, 1);
  assert.match(docs[0].title, /자석진자/);
  assert.ok(docs[0].keywords.every((keyword) => !keyword.includes('자기진자')));
  assert.match(docs[0].links.detail, /nttSn=23152/);
  assert.match(docs[0].links.detail, /searchKrwd=%EC%A7%84%EC%9E%90/);
});



test('dbpia public fallback returns structured results without api key', async () => {
  process.env.SCHOLAXIS_ENABLE_LIVE_SOURCES = 'true';
  delete process.env.DBPIA_API_KEY;
  const { searchLiveSources: liveSearch } = await import(`../src/source-adapters.mjs?dbpia_test=${Date.now()}`);
  const out = await liveSearch('배터리 AI', ['dbpia'], 3);
  const status = out.statuses.find((item) => item.source === 'dbpia');
  assert.ok(status);
  assert.equal(status.source, 'dbpia');
  if (status.status === 'online') {
    assert.ok(out.documents.length > 0);
  }
});

test('ocr helper reports unavailable cleanly when local tools are missing', async () => {
  const result = await extractPdfTextWithOcr(samplePdfBuffer());
  assert.ok(['tesseract-ocr', 'ocr-unavailable', 'ocr-error'].includes(result.method));
});

test('dedupe merges near-identical items into one canonical record', () => {
  const merged = dedupeDocuments([
    {
      id: 'a',
      type: 'paper',
      source: 'arxiv',
      title: 'Hybrid Retrieval for Battery Safety',
      authors: ['Kim A'],
      year: 2025,
      sourceIds: { arxiv: '1234.5678' }
    },
    {
      id: 'b',
      type: 'paper',
      source: 'semantic_scholar',
      title: 'Hybrid Retrieval for Battery Safety',
      authors: ['Kim A'],
      year: 2025,
      sourceIds: { semanticScholar: 'abc' }
    }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].alternateSources.length, 2);
});

test('vector similarity is higher for related text than unrelated text', () => {
  const query = buildDenseVector('battery safety multimodal ai');
  const related = buildDenseVector('multimodal ai for battery thermal safety');
  const unrelated = buildDenseVector('classical literature translation theory');
  assert.ok(cosineSimilarity(query, related) > cosineSimilarity(query, unrelated));
});

test('postgres migration bundle includes pgvector schema and documents', () => {
  const sql = buildPostgresMigrationSql();
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS documents/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS search_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS similarity_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS background_jobs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS library_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_searches/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_preferences/);
  assert.match(sql, /INSERT INTO documents/);
});

test('postgres schema sql includes runtime tables', () => {
  const sql = getPostgresSchemaSql();
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS documents/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS search_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS similarity_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS graph_edges/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS background_jobs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS library_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_searches/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_preferences/);
});

test('postgres serious-use diagnostics recommend postgres + pgvector when fallback mode is active', () => {
  const diagnostics = getPostgresSeriousUsePathDiagnostics();
  assert.equal(diagnostics.recommended.storageBackend, 'postgres');
  assert.equal(diagnostics.recommended.vectorBackend, 'pgvector');
  assert.equal(diagnostics.active.storageBackend, process.env.SCHOLAXIS_STORAGE_BACKEND || 'sqlite');
  assert.equal(diagnostics.active.vectorBackend, process.env.SCHOLAXIS_VECTOR_BACKEND || 'local');
  assert.equal(diagnostics.status, 'development-fallback');
  assert.equal(diagnostics.ready, false);
  assert.ok(diagnostics.missing.includes('storage-backend'));
  assert.ok(diagnostics.missing.includes('vector-backend'));
  assert.equal(diagnostics.validationCommand, 'npm run validate:postgres');
});

test('frontend search query normalization maps Korean option values to API values', () => {
  const normalized = normalizeSearchQuery({
    q: '배터리 AI',
    region: '국내,해외',
    sourceType: '논문,특허,보고서',
    sort: '국내우선',
  });
  assert.equal(normalized.region, 'all');
  assert.equal(normalized.sourceType, 'all');
  assert.equal(normalized.sort, 'relevance');
});

test('frontend result normalization adapts backend search items to UI shape', () => {
  const paper = toUiPaperShape({
    id: 'paper:1',
    title: '배터리 AI',
    englishTitle: 'Battery AI',
    authors: ['Kim'],
    organization: 'KAIST',
    type: 'paper',
    source: 'KCI',
    region: 'domestic',
    summary: 'summary',
    keywords: ['배터리'],
    highlights: ['국내 데이터셋'],
    citations: 10,
    score: 82.1,
  });
  assert.equal(paper.sourceType, '논문');
  assert.equal(paper.region, '국내');
  assert.equal(paper.badge, 'KCI');
  assert.ok(Array.isArray(paper.tags));
});

test('source helper rejects broken-encoding and code-noise titles', () => {
  assert.equal(hasBrokenEncoding('������ ���� ������'), true);
  assert.equal(looksLikeNoise('588 + engJungsung[jung] * 28 + engJongsung[jong] + 44032);'), true);
  assert.equal(isUsableSearchText('자석 진자를 이용한 발전 장치', '자석진자'), true);
  assert.equal(isUsableSearchText('현재 페이지에 input text 입력창이 하나라서 별다른 처리는 하지않음', '자석진자'), false);
});

test('query expansion stays generic when no translation backend is configured', async () => {
  const variants = expandQueryVariants('새로운 주제 검색');
  assert.ok(variants.includes('새로운 주제 검색'));
  assert.ok(!variants.includes('new topic search'));

  const context = await buildCrossLingualQueryContext('새로운 주제 검색');
  assert.equal(context.enabled, false);
  assert.equal(context.reason, 'translation-backend-not-configured');
});

test('query context uses semantic lexicon fallback for cross-lingual retrieval when translation backend is unavailable', async () => {
  const koContext = await buildCrossLingualQueryContext('학술 그래프 검색');
  assert.equal(koContext.enabled, true);
  assert.equal(koContext.backend, 'lexicon');
  assert.equal(koContext.direction, 'ko-to-en');
  assert.match(koContext.translatedQuery, /scholarly graph|knowledge graph|citation graph/i);
  assert.ok(Array.isArray(koContext.translatedVariants));
  assert.ok(koContext.translatedVariants.some((term) => /scholarly graph|knowledge graph/i.test(term)));
  assert.ok(!koContext.translatedVariants.some((term) => /graph neural network/i.test(term)));

  const enContext = await buildCrossLingualQueryContext('portable voltage supply');
  assert.equal(enContext.enabled, true);
  assert.equal(enContext.backend, 'lexicon');
  assert.equal(enContext.direction, 'en-to-ko');
  assert.match(enContext.translatedQuery, /전압 공급장치/);
});

test('generic queries stay disabled when lexicon fallback has no strong cross-lingual phrase', async () => {
  const context = await buildCrossLingualQueryContext('새로운 주제 검색');
  assert.equal(context.enabled, false);
  assert.equal(context.backend, 'disabled');
  assert.equal(context.reason, 'translation-backend-not-configured');
});

test('cross-lingual live-source routing preserves opposite-language fan-out without a translation backend', async () => {
  const koQuery = '학술 그래프 검색';
  const koContext = await buildCrossLingualQueryContext(koQuery);
  const koRouted = rankSourcesByProfile([], classifyQueryProfile(koQuery), koContext.direction);
  const koSplit = splitSourcesForCrossLingual(koRouted, koContext.direction);
  assert.equal(koContext.backend, 'lexicon');
  assert.ok(koSplit.translatedSources.includes('arxiv'));
  assert.ok(koSplit.translatedSources.includes('semantic_scholar'));
  assert.ok(!koSplit.originalSources.includes('arxiv'));
  assert.ok(!koSplit.originalSources.includes('semantic_scholar'));
  assert.equal(new Set([...koSplit.originalSources, ...koSplit.translatedSources]).size, koSplit.originalSources.length + koSplit.translatedSources.length);

  const enQuery = 'portable voltage supply';
  const enContext = await buildCrossLingualQueryContext(enQuery);
  const enRouted = rankSourcesByProfile([], classifyQueryProfile(enQuery), enContext.direction);
  const enSplit = splitSourcesForCrossLingual(enRouted, enContext.direction);
  assert.equal(enContext.backend, 'lexicon');
  assert.ok(enSplit.translatedSources.includes('student_invention_fair'));
  assert.ok(enSplit.translatedSources.includes('science_fair'));
  assert.ok(enSplit.translatedSources.includes('kci'));
  assert.ok(!enSplit.originalSources.includes('student_invention_fair'));
  assert.ok(enSplit.originalSources.includes('arxiv'));

  const guardedContext = await buildCrossLingualQueryContext('양자 암호');
  assert.equal(guardedContext.enabled, false);
  assert.equal(guardedContext.direction, 'none');
});

test('search supports english-to-korean patent routing via lexicon fallback variants', async () => {
  const context = await buildCrossLingualQueryContext('medical imaging edge support');
  assert.equal(context.enabled, true);
  assert.equal(context.backend, 'lexicon');
  assert.ok(context.translatedVariants.includes('의료영상'));
  assert.ok(context.translatedVariants.includes('엣지 컴퓨팅'));
  assert.ok(!context.translatedVariants.includes('지식 그래프'));

  const { server, baseUrl } = await startTestServer();
  const response = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent('medical imaging edge support')}&region=domestic&sourceType=patent&sort=relevance&autoLive=0`
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.crossLingual.enabled, true);
  assert.equal(payload.crossLingual.backend, 'lexicon');
  assert.ok(payload.crossLingual.translatedVariants.includes('의료영상'));
  assert.ok(payload.crossLingual.translatedVariants.includes('엣지 컴퓨팅'));
  assert.ok(
    payload.items.some((item) =>
      item.sourceKey === 'kipris' && /의료영상/.test(item.title) && /실시간/.test(item.title)
    )
  );
  await closeServer(server);
});

test('query profile classifier surfaces source hints without term-translation hacks', () => {
  const patent = classifyQueryProfile('KIPRIS 특허 침해 분석');
  assert.ok(patent.requestedTypes.includes('patent'));
  assert.ok(patent.sourceHints.includes('kipris'));

  const humanities = classifyQueryProfile('한국사 교육 자료 비교');
  assert.ok(humanities.domains.includes('education'));
  assert.ok(humanities.sourceHints.includes('riss'));

  const biomedical = classifyQueryProfile('PubMed 기반 면역 유전자 치료 조사');
  assert.ok(biomedical.domains.includes('biomedical'));
  assert.ok(biomedical.sourceHints.includes('pubmed'));

  const security = classifyQueryProfile('CVE 취약점과 Black Hat exploit 사례 조사');
  assert.ok(security.domains.includes('security'));
  assert.ok(security.sourceHints.includes('cve'));
  assert.ok(security.sourceHints.includes('blackhat'));

  const scienceFair = classifyQueryProfile('science fair magnetic pendulum');
  assert.ok(scienceFair.sourceHints.includes('science_fair'));
  assert.ok(!scienceFair.sourceHints.includes('student_invention_fair'));

  const inventionFair = classifyQueryProfile('student invention portable voltage supply');
  assert.ok(inventionFair.sourceHints.includes('student_invention_fair'));
});

test('source registry summary includes newly added databases', () => {
  const summary = sourceRegistrySummary('배터리');
  const sources = new Set(summary.map((item) => item.source));
  for (const source of ['biorxiv', 'medrxiv', 'pubmed', 'kiss', 'nanet', 'cve', 'blackhat', 'defcon']) {
    assert.ok(sources.has(source));
  }
  assert.equal(summary.find((item) => item.source === 'pubmed')?.experimental, false);
  assert.equal(summary.find((item) => item.source === 'pubmed')?.autoRoutedByDefault, true);
});

test('config includes new sources in default preferred source routing', () => {
  for (const source of ['biorxiv', 'medrxiv', 'pubmed', 'kiss', 'nanet', 'cve', 'blackhat', 'defcon']) {
    assert.equal(appConfig.preferredSources.includes(source), true);
  }
  assert.equal(appConfig.experimentalLiveSources.length, 0);
});

test('source runtime diagnostics expose experimental source policy configuration', () => {
  const diagnostics = getSourceRuntimeDiagnostics();
  assert.ok(Array.isArray(diagnostics.experimentalSources));
  assert.equal(diagnostics.experimentalSources.length, 0);
});

test('vector backend server supports upsert and search', async () => {
  const { server, baseUrl } = await startStandaloneServer(createVectorBackendServer());

  const upsertResponse = await fetch(`${baseUrl}/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documents: [
        {
          id: 'doc-1',
          vector: buildDenseVector('battery safety multimodal ai'),
          metadata: { title: 'battery safety multimodal ai' },
        },
        {
          id: 'doc-2',
          vector: buildDenseVector('classical literature translation theory'),
          metadata: { title: 'classical literature translation theory' },
        },
      ],
    }),
  });
  assert.equal(upsertResponse.status, 200);

  const searchResponse = await fetch(`${baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'battery multimodal safety', limit: 2 }),
  });
  const searchPayload = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(searchPayload.hits[0].id, 'doc-1');

  await closeServer(server);
});

test('graph backend server supports upsert and neighbor queries', async () => {
  const { server, baseUrl } = await startStandaloneServer(createGraphBackendServer());

  const upsertResponse = await fetch(`${baseUrl}/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      edges: [
        { sourceId: 'paper:a', targetId: 'paper:b', edgeType: 'references', weight: 0.91 },
        { sourceId: 'paper:a', targetId: 'author:kim', edgeType: 'authored_by', weight: 1 },
      ],
    }),
  });
  assert.equal(upsertResponse.status, 200);

  const neighborResponse = await fetch(`${baseUrl}/neighbors?node=paper:a&edgeType=references&limit=5`);
  const neighborPayload = await neighborResponse.json();
  assert.equal(neighborResponse.status, 200);
  assert.equal(neighborPayload.edges[0].targetId, 'paper:b');

  await closeServer(server);
});

test('reranker backend server reranks candidates', async () => {
  const { server, baseUrl } = await startStandaloneServer(createRerankerBackendServer());

  const response = await fetch(`${baseUrl}/rerank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'battery safety multimodal ai',
      translatedQuery: '',
      topK: 2,
      candidates: [
        {
          id: 'doc-1',
          title: 'Battery safety multimodal ai',
          englishTitle: 'Battery safety multimodal ai',
          abstract: 'battery safety multimodal ai abstract',
          summary: 'battery safety multimodal ai summary',
          keywords: ['battery', 'safety'],
          citations: 12
        },
        {
          id: 'doc-2',
          title: 'Classical literature theory',
          englishTitle: 'Classical literature theory',
          abstract: 'translation history and literature',
          summary: 'humanities summary',
          keywords: ['literature'],
          citations: 1
        }
      ]
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.results[0].id, 'doc-1');
  await closeServer(server);
});
