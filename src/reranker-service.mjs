import { appConfig } from './config.mjs';

let recentOllamaFailureAt = 0;
import { ensureLocalModelBackend, getLocalModelDiagnostics } from './local-model-runtime.mjs';
import { normalizeText, tokenize, unique } from './vector-service.mjs';

function localRerankerEnabled() {
  return Boolean(appConfig.localModelServiceUrl) && (
    Boolean(process.env.SCHOLAXIS_LOCAL_MODEL_SERVICE_URL) ||
    appConfig.localModelAutostart ||
    appConfig.rerankerProvider === 'hybrid-local'
  );
}

function tokenCoverage(tokens = [], text = '') {
  if (!tokens.length) return 0;
  const normalized = normalizeText(text);
  return tokens.filter((token) => normalized.includes(token)).length / tokens.length;
}

function bigramCoverage(query = '', text = '') {
  const tokens = unique(tokenize(query));
  if (tokens.length < 2) return 0;
  const grams = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    grams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  const normalized = normalizeText(text);
  return grams.filter((gram) => normalized.includes(gram)).length / grams.length;
}

function buildRerankScore(entry, query = '', crossLingual = null) {
  const titleText = [entry.item.title, entry.item.englishTitle].filter(Boolean).join(' ');
  const summaryText = [entry.item.abstract, entry.item.summary, ...(entry.item.keywords || []), ...(entry.item.methods || [])]
    .filter(Boolean)
    .join(' ');
  const title = normalizeText(titleText);
  const summary = normalizeText(summaryText);
  const baseTokens = unique(tokenize(query));
  const translatedTokens = unique(tokenize(crossLingual?.translatedQuery || ''));
  const normalizedQuery = normalizeText(query);
  const exactTitle = normalizedQuery ? title.includes(normalizedQuery) : false;
  const titleCoverage = tokenCoverage(baseTokens, titleText);
  const summaryCoverage = tokenCoverage(baseTokens, summaryText);
  const titleBigramCoverage = bigramCoverage(query, titleText);
  const summaryBigramCoverage = bigramCoverage(query, summaryText);
  const translatedCoverage = translatedTokens.length
    ? tokenCoverage(translatedTokens, `${titleText} ${summaryText}`)
    : 0;
  const keywordCoverage = (entry.item.keywords || []).length
    ? tokenCoverage(baseTokens, (entry.item.keywords || []).join(' '))
    : 0;
  const denseScore = Number(entry.scoreBundle?.denseScore || 0);
  const sparseScore = Number(entry.scoreBundle?.sparseScore || 0);
  const lexicalScore = Math.min(1, Number(entry.scoreBundle?.lexicalScore || 0) / 24);
  const citationBoost = Math.min((entry.item.citations || 0) / 300, 0.12);
  const freshnessBoost = entry.item.year ? Math.max(0, (entry.item.year - 2021) * 0.01) : 0;
  return {
    rerankScore:
      (exactTitle ? 0.28 : 0) +
      titleCoverage * 0.2 +
      summaryCoverage * 0.14 +
      titleBigramCoverage * 0.12 +
      summaryBigramCoverage * 0.08 +
      translatedCoverage * 0.12 +
      keywordCoverage * 0.08 +
      denseScore * 0.16 +
      sparseScore * 0.1 +
      lexicalScore * 0.06 +
      citationBoost +
      freshnessBoost,
    rerankReason: [
      exactTitle ? '제목 직접 일치' : null,
      titleCoverage >= 0.5 ? '제목 핵심어 정합성 높음' : null,
      summaryCoverage >= 0.34 ? '초록/요약 정합성 높음' : null,
      titleBigramCoverage >= 0.5 ? '핵심 구문이 제목에 반영됨' : null,
      translatedCoverage >= 0.34 ? '교차언어 질의와 정합' : null,
      keywordCoverage >= 0.34 ? '키워드 직접 매칭' : null,
      denseScore >= 0.45 ? '의미 임베딩 정합성 높음' : null,
      sparseScore >= 0.08 ? '희소 표현 정합성 높음' : null,
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
  const url = new URL(appConfig.rerankerServiceUrl);
  if (!url.pathname || url.pathname === '/') url.pathname = '/rerank';
  const response = await fetch(url, {
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
        methods: entry.item.methods || [],
        citations: entry.item.citations || 0,
        year: entry.item.year || null,
      }))
    })
  });
  if (!response.ok) throw new Error(`reranker backend request failed: ${response.status}`);
  const payload = await response.json();
  recentOllamaFailureAt = 0;
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

async function localCrossEncoderRerank(entries = [], query = '', crossLingual = null, topK = 12) {
  await ensureLocalModelBackend();
  const response = await fetch(new URL('/rerank', appConfig.localModelServiceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: appConfig.rerankerModel,
      query: [query, crossLingual?.translatedQuery].filter(Boolean).join('\n').trim() || query,
      topK,
      candidates: entries.slice(0, topK).map((entry) => ({
        id: entry.item.canonicalId || entry.item.id,
        title: entry.item.title || '',
        englishTitle: entry.item.englishTitle || '',
        abstract: entry.item.abstract || '',
        summary: entry.item.summary || '',
        keywords: entry.item.keywords || [],
        methods: entry.item.methods || [],
        highlights: entry.item.highlights || [],
        citations: entry.item.citations || 0,
        year: entry.item.year || null,
      }))
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`local reranker request failed: ${response.status}`);
  const payload = await response.json();
  recentOllamaFailureAt = 0;
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
          rerankReason: item.reason || '로컬 cross-encoder 재정렬',
          total: current.scoreBundle.total + Number(item.score || 0) * 100,
        }
      };
    })
    .filter(Boolean);
  const used = new Set(rerankedHead.map((entry) => entry.item.canonicalId || entry.item.id));
  return {
    entries: [...rerankedHead, ...entries.filter((entry) => !used.has(entry.item.canonicalId || entry.item.id))],
    diagnostics: {
      backend: 'hybrid-local',
      applied: true,
      topK: Math.min(topK, entries.length),
      model: appConfig.rerankerModel,
    }
  };
}

async function ollamaRerank(entries = [], query = '', crossLingual = null, topK = 12) {
  if (appConfig.rerankerProvider === 'auto' && recentOllamaFailureAt && Date.now() - recentOllamaFailureAt < 5 * 60 * 1000) {
    throw new Error('ollama reranker temporarily unavailable');
  }
  const prompt = {
    instruction: 'Rank scholarly search candidates by topical relevance for Korean and English research discovery. Return strict JSON with results: [{id, score, reason}]. Score range 0 to 1. Focus on semantic relevance, exact-title matches, abstract fit, and cross-lingual equivalence. Do not invent ids.',
    query,
    translatedQuery: crossLingual?.translatedQuery || '',
    candidates: entries.slice(0, topK).map((entry) => ({
      id: entry.item.canonicalId || entry.item.id,
      title: entry.item.title || '',
      englishTitle: entry.item.englishTitle || '',
      abstract: entry.item.abstract || '',
      summary: entry.item.summary || '',
      keywords: entry.item.keywords || [],
      methods: entry.item.methods || [],
      citations: entry.item.citations || 0,
      year: entry.item.year || null,
      source: entry.item.source || ''
    }))
  };

  const response = await fetch(new URL('/api/generate', appConfig.ollamaUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: appConfig.ollamaRerankerModel,
      stream: false,
      format: 'json',
      keep_alive: appConfig.ollamaKeepAlive,
      prompt: JSON.stringify(prompt)
    }),
    signal: AbortSignal.timeout(appConfig.rerankerProvider === 'auto' ? Math.min(appConfig.modelRequestTimeoutMs, 1500) : appConfig.modelRequestTimeoutMs)
  });
  if (!response.ok) { recentOllamaFailureAt = Date.now(); throw new Error(`ollama reranker request failed: ${response.status}`); }
  const payload = await response.json();
  recentOllamaFailureAt = 0;
  const parsed = JSON.parse(payload.response || '{}');
  const byId = new Map(entries.map((entry) => [entry.item.canonicalId || entry.item.id, entry]));
  const rerankedHead = (parsed.results || [])
    .map((item) => {
      const current = byId.get(item.id);
      if (!current) return null;
      return {
        ...current,
        scoreBundle: {
          ...current.scoreBundle,
          rerankScore: Number(item.score || 0),
          rerankReason: item.reason || 'Ollama reranker 재정렬',
          total: current.scoreBundle.total + Number(item.score || 0) * 100,
        }
      };
    })
    .filter(Boolean);
  const used = new Set(rerankedHead.map((entry) => entry.item.canonicalId || entry.item.id));
  return {
    entries: [...rerankedHead, ...entries.filter((entry) => !used.has(entry.item.canonicalId || entry.item.id))],
    diagnostics: {
      backend: 'ollama',
      applied: true,
      topK: Math.min(topK, entries.length),
    }
  };
}

export async function rerankSearchEntries(entries = [], query = '', crossLingual = null, topK = 12) {
  if (!entries.length) {
    return { entries, diagnostics: { backend: 'none', applied: false, topK: 0 } };
  }

  if (
    ['hybrid-local', 'auto'].includes(appConfig.rerankerProvider) &&
    localRerankerEnabled()
  ) {
    try {
      return await localCrossEncoderRerank(entries, query, crossLingual, topK);
    } catch (error) {
      if (appConfig.rerankerProvider === 'hybrid-local') {
        const fallback = heuristicRerank(entries, query, crossLingual, topK);
        return {
          ...fallback,
          diagnostics: {
            ...fallback.diagnostics,
            backend: 'heuristic',
            fallbackReason: error.message
          }
        };
      }
    }
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

  if (['auto', 'ollama'].includes(appConfig.rerankerProvider)) {
    try {
      return await ollamaRerank(entries, query, crossLingual, topK);
    } catch (error) {
      const fallback = heuristicRerank(entries, query, crossLingual, topK);
      return {
        ...fallback,
        diagnostics: {
          ...fallback.diagnostics,
          backend: 'heuristic',
          fallbackReason: error.message
        }
      };
    }
  }

  return heuristicRerank(entries, query, crossLingual, topK);
}

export function getRerankerDiagnostics() {
  return {
    configured:
      Boolean(appConfig.rerankerServiceUrl) ||
      Boolean(appConfig.localModelServiceUrl) ||
      ['auto', 'ollama'].includes(appConfig.rerankerProvider),
    backend:
      appConfig.rerankerServiceUrl
        ? 'http'
        : localRerankerEnabled()
          ? 'hybrid-local'
          : appConfig.rerankerProvider,
    serviceUrl: appConfig.rerankerServiceUrl || '',
    ollamaUrl: appConfig.ollamaUrl,
    model: localRerankerEnabled() ? appConfig.rerankerModel : appConfig.ollamaRerankerModel,
    topK: appConfig.rerankerTopK,
    localModels: getLocalModelDiagnostics(),
  };
}
