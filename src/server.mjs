import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { extractHwpText, extractHwpxText } from './hwp-text-extractor.mjs';
import { extractPdfTextWithOcr, getOcrDiagnostics } from './ocr-service.mjs';
import {
  expandPaperById,
  getCitationsById,
  getPaperById,
  getReferencesById,
  getSearchSuggestions,
  listSourceStatuses,
  listTrends,
  searchCatalog,
  getRecommendationsById
} from './search-service.mjs';
import { clearSourceCache, getSourceRuntimeDiagnostics } from './source-adapters.mjs';
import { getGraphBackendDiagnostics } from './graph-service.mjs';
import { enqueueRecurringInfraJobs, runWorkerLoop } from './job-service.mjs';
import { getPostgresDiagnostics } from './postgres-store.mjs';
import { buildPostgresMigrationSql } from './postgres-migration.mjs';
import {
  addLibraryItem,
  enqueueBackgroundJob,
  createSession,
  createUser,
  deleteSessionByHash,
  findSessionByHash,
  findUserByEmail,
  getRecentRequestLogs,
  getRecentSimilarityRuns,
  getStorageDiagnostics,
  getUserProfile,
  listBackgroundJobs,
  listLibraryItems,
  listSavedSearches,
  persistRequestLog,
  persistSimilarityRun,
  removeLibraryItem,
  removeSavedSearch,
  saveSearch,
  updateUserProfile
} from './storage.mjs';
import { buildSimilarityReport } from './similarity-service.mjs';
import { appConfig } from './config.mjs';
import { getVectorBackendDiagnostics } from './vector-index-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

function isDirectRun() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

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
    structure: report.sectionComparisons?.length
      ? report.sectionComparisons
          .slice(0, 3)
          .map((section) => `${section.inputSection}→${section.matchedSection}(${section.divergence})`)
          .join(', ')
      : '섹션 비교를 위한 구조 정보가 부족합니다.',
    differentiation:
      report.differentiationAnalysis?.summary || '차별점 분석 요약을 생성할 수 없습니다.',
    differentiators: report.differentiationAnalysis?.uniqueTerms || [],
    risk:
      report.riskLevel === 'high'
        ? '유사도가 높습니다. 핵심 기여와 실험 차별점을 명확히 분리하세요.'
        : report.riskLevel === 'moderate'
          ? '일부 핵심 표현이 겹칩니다. 비교 연구와의 차이를 명확히 서술하세요.'
          : '현재는 심각한 중복 위험이 높지 않지만, 관련 연구 대비 차별점을 유지하세요.',
    sectionComparisons: report.sectionComparisons || [],
    differentiationAnalysis: report.differentiationAnalysis || null,
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

function buildAdminAlerts({ storage, ocr, sourceRuntime, recentRequests }) {
  const alerts = [];
  const errorRequests = recentRequests.filter((item) => Number(item.status) >= 500);

  if (!ocr.available) {
    alerts.push({
      id: 'ocr-unavailable',
      level: 'warning',
      title: 'OCR 엔진을 사용할 수 없습니다.',
      detail: '스캔 PDF는 기본 텍스트 추출에만 의존합니다.'
    });
  }

  if (!appConfig.enableLiveSources) {
    alerts.push({
      id: 'live-sources-disabled',
      level: 'info',
      title: '라이브 소스 수집이 비활성화되어 있습니다.',
      detail: 'SCHOLAXIS_ENABLE_LIVE_SOURCES=1 로 활성화할 수 있습니다.'
    });
  }

  if ((storage.requestLogs || 0) > 0 && errorRequests.length > 0) {
    alerts.push({
      id: 'request-errors-detected',
      level: errorRequests.length >= 3 ? 'critical' : 'warning',
      title: `최근 요청 ${errorRequests.length}건에서 서버 오류가 감지되었습니다.`,
      detail: '최근 요청 로그를 확인하고 원인 API를 점검하세요.'
    });
  }

  if ((sourceRuntime.cacheEntries || 0) === 0) {
    alerts.push({
      id: 'empty-source-cache',
      level: 'info',
      title: '검색 캐시가 비어 있습니다.',
      detail: '초기 부팅 직후 상태라면 정상일 수 있습니다.'
    });
  }

  if (!alerts.length) {
    alerts.push({
      id: 'all-clear',
      level: 'success',
      title: '즉시 대응이 필요한 운영 경고가 없습니다.',
      detail: '현재 진단 기준으로 시스템 상태가 안정적입니다.'
    });
  }

  return alerts;
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
      } else if (/\.hwpx$/i.test(fileField.filename || '') || /application\/haansofthwpx/i.test(fileField.contentType || '')) {
        extraction = await extractHwpxText(fileField.buffer);
        extractedText = extraction.text || '';
      } else if (/\.hwp$/i.test(fileField.filename || '') || /application\/x-hwp/i.test(fileField.contentType || '')) {
        extraction = await extractHwpText(fileField.buffer);
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
          forceRefresh: searchParams.get('refresh') === '1',
          autoLive: searchParams.get('autoLive') === '0' ? false : appConfig.autoLiveOnEmpty
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

      if (pathname === '/api/admin/ops') {
        const ocr = await getOcrDiagnostics();
        const sourceRuntime = getSourceRuntimeDiagnostics();
        const storage = getStorageDiagnostics();
        const recentRequests = getRecentRequestLogs(20);
        return json(res, 200, {
          startup: {
            host: appConfig.host,
            port: Number(process.env.PORT || 3000),
            liveSourcesEnabled: appConfig.enableLiveSources,
            sourceTimeoutMs: appConfig.sourceTimeoutMs,
            sourceCacheTtlMs: appConfig.sourceCacheTtlMs
          },
          alerts: buildAdminAlerts({ storage, ocr, sourceRuntime, recentRequests }),
          storage,
          runtime: {
            ocr,
            sourceRuntime,
            postgres: await getPostgresDiagnostics(),
            vectorBackend: getVectorBackendDiagnostics(),
            graphBackend: getGraphBackendDiagnostics(),
            worker: {
              schedulerIntervalMs: appConfig.schedulerIntervalMs,
              workerPollMs: appConfig.workerPollMs,
              workerLeaseMs: appConfig.workerLeaseMs
            }
          },
          recentRequests,
          recentSimilarityRuns: getRecentSimilarityRuns(10),
          jobs: listBackgroundJobs(20)
        });
      }

      if (pathname === '/api/admin/infra') {
        return json(res, 200, {
          storageBackend: appConfig.storageBackend,
          postgres: await getPostgresDiagnostics(),
          vectorBackend: getVectorBackendDiagnostics(),
          graphBackend: getGraphBackendDiagnostics(),
          postgresMigrationPreview: buildPostgresMigrationSql().slice(0, 1200)
        });
      }

      if (pathname === '/api/admin/jobs' && req.method === 'GET') {
        return json(res, 200, { jobs: listBackgroundJobs(50) });
      }

      if (pathname === '/api/admin/jobs' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body.action === 'schedule-defaults') {
          return json(res, 200, { ok: true, jobs: enqueueRecurringInfraJobs() });
        }
        if (body.action === 'run-worker-once') {
          return json(res, 200, { ok: true, processed: await runWorkerLoop({ iterations: Number(body.iterations || 1) }) });
        }
        const job = enqueueBackgroundJob({
          jobType: body.jobType || 'graph-refresh',
          payload: body.payload || {},
          priority: Number(body.priority || 0)
        });
        return json(res, 200, { ok: true, job });
      }

      if (pathname === '/api/admin/postgres-migration') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.statusCode = 200;
        res.end(buildPostgresMigrationSql());
        return;
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

      if (pathname === '/api/profile' && req.method === 'GET') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        return json(res, 200, { profile: getUserProfile(ctx.session.userId) });
      }

      if (pathname === '/api/profile' && req.method === 'PATCH') {
        const ctx = requireSession(req, res);
        if (!ctx) return;
        const body = await readJsonBody(req);
        const profile = updateUserProfile({
          userId: ctx.session.userId,
          displayName: body.displayName || ctx.session.displayName,
          researchInterests: Array.isArray(body.researchInterests)
            ? body.researchInterests
            : String(body.researchInterests || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
          preferredSources: Array.isArray(body.preferredSources)
            ? body.preferredSources
            : String(body.preferredSources || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
          defaultRegion: body.defaultRegion || 'all',
          alertOptIn: Boolean(body.alertOptIn)
        });
        return json(res, 200, { ok: true, profile });
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
        const session = getSessionContext(req);
        const userProfile = session ? getUserProfile(session.session.userId) : null;
        const recommendations = await getRecommendationsById(id, Number(searchParams.get('limit') || 5), userProfile);
        return json(res, 200, { recommendations });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/citations')) {
        const id = pathname.split('/')[3];
        return json(res, 200, { citations: await getCitationsById(id, Number(searchParams.get('limit') || appConfig.citationExpansionLimit)) });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/references')) {
        const id = pathname.split('/')[3];
        return json(res, 200, { references: await getReferencesById(id, Number(searchParams.get('limit') || appConfig.citationExpansionLimit)) });
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

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/graph')) {
        const id = pathname.split('/')[3];
        const paper = await getPaperById(id);
        if (!paper) return notFound(res, 'Paper not found');
        return json(res, 200, { graph: paper.graph || {} });
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

export function startServer(
  port = Number(process.env.PORT || 3000),
  host = appConfig.host,
  options = {}
) {
  const server = createServer();
  const maxFallbackAttempts = Math.max(
    0,
    Number.isFinite(options.maxFallbackAttempts)
      ? Number(options.maxFallbackAttempts)
      : appConfig.portFallbackAttempts
  );
  const requestedPort = Number(port || 3000);
  let currentPort = requestedPort;
  let fallbackAttempts = 0;
  let startupLogged = false;

  server.on('listening', () => {
    if (startupLogged) return;
    startupLogged = true;
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : currentPort;
    const printableHost = host === '0.0.0.0' ? 'localhost' : host;
    const suffix =
      boundPort === requestedPort ? '' : ` (requested ${requestedPort}, auto-fallback after port conflict)`;
    console.log(`Scholaxis server listening on http://${printableHost}:${boundPort}${suffix}`);
  });

  function listenOn(portToUse) {
    currentPort = portToUse;
    server.listen(portToUse, host);
  }

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE' && fallbackAttempts < maxFallbackAttempts) {
      fallbackAttempts += 1;
      const nextPort = currentPort + 1;
      console.warn(
        `[startup] Port ${currentPort} is already in use. Retrying on ${host}:${nextPort} (${fallbackAttempts}/${maxFallbackAttempts}).`
      );
      listenOn(nextPort);
      return;
    }

    const message =
      error?.code === 'EADDRINUSE'
        ? `Port ${currentPort} is already in use. Close the other process, set PORT=<new-port>, or increase SCHOLAXIS_PORT_FALLBACK_ATTEMPTS.`
        : error?.code === 'EACCES' || error?.code === 'EPERM'
          ? `Unable to bind ${host}:${currentPort}. Try a different PORT/HOST or check OS sandbox permissions.`
          : error?.message || 'Unexpected server startup error';

    console.error(`[startup] ${message}`);
    if (error?.stack) console.error(error.stack);
    if (isDirectRun()) process.exitCode = 1;
  });
  listenOn(requestedPort);
  return server;
}

if (isDirectRun()) {
  startServer();
}
