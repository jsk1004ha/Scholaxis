import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Blob } from 'node:buffer';
import { createServer, startServer } from '../src/server.mjs';
import { createGraphBackendServer } from '../src/graph-backend-server.mjs';
import { buildPostgresMigrationSql } from '../src/postgres-migration.mjs';
import { getPostgresSchemaSql } from '../src/postgres-store.mjs';
import { createVectorBackendServer } from '../src/vector-backend-server.mjs';
import { extractHwpText, extractHwpxText } from '../src/hwp-text-extractor.mjs';
import { normalizeSearchQuery, toUiPaperShape } from '../public/api.js';
import { hasBrokenEncoding, isUsableSearchText, looksLikeNoise } from '../src/source-helpers.mjs';
import { searchLiveSources } from '../src/source-adapters.mjs';
import { extractPdfTextWithOcr } from '../src/ocr-service.mjs';
import { extractKciDocumentsFromHtml } from '../src/source-adapters.mjs';
import { dedupeDocuments } from '../src/dedup-service.mjs';
import { extractPdfText } from '../src/pdf-text-extractor.mjs';
import { extractDocxText } from '../src/docx-text-extractor.mjs';
import { buildDenseVector, cosineSimilarity } from '../src/vector-service.mjs';

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

function samplePdfBuffer() {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 39 >>\nstream\nBT\n/F1 12 Tf\n72 72 Td\n(Hello PDF world) Tj\nET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`,
    'latin1'
  );
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
  server.close();
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

  server.close();
  blocker.close();
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
  server.close();
});

test('storage stats endpoint returns sqlite diagnostics', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/storage/stats`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ready, true);
  assert.ok(payload.dbPath);
  server.close();
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
    }),
  });
  const savedSearchPayload = await savedSearchResponse.json();
  assert.equal(savedSearchResponse.status, 200);
  assert.equal(savedSearchPayload.ok, true);
  assert.ok(savedSearchPayload.searches.length > 0);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  const mePayload = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.user.email, email);

  server.close();
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
  assert.deepEqual(profilePayload.profile.researchInterests, ['OCR', '추천 시스템']);

  server.close();
});



test('recommendations endpoint returns data', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/recommendations`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.recommendations));
  assert.ok(payload.recommendations[0].recommendationScore >= payload.recommendations.at(-1).recommendationScore);
  server.close();
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

  server.close();
});

test('admin summary endpoint returns runtime and recent requests', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/admin/summary`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.storage);
  assert.ok(payload.runtime);
  assert.ok(Array.isArray(payload.recentRequests));
  server.close();
});

test('admin ops endpoint returns startup, alerts, and similarity runs', async () => {
  const { server, baseUrl } = await startTestServer();

  await fetch(`${baseUrl}/api/similarity/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '운영 대시보드 샘플',
      text: '운영 대시보드에서 최근 유사도 실행 이력을 확인하기 위한 샘플 문서입니다.',
    }),
  });

  const response = await fetch(`${baseUrl}/api/admin/ops`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.startup.host, process.env.HOST || '127.0.0.1');
  assert.ok(Array.isArray(payload.alerts));
  assert.ok(Array.isArray(payload.recentRequests));
  assert.ok(Array.isArray(payload.recentSimilarityRuns));
  assert.ok(payload.recentSimilarityRuns.length >= 1);

  server.close();
});

test('admin infra and jobs endpoints expose search infrastructure controls', async () => {
  const { server, baseUrl } = await startTestServer();

  const infraResponse = await fetch(`${baseUrl}/api/admin/infra`);
  const infraPayload = await infraResponse.json();
  assert.equal(infraResponse.status, 200);
  assert.equal(infraPayload.storageBackend, process.env.SCHOLAXIS_STORAGE_BACKEND || 'sqlite');
  assert.ok(infraPayload.vectorBackend);
  assert.ok(infraPayload.graphBackend);
  assert.match(infraPayload.postgresMigrationPreview, /CREATE EXTENSION IF NOT EXISTS vector/);

  const scheduleResponse = await fetch(`${baseUrl}/api/admin/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'schedule-defaults' }),
  });
  const schedulePayload = await scheduleResponse.json();
  assert.equal(scheduleResponse.status, 200);
  assert.ok(Array.isArray(schedulePayload.jobs));
  assert.ok(schedulePayload.jobs.length >= 1);

  const jobsResponse = await fetch(`${baseUrl}/api/admin/jobs`);
  const jobsPayload = await jobsResponse.json();
  assert.equal(jobsResponse.status, 200);
  assert.ok(Array.isArray(jobsPayload.jobs));
  assert.ok(jobsPayload.jobs.length >= 1);

  server.close();
});

test('search endpoint returns canonicalized Korean-first research results', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=배터리 AI&region=domestic&sourceType=paper&sort=relevance`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.filters.region, 'domestic');
  assert.ok(payload.results[0].id);
  assert.ok(payload.canonicalCount >= 1);
  server.close();
});

test('search endpoint does not dump unrelated seed results for unmatched queries', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=자기진자&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  assert.match(payload.summary, /찾지 못했습니다/);
  server.close();
});

test('search endpoint blocks dense-only collisions for compact Korean queries', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=자석진자&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  server.close();
});

test('search endpoint rejects generic multi-term semantic collisions', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/search?q=%EC%96%91%EC%9E%90%20%EC%95%94%ED%98%B8&region=all&sourceType=all&sort=relevance&autoLive=0`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.total, 0);
  server.close();
});

test('detail endpoint returns related materials and alternate source metadata', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.id || payload.canonicalId);
  assert.ok(payload.related.length > 0);
  assert.ok(payload.metrics.alternateSourceCount >= 1);
  server.close();
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
  assert.ok(payload.differentiationAnalysis);
  assert.ok(payload.differentiationAnalysis.summary);
  assert.ok(Array.isArray(payload.differentiationAnalysis.strategyRecommendations));
  server.close();
});



test('docx extractor pulls text from a DOCX buffer', async () => {
  const extraction = await extractDocxText(await sampleDocxBuffer());
  assert.match(extraction.text, /Hello DOCX world/);
});

test('hwpx extractor pulls text from an HWPX buffer', async () => {
  const extraction = await extractHwpxText(await sampleHwpxBuffer());
  assert.match(extraction.text, /안녕하세요 HWPX 세계/);
});

test('hwp extractor returns best-effort text with warning', async () => {
  const extraction = await extractHwpText(Buffer.from('테스트 HWP 텍스트'));
  assert.match(extraction.text, /테스트 HWP 텍스트/);
  assert.ok(extraction.warnings.includes('binary-hwp-best-effort-only'));
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
  server.close();
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
  assert.ok(Array.isArray(payload.sectionComparisons));
  server.close();
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
  assert.match(sql, /CREATE TABLE IF NOT EXISTS background_jobs/);
  assert.match(sql, /INSERT INTO documents/);
});

test('postgres schema sql includes runtime tables', () => {
  const sql = getPostgresSchemaSql();
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS documents/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS graph_edges/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS background_jobs/);
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

  server.close();
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

  server.close();
});
