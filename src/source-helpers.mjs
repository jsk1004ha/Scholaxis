import { appConfig } from './config.mjs';
import { normalizeText, unique } from './vector-service.mjs';

const QUERY_TRANSLATIONS = {
  배터리: ['battery'],
  열폭주: ['thermal runaway'],
  반도체: ['semiconductor'],
  설명가능ai: ['explainable ai', 'xai'],
  설명가능: ['explainable'],
  인공지능: ['artificial intelligence', 'ai'],
  연구탐색: ['research discovery', 'scholarly search'],
  특허: ['patent'],
  보고서: ['report'],
  논문: ['paper'],
  학생발명: ['student invention'],
  전람회: ['science fair'],
  결로: ['condensation'],
  터널: ['tunnel'],
  시계열: ['time series'],
  기후: ['climate'],
  정책: ['policy'],
  바이오: ['bio'],
  양자: ['quantum']
};

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

export function expandQueryVariants(query = '') {
  const base = String(query || '').trim();
  if (!base) return [];

  const normalized = normalizeText(base);
  const tokens = normalized.split(' ').filter(Boolean);
  const translated = [];

  for (const token of tokens) {
    if (QUERY_TRANSLATIONS[token]) translated.push(...QUERY_TRANSLATIONS[token]);
    if (token === 'ai') translated.push('artificial intelligence');
  }

  const joinedEnglish = translated.join(' ').trim();
  return unique([base, normalized, joinedEnglish].filter(Boolean));
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
