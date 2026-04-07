import { appConfig } from './config.mjs';
import { normalizeText, tokenize, unique } from './vector-service.mjs';

function buildRerankScore(entry, query = '', crossLingual = null) {
  const title = normalizeText([entry.item.title, entry.item.englishTitle].filter(Boolean).join(' '));
  const summary = normalizeText([entry.item.abstract, entry.item.summary, ...(entry.item.keywords || [])].filter(Boolean).join(' '));
  const baseTokens = unique(tokenize(query));
  const translatedTokens = unique(tokenize(crossLingual?.translatedQuery || ''));
  const exactTitle = query ? title.includes(normalizeText(query)) : false;
  const titleCoverage = baseTokens.length ? baseTokens.filter((token) => title.includes(token)).length / baseTokens.length : 0;
  const summaryCoverage = baseTokens.length ? baseTokens.filter((token) => summary.includes(token)).length / baseTokens.length : 0;
  const translatedCoverage = translatedTokens.length
    ? translatedTokens.filter((token) => title.includes(token) || summary.includes(token)).length / translatedTokens.length
    : 0;
  const citationBoost = Math.min((entry.item.citations || 0) / 250, 0.12);
  return {
    rerankScore:
      (exactTitle ? 0.2 : 0) +
      titleCoverage * 0.24 +
      summaryCoverage * 0.18 +
      translatedCoverage * 0.2 +
      citationBoost,
    rerankReason: [
      exactTitle ? '제목 직접 일치' : null,
      titleCoverage >= 0.34 ? '제목 핵심어 정합성 높음' : null,
      summaryCoverage >= 0.28 ? '초록/요약 정합성 높음' : null,
      translatedCoverage >= 0.3 ? '번역 질의와 교차언어 일치' : null,
      citationBoost >= 0.04 ? '인용 신호 보강' : null,
    ].filter(Boolean).join(' · ')
  };
}

function heuristicRerank(entries = [], query = '', crossLingual = null, topK = 12) {
  const head = entries.slice(0, topK).map((entry) => {
    const rerank = buildRerankScore(entry, query, crossLingual);
    return {
      ...entry,
      scoreBundle: {
        ...entry.scoreBundle,
        rerankScore: rerank.rerankScore,
        rerankReason: rerank.rerankReason,
        total: entry.scoreBundle.total + rerank.rerankScore * 100,
      }
    };
  }).sort((a, b) => b.scoreBundle.total - a.scoreBundle.total);

  return {
    entries: [...head, ...entries.slice(topK)],
    diagnostics: {
      backend: 'heuristic',
      applied: true,
      topK: Math.min(topK, entries.length),
    }
  };
}

async function remoteRerank(entries = [], query = '', crossLingual = null, topK = 12) {
  const response = await fetch(new URL(appConfig.rerankerServiceUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(appConfig.rerankerApiKey ? { authorization: `Bearer ${appConfig.rerankerApiKey}` } : {})
    },
    body: JSON.stringify({
      query,
      translatedQuery: crossLingual?.translatedQuery || '',
      topK,
      candidates: entries.slice(0, topK).map((entry) => ({
        id: entry.item.canonicalId || entry.item.id,
        title: entry.item.title || '',
        englishTitle: entry.item.englishTitle || '',
        abstract: entry.item.abstract || '',
        summary: entry.item.summary || '',
        keywords: entry.item.keywords || [],
        citations: entry.item.citations || 0,
      }))
    })
  });
  if (!response.ok) throw new Error(`reranker backend request failed: ${response.status}`);
  const payload = await response.json();
  const byId = new Map(entries.map((entry) => [entry.item.canonicalId || entry.item.id, entry]));
  const rerankedHead = (payload.results || [])
    .map((item) => {
      const current = byId.get(item.id);
      if (!current) return null;
      return {
        ...current,
        scoreBundle: {
          ...current.scoreBundle,
          rerankScore: Number(item.score || 0),
          rerankReason: item.reason || '외부 reranker 재정렬',
          total: current.scoreBundle.total + Number(item.score || 0) * 100,
        }
      };
    })
    .filter(Boolean);
  const used = new Set(rerankedHead.map((entry) => entry.item.canonicalId || entry.item.id));
  return {
    entries: [...rerankedHead, ...entries.filter((entry) => !used.has(entry.item.canonicalId || entry.item.id))],
    diagnostics: {
      backend: 'http',
      applied: true,
      topK: Math.min(topK, entries.length),
    }
  };
}

export async function rerankSearchEntries(entries = [], query = '', crossLingual = null, topK = 12) {
  if (!entries.length) {
    return { entries, diagnostics: { backend: 'none', applied: false, topK: 0 } };
  }

  if (appConfig.rerankerServiceUrl) {
    try {
      return await remoteRerank(entries, query, crossLingual, topK);
    } catch (error) {
      const fallback = heuristicRerank(entries, query, crossLingual, topK);
      return {
        ...fallback,
        diagnostics: {
          ...fallback.diagnostics,
          fallbackReason: error.message
        }
      };
    }
  }

  return heuristicRerank(entries, query, crossLingual, topK);
}

export function getRerankerDiagnostics() {
  return {
    configured: Boolean(appConfig.rerankerServiceUrl),
    backend: appConfig.rerankerServiceUrl ? 'http' : 'heuristic',
    serviceUrl: appConfig.rerankerServiceUrl || '',
    topK: appConfig.rerankerTopK,
  };
}
