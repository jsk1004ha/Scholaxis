import { appConfig } from './config.mjs';
import { normalizeText, unique } from './vector-service.mjs';

export function makeAbortSignal(timeoutMs = appConfig.sourceTimeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || appConfig.sourceTimeoutMs;
  const userAgent = options.userAgent || appConfig.userAgent;
  const headers = {
    ...(userAgent ? { 'user-agent': userAgent } : {}),
    ...(options.accept ? { accept: options.accept } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || makeAbortSignal(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Source request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

export function decodeEntities(text = '') {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function stripTags(text = '') {
  return decodeEntities(
    decodeEntities(
      String(text)
        .replace(/<!\[CDATA\[|\]\]>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  ).replace(/\s+/g, ' ').trim();
}

export function textBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) return '';
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex === -1) return source.slice(startIndex + start.length);
  return source.slice(startIndex + start.length, endIndex);
}

export function findAllMatches(source, regex) {
  return [...String(source).matchAll(regex)];
}

export function extractListItems(html, rowRegex, mapper) {
  return findAllMatches(html, rowRegex)
    .map((match) => mapper(match))
    .filter(Boolean);
}

export function buildSourceStatus(source, overrides = {}) {
  return {
    source,
    status: overrides.status || 'offline',
    latency: overrides.latency || 'unknown',
    coverage: overrides.coverage || '',
    note: overrides.note || '',
    detailUrl: overrides.detailUrl || ''
  };
}

export function normalizeAuthors(input) {
  return unique(
    String(input || '')
      .split(/[,;·]| and /i)
      .map((item) => stripTags(item))
      .filter(Boolean)
  );
}

export function estimateRegion(source) {
  return ['kci', 'riss', 'scienceon', 'dbpia', 'ntis', 'kipris', 'science_fair', 'student_invention_fair'].includes(source)
    ? 'domestic'
    : 'global';
}

export function buildDocument(base) {
  return {
    citations: 0,
    openAccess: false,
    keywords: [],
    methods: [],
    highlights: [],
    links: {},
    sourceIds: {},
    region: estimateRegion(base.source),
    language: 'mixed',
    ...base
  };
}

export function summarizeDocument(document) {
  if (document.summary) return document.summary;
  const abstract = stripTags(document.abstract || '');
  return abstract.length > 180 ? `${abstract.slice(0, 177)}...` : abstract;
}

export function safeYear(value) {
  const match = String(value || '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

export function normalizeKeywordBag(query = '') {
  return unique(normalizeText(query).split(' ').filter((token) => token.length >= 2));
}

export function hasBrokenEncoding(text = '') {
  const value = String(text || '');
  if (!value.trim()) return false;
  return /�/.test(value);
}

export function looksLikeNoise(text = '') {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/engjungsung|engjongsung|input text|현재 페이지|function\s*\(|document\.|window\.|var\s+|const\s+|return\s+/i.test(value)) {
    return true;
  }
  if (/[{}[\];<>]|==|=>|\+\s*\d/.test(value)) return true;
  const asciiWords = (value.match(/[A-Za-z]{10,}/g) || []).length;
  const symbolCount = (value.match(/[=+_*\\/]/g) || []).length;
  return asciiWords >= 3 || symbolCount >= 6;
}

export function matchesQueryText(text = '', query = '') {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  if (normalizedText.includes(normalizedQuery)) return true;
  if (normalizedText.replace(/\s+/g, '').includes(normalizedQuery.replace(/\s+/g, ''))) return true;
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const overlap = queryTokens.filter((token) => normalizedText.includes(token));
  return overlap.length >= Math.max(1, Math.ceil(queryTokens.length / 2));
}

export function isUsableSearchText(text = '', query = '') {
  return !hasBrokenEncoding(text) && !looksLikeNoise(text) && matchesQueryText(text, query);
}

export function expandQueryVariants(query = '') {
  const base = String(query || '').trim();
  if (!base) return [];

  const normalized = normalizeText(base);
  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(' ').filter(Boolean);
  const windows = [];

  if (tokens.length >= 2) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      windows.push(tokens.slice(index, index + 2).join(' '));
    }
  }

  return unique([base, normalized, compact, ...windows].filter(Boolean));
}

function detectLanguage(value = '') {
  if (!String(value || '').trim()) return 'none';
  const hasKorean = /[가-힣]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasKorean && hasLatin) return 'mixed';
  if (hasKorean) return 'ko';
  if (hasLatin) return 'en';
  return 'other';
}

function resolveTranslationProvider() {
  if (appConfig.translationProvider && appConfig.translationProvider !== 'generic') {
    return appConfig.translationProvider;
  }
  const url = String(appConfig.translationServiceUrl || '').toLowerCase();
  if (url.includes('libretranslate')) return 'libretranslate';
  return 'generic';
}

async function translateWithBackend(text = '', source = 'auto', target = 'en') {
  if (!appConfig.translationServiceUrl) return '';
  const provider = resolveTranslationProvider();
  const url = new URL(appConfig.translationServiceUrl);
  let body = { text, source, target };
  const headers = {
    'content-type': 'application/json',
    ...(appConfig.translationApiKey ? { authorization: `Bearer ${appConfig.translationApiKey}` } : {})
  };

  if (provider === 'libretranslate') {
    body = {
      q: text,
      source,
      target,
      format: 'text',
      ...(appConfig.translationApiKey ? { api_key: appConfig.translationApiKey } : {})
    };
    delete headers.authorization;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`translation backend request failed: ${response.status}`);
  const payload = await response.json();
  return String(
    payload.translation ||
    payload.translatedText ||
    payload.text ||
    ''
  ).trim();
}

export async function buildCrossLingualQueryContext(query = '') {
  const base = String(query || '').trim();
  if (!base) {
    return {
      enabled: false,
      originalQuery: '',
      language: 'none',
      direction: 'none',
      translatedQuery: '',
      variants: [],
      backend: appConfig.translationServiceUrl ? 'http' : 'disabled',
      reason: 'empty-query'
    };
  }

  const normalized = normalizeText(base);
  const language = detectLanguage(base);
  const variants = expandQueryVariants(base);
  if (!appConfig.translationServiceUrl) {
    return {
      enabled: false,
      originalQuery: base,
      language,
      direction: 'none',
      translatedQuery: '',
      variants,
      backend: 'disabled',
      reason: 'translation-backend-not-configured'
    };
  }

  if (language === 'ko') {
    const translatedQuery = await translateWithBackend(base, 'ko', 'en');
    return {
      enabled: Boolean(translatedQuery),
      originalQuery: base,
      language,
      direction: translatedQuery ? 'ko-to-en' : 'none',
      translatedQuery,
      variants: unique([...variants, translatedQuery].filter(Boolean)),
      backend: 'http',
      reason: translatedQuery ? '' : 'translation-empty'
    };
  }

  if (language === 'en') {
    const translatedQuery = await translateWithBackend(base, 'en', 'ko');
    return {
      enabled: Boolean(translatedQuery),
      originalQuery: base,
      language,
      direction: translatedQuery ? 'en-to-ko' : 'none',
      translatedQuery,
      variants: unique([...variants, translatedQuery].filter(Boolean)),
      backend: 'http',
      reason: translatedQuery ? '' : 'translation-empty'
    };
  }

  return {
    enabled: false,
    originalQuery: base,
    language,
    direction: 'none',
    translatedQuery: '',
    variants,
    backend: 'http',
    reason: language === 'mixed' ? 'mixed-language-query' : 'unsupported-language'
  };
}

export function mergeSourceStatuses(staticStatuses = [], runtimeStatuses = []) {
  const bySource = new Map();
  for (const status of staticStatuses) bySource.set(status.source, { ...status });
  for (const status of runtimeStatuses) {
    const current = bySource.get(status.source) || {};
    bySource.set(status.source, { ...current, ...status, detailUrl: status.detailUrl || current.detailUrl || '' });
  }
  return [...bySource.values()];
}
