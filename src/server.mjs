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
  expandPaperById,
  getPaperById,
  getSearchSuggestions,
  listSourceStatuses,
  listTrends,
  searchCatalog
} from './search-service.mjs';
import { buildSimilarityReport } from './similarity-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

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

export function createServer() {
  return http.createServer(async (req, res) => {
    applySecurityHeaders(res);

    if (!req.url || !req.method) {
      return notFound(res);
    }

    const url = new URL(req.url, 'http://localhost');
    const { pathname, searchParams } = url;

    try {
      if (pathname === '/api/health') {
        return json(res, 200, { ok: true, service: 'scholaxis', timestamp: new Date().toISOString() });
      }

      if (pathname === '/api/trends') {
        return json(res, 200, { topics: listTrends() });
      }

      if (pathname === '/api/search') {
        const payload = searchCatalog({
          q: searchParams.get('q') || '',
          region: searchParams.get('region') || 'all',
          sourceType: searchParams.get('sourceType') || 'all',
          sort: searchParams.get('sort') || 'relevance'
        });

        return json(
          res,
          200,
          {
            ...payload,
            data: {
              ...payload,
              items: payload.items
            }
          }
        );
      }

      if (pathname === '/api/search/suggestions') {
        return json(res, 200, getSearchSuggestions(searchParams.get('q') || ''));
      }

      if (pathname === '/api/sources/status') {
        return json(res, 200, { sources: listSourceStatuses() });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/related')) {
        const id = pathname.split('/')[3];
        const paper = getPaperById(id);
        if (!paper) return notFound(res, 'Paper not found');
        return json(res, 200, { related: paper.related });
      }

      if (pathname.startsWith('/api/papers/') && pathname.endsWith('/expand')) {
        const id = pathname.split('/')[3];
        const expansion = expandPaperById(id);
        if (!expansion) return notFound(res, 'Paper not found');
        return json(res, 200, expansion);
      }

      if (pathname.startsWith('/api/papers/')) {
        const id = pathname.split('/')[3];
        const paper = getPaperById(id);
        if (!paper) return notFound(res, 'Paper not found');
        return json(res, 200, {
          ...paper,
          paper
        });
      }

      if (pathname === '/api/similarity/report' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return json(res, 200, buildSimilarityFromRequest(body));
      }

      if (pathname === '/api/similarity/analyze' && req.method === 'POST') {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          const body = await readJsonBody(req);
          return json(res, 200, buildSimilarityFromRequest(body));
        }

        const rawBody = await readRawBody(req, 1_000_000);
        const fields = contentType.includes('multipart/form-data') ? parseMultipartForm(rawBody, contentType) : {};
        const fileField = fields.report || fields.file || {};
        const title = fileField.filename || fields.title?.value || '업로드 문서';
        const text = fields.text?.value || fields.content?.value || `${title} research manuscript scholarly similarity analysis`;
        return json(
          res,
          200,
          buildSimilarityFromRequest(
            {
              title,
              text
            },
            title
          )
        );
      }

      if (pathname.startsWith('/api/')) {
        return notFound(res, 'API route not found');
      }

      const served = await serveStatic(pathname, res, publicDir);
      if (served) return;

      const fallbackServed = await serveStatic('/index.html', res, publicDir);
      if (fallbackServed) return;

      return notFound(res);
    } catch (error) {
      return json(res, error.statusCode || 500, {
        error: error.message || 'Unexpected server error'
      });
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
