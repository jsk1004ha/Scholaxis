import http from 'node:http';
import { appConfig } from './config.mjs';
import { normalizeText, tokenize, unique } from './vector-service.mjs';

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

function scoreCandidate(candidate = {}, query = '', translatedQuery = '') {
  const title = normalizeText([candidate.title, candidate.englishTitle].filter(Boolean).join(' '));
  const summary = normalizeText([candidate.abstract, candidate.summary, ...(candidate.keywords || [])].filter(Boolean).join(' '));
  const baseTokens = unique(tokenize(query));
  const translatedTokens = unique(tokenize(translatedQuery));
  const exactTitle = query ? title.includes(normalizeText(query)) : false;
  const titleCoverage = baseTokens.length ? baseTokens.filter((token) => title.includes(token)).length / baseTokens.length : 0;
  const summaryCoverage = baseTokens.length ? baseTokens.filter((token) => summary.includes(token)).length / baseTokens.length : 0;
  const translatedCoverage = translatedTokens.length
    ? translatedTokens.filter((token) => title.includes(token) || summary.includes(token)).length / translatedTokens.length
    : 0;
  const citationBoost = Math.min((candidate.citations || 0) / 250, 0.12);

  const score =
    (exactTitle ? 0.2 : 0) +
    titleCoverage * 0.24 +
    summaryCoverage * 0.18 +
    translatedCoverage * 0.2 +
    citationBoost;

  return {
    score,
    reason: [
      exactTitle ? '제목 직접 일치' : null,
      titleCoverage >= 0.34 ? '제목 핵심어 정합성 높음' : null,
      summaryCoverage >= 0.28 ? '초록/요약 정합성 높음' : null,
      translatedCoverage >= 0.3 ? '번역 질의와 교차언어 일치' : null,
      citationBoost >= 0.04 ? '인용 신호 보강' : null,
    ].filter(Boolean).join(' · ')
  };
}

export function createRerankerBackendServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, backend: 'local-http', topK: appConfig.rerankerTopK });
    }

    if (url.pathname === '/rerank' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const results = (body.candidates || [])
        .map((candidate) => ({
          id: candidate.id,
          ...scoreCandidate(candidate, body.query || '', body.translatedQuery || '')
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(body.topK || appConfig.rerankerTopK || 12));

      return json(res, 200, {
        ok: true,
        backend: 'local-http',
        results
      });
    }

    return json(res, 404, { error: 'not found' });
  });
}
