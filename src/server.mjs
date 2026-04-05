import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySecurityHeaders,
  json,
  parseMultipartForm,
  readJsonBody,
  readRawBody,
  serveStatic
} from './http-helpers.mjs';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  verifyPassword
} from './auth-service.mjs';
import { extractPdfText } from './pdf-text-extractor.mjs';
import { extractDocxText } from './docx-text-extractor.mjs';
import { extractPdfTextWithOcr, getOcrDiagnostics } from './ocr-service.mjs';
import {
  expandPaperById,
  getPaperById,
  getSearchSuggestions,
  listSourceStatuses,
  listTrends,
  searchCatalog,
  getRecommendationsById
} from './search-service.mjs';
import { clearSourceCache, getSourceRuntimeDiagnostics } from './source-adapters.mjs';
import {
  addLibraryItem,
  createSession,
  createUser,
  deleteSessionByHash,
  findSessionByHash,
  findUserByEmail,
  getRecentRequestLogs,
  getStorageDiagnostics,
  listLibraryItems,
  listSavedSearches,
  persistRequestLog,
  persistSimilarityRun,
  removeLibraryItem,
  removeSavedSearch,
  saveSearch
} from './storage.mjs';
import { buildSimilarityReport } from './similarity-service.mjs';
import { appConfig } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

function setCookieHeader(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
}

function getSessionContext(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.scholaxis_session;
  if (!token) return null;
  const session = findSessionByHash(hashSessionToken(token));
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    deleteSessionByHash(hashSessionToken(token));
    return null;
  }
  return { token, session };
}

function requireSession(req, res) {
  const ctx = getSessionContext(req);
  if (!ctx) {
    json(res, 401, { error: '로그인이 필요합니다.' });
    return null;
  }
  return ctx;
}

function notFound(res, message = 'Not found') {
  json(res, 404, { error: message });
}

function normalizeSimilarityCompat(report, overrides = {}) {
  const comparedPaperId = report.topMatches?.[0]?.id || null;
  return {
    reportName: overrides.title || report.title,
    similarityScore: report.score,
    comparedPaperId,
    sharedContext: report.sharedThemes?.join(', ') || '공통 주제가 충분하지 않습니다.',
    novelty: report.noveltySignals?.join(', ') || '차별화 포인트를 더 입력해 주세요.',
    risk:
      report.riskLevel === 'high'
        ? '유사도가 높습니다. 핵심 기여와 실험 차별점을 명확히 분리하세요.'
        : report.riskLevel === 'moderate'
          ? '일부 핵심 표현이 겹칩니다. 비교 연구와의 차이를 명확히 서술하세요.'
          : '현재는 심각한 중복 위험이 높지 않지만, 관련 연구 대비 차별점을 유지하세요.',
    recommendations: report.recommendations
  };
}

function buildSimilarityFromRequest(body, fallbackTitle = '업로드 문서') {
  const report = buildSimilarityReport({
    title: body.title || body.reportName || fallbackTitle,
    text: body.text || body.content || body.extractedText || ''
  });

  return {
    ...report,
    analysis: normalizeSimilarityCompat(report, { title: body.title || body.reportName || fallbackTitle })
  };
}

async function buildSimilarityFromMultipart(fields) {
  const fileField = fields.report || fields.file || {};
  const title = fileField.filename || fields.title?.value || '업로드 문서';
  let extractedText = fields.text?.value || fields.content?.value || '';
  let extraction = null;

  if (!extractedText && fileField.buffer?.length) {
    if (/\.pdf$/i.test(fileField.filename || '') || /application\/pdf/i.test(fileField.contentType || '')) {
      extraction = await extractPdfText(fileField.buffer);
      extractedText = extraction.text || '';
      if ((!extractedText || extractedText.length < 80) && fileField.buffer?.length) {
        const ocrExtraction = await extractPdfTextWithOcr(fileField.buffer);
        if ((ocrExtraction.text || '').length > extractedText.length) {
          extraction = ocrExtraction;
          extractedText = ocrExtraction.text || extractedText;
        } else if (ocrExtraction.warnings?.length) {
          extraction = {
            ...extraction,
            warnings: [...new Set([...(extraction.warnings || []), ...ocrExtraction.warnings])]
          };
        }
      }
    } else if (/\.docx$/i.test(fileField.filename || '') || /wordprocessingml/.test(fileField.contentType || '')) {
      extraction = await extractDocxText(fileField.buffer);
      extractedText = extraction.text || '';
    } else {
      extractedText = fileField.buffer.toString('utf8').trim();
      extraction = {
        text: extractedText,
        method: 'utf8-buffer',
        warnings: []
      };
    }
  }

  const payload = buildSimilarityFromRequest(
    {
      title,
      text: extractedText || `${title} research manuscript scholarly similarity analysis`
    },
    title
  );

  if (extraction) {
    payload.extraction = {
      method: extraction.method,
      warnings: extraction.warnings,
      extractedCharacters: (extraction.text || '').length,
      preview: (extraction.text || '').slice(0, 240)
    };
  }

  return payload;
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const requestStartedAt = performance.now();
    applySecurityHeaders(res);

    if (!req.url || !req.method) return notFound(res);

    const url = new URL(req.url, 'http://localhost');
    const { pathname, searchParams } = url;

    try {
      if (pathname === '/api/health') {
        const ocr = await getOcrDiagnostics();
        const sourceRuntime = getSourceRuntimeDiagnostics();
        return json(res, 200, {
          ok: true,
          service: 'scholaxis',
          liveSourcesEnabled: appConfig.enableLiveSources,
          timestamp: new Date().toISOString(),
          runtime: {
            ocr,
            sourceRuntime,
            storage: getStorageDiagnostics()
          }
        });
      }

      if (pathname === '/api/trends') {
        return json(res, 200, { topics: listTrends() });
      }

      if (pathname === '/api/search') {
        const preferredSources = (searchParams.get('preferredSources') || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const payload = await searchCatalog({
          q: searchParams.get('q') || '',
          region: searchParams.get('region') || 'all',
          sourceType: searchParams.get('sourceType') || 'all',
          sort: searchParams.get('sort') || 'relevance',
          preferredSources,
          live: searchParams.get('live') === '1' || appConfig.enableLiveSources,
          forceRefresh: searchParams.get('refresh') === '1'
        });
        return json(res, 200, { ...payload, data: { ...payload, items: payload.items } });
      }

      if (pathname === '/api/search/suggestions') {
        return json(res, 200, getSearchSuggestions(searchParams.get('q') || ''));
      }

      if (pathname === '/api/sources/status') {
        return json(res, 200, { sources: listSourceStatuses(), runtime: { ...getSourceRuntimeDiagnostics(), storage: getStorageDiagnostics() } });
      }

      if (pathname === '/api/cache/clear' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return json(res, 200, { ok: true, cleared: clearSourceCache({ source: body.source || '', query: body.query || '' }), runtime: getSourceRuntimeDiagnostics() });
      }

      if (pathname === '/api/storage/stats') {
        return json(res, 200, getStorageDiagnostics());
      }

      if (pathname === '/api/admin/summary') {
        return json(res, 200, { storage: getStorageDiagnostics(), recentRequests: getRecentRequestLogs(25), runtime: { ocr: await getOcrDiagnostics(), sourceRuntime: getSourceRuntimeDiagnostics() } });
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.email || !body.password) return json(res, 400, { error: 'email/password required' });
        if (findUserByEmail(body.email)) return json(res, 409, { error: '이미 존재하는 계정입니다.' });
        const user = createUser({
          email: body.email,
          displayName: body.displayName || String(body.email).split('@')[0],
          passwordDigest: hashPassword(body.password).digest
        });
        const token = createSessionToken();
        createSession({
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
        });
        setCookieHeader(res, buildSessionCookie(token));
        return json(res, 200, { ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } });
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const user = findUserByEmail(body.email || '');
        if (!user || !verifyPassword(body.password || '', user.passwordDigest)) {
          return json(res, 401, { error: '로그인 정보가 올바르지 않습니다.' });
        }
        const token = createSessionToken();
        createSession({
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
        });
        setCookieHeader(res, buildSessionCookie(token));
        return json(res, 200, { ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const ctx = getSessionContext(req);
        if (ctx) deleteSessionByHash(hashSessionToken(ctx.token));
        setCookieHeader(res, buildClearedSessionCookie());
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/auth/me') {
        const ctx = getSessionContext(req);
        return json(res, 200, {
          user: ctx ? { id: ctx.session.userId, email: ctx.session.email, displayName: ctx.session.displayName } : null
        });
      }

      if (pathname === '/api/library' && req.method === 'GET') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        return json(res, 200, { items: listLibraryItems(ctx.session.userId) });
      }

      if (pathname === '/api/library' && req.method === 'POST') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        const body = await readJsonBody(req);
        addLibraryItem({ userId: ctx.session.userId, canonicalId: body.canonicalId, note: body.note || '' });
        return json(res, 200, { ok: true, items: listLibraryItems(ctx.session.userId) });
      }

      if (pathname.startsWith('/api/library/') && req.method === 'DELETE') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        removeLibraryItem(ctx.session.userId, decodeURIComponent(pathname.split('/')[3] || ''));
        return json(res, 200, { ok: true, items: listLibraryItems(ctx.session.userId) });
      }

      if (pathname === '/api/saved-searches' && req.method === 'GET') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        return json(res, 200, { searches: listSavedSearches(ctx.session.userId) });
      }

      if (pathname === '/api/saved-searches' && req.method === 'POST') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        const body = await readJsonBody(req);
        saveSearch({
          userId: ctx.session.userId,
          label: body.label || body.queryText || 'Saved search',
          queryText: body.queryText || '',
          filters: body.filters || {}
        });
        return json(res, 200, { ok: true, searches: listSavedSearches(ctx.session.userId) });
      }

      if (pathname.startsWith('/api/saved-searches/') && req.method === 'DELETE') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        removeSavedSearch(ctx.session.userId, Number(pathname.split('/')[3] || 0));
        return json(res, 200, { ok: true, searches: listSavedSearches(ctx.session.userId) });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/recommendations')) {
        const id = pathname.split('/')[3];
        const recommendations = await getRecommendationsById(id, Number(searchParams.get('limit') || 5));
        return json(res, 200, { recommendations });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/related')) {
        const id = pathname.split('/')[3];
        const paper = await getPaperById(id);
        if (!paper) return notFound(res, 'Paper not found');
        return json(res, 200, { related: paper.related });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/expand')) {
        const id = pathname.split('/')[3];
        const expansion = await expandPaperById(id);
        if (!expansion) return notFound(res, 'Paper not found');
        return json(res, 200, expansion);
      }

      if (pathname.startsWith('/api/papers/')) {
        const id = pathname.split('/')[3];
        const paper = await getPaperById(id);
        if (!paper) return notFound(res, 'Paper not found');
        return json(res, 200, { ...paper, paper });
      }

      if (pathname === '/api/similarity/report' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const payload = buildSimilarityFromRequest(body);
        persistSimilarityRun({ title: body.title || body.reportName || '업로드 문서', extraction: null, report: payload });
        return json(res, 200, payload);
      }

      if (pathname === '/api/similarity/analyze' && req.method === 'POST') {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          const body = await readJsonBody(req);
          return json(res, 200, buildSimilarityFromRequest(body));
        }

        const rawBody = await readRawBody(req, 5_000_000);
        const fields = contentType.includes('multipart/form-data') ? parseMultipartForm(rawBody, contentType) : {};
        const payload = await buildSimilarityFromMultipart(fields);
        persistSimilarityRun({ title: fields.title?.value || fields.report?.filename || '업로드 문서', extraction: payload.extraction || null, report: payload });
        return json(res, 200, payload);
      }

      if (pathname.startsWith('/api/')) return notFound(res, 'API route not found');

      const served = await serveStatic(pathname, res, publicDir);
      if (served) return;
      const fallbackServed = await serveStatic('/index.html', res, publicDir);
      if (fallbackServed) return;
      return notFound(res);
    } catch (error) {
      persistRequestLog({ method: req.method || '', path: pathname, status: error.statusCode || 500, durationMs: performance.now() - requestStartedAt });
      return json(res, error.statusCode || 500, { error: error.message || 'Unexpected server error' });
    } finally {
      if (!res.writableEnded) return;
      persistRequestLog({ method: req.method || '', path: pathname, status: res.statusCode || 200, durationMs: performance.now() - requestStartedAt });
    }
  });
}

export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`Scholaxis server listening on http://localhost:${port}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
