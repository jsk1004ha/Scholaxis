import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Blob } from 'node:buffer';
import { createServer } from '../src/server.mjs';
import { searchLiveSources } from '../src/source-adapters.mjs';
import { extractPdfTextWithOcr } from '../src/ocr-service.mjs';
import { extractKciDocumentsFromHtml } from '../src/source-adapters.mjs';
import { dedupeDocuments } from '../src/dedup-service.mjs';
import { extractPdfText } from '../src/pdf-text-extractor.mjs';
import { extractDocxText } from '../src/docx-text-extractor.mjs';
import { buildDenseVector, cosineSimilarity } from '../src/vector-service.mjs';

async function startTestServer() {
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
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



test('recommendations endpoint returns data', async () => {
  const { server, baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/papers/paper:seed-paper-global-quantum/recommendations`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.recommendations));
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
      text: '배터리 열폭주 예측과 센서융합 딥러닝 기반 진단을 통해 생산 설비 안전성과 예측정비 전략을 강화하는 연구 초안입니다.'
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.topMatches.length > 0);
  assert.ok(payload.recommendations.length > 0);
  server.close();
});



test('docx extractor pulls text from a DOCX buffer', async () => {
  const extraction = await extractDocxText(await sampleDocxBuffer());
  assert.match(extraction.text, /Hello DOCX world/);
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
