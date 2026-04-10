import { appConfig } from './config.mjs';
import { expandSemanticLexiconTerms, semanticLexiconGroups } from './semantic-lexicon.mjs';
import { normalizeText, tokenize, unique } from './vector-service.mjs';

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
  const normalized = decodeEntities(
    decodeEntities(
      String(text)
        .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    )
  );

  return decodeEntities(normalized.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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
  return ['kci', 'riss', 'scienceon', 'dbpia', 'kiss', 'nanet', 'ntis', 'kipris', 'science_fair', 'student_invention_fair'].includes(source)
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

export function isGuidanceOnlyFairDocument(document = {}) {
  const source = String(document.source || document.sourceKey || '').trim();
  const title = stripTags(document.title || '');
  return ['science_fair', 'student_invention_fair'].includes(source) && /^\(지도논문\)/.test(title);
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
  const symbolCount = (value.match(/[=+_*\\/]/g) || []).length;
  const codeLikeLines = (value.match(/[A-Za-z_]+\([^)]*\)|[A-Za-z_]+\.[A-Za-z_]+|<\/?[A-Za-z]+>/g) || []).length;
  return symbolCount >= 6 || codeLikeLines >= 3;
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

const QUERY_PROFILE_HINTS = {
  patent: ['patent', '특허', 'kipris', '실용신안'],
  report: ['report', '보고서', 'ntis', '과제', '성과', 'rne', 'r&e', '알앤이'],
  fair: ['science fair', 'student invention', '발명', '전람회', 'rne', 'r&e', '알앤이', '과학전람회', '발명품경진대회'],
  humanities: ['문학', '역사', '철학', '예술', '미술', '연극', 'humanities', 'archaeology'],
  education: ['교육', '학습', '수학 불안', '국어 교육', 'pedagogy', 'education'],
  biomedical: ['bio', 'biorxiv', 'medrxiv', 'pubmed', '의료', '의학', '생명과학', '유전자', '면역', '임플란트', 'medical', 'genetic', 'immun', 'clinical'],
  engineering: ['반도체', '배터리', '드론', '센서', '로봇', 'semiconductor', 'battery', 'drone', 'robot', 'sensor'],
  earth_space: ['기후', '산불', '우주', '위성', '홍수', '지진', 'climate', 'wildfire', 'space', 'satellite', 'flood', 'earthquake'],
  security: ['security', 'cyber', 'cve', '취약점', '보안', '해킹', '익스플로잇', 'exploit', 'malware', '랜섬웨어', 'def con', 'black hat', 'reverse engineering'],
};

function isRneLikeQuery(raw = '', normalized = '') {
  const compactNormalized = String(normalized || '').replace(/\s+/g, '');
  return (
    /\br\s*&\s*e\b/i.test(raw) ||
    /\brne\b/i.test(raw) ||
    compactNormalized.includes('알앤이')
  );
}

function hasExplicitScienceFairHint(raw = '', normalized = '') {
  return (
    /science\s*fair/i.test(raw) ||
    String(normalized || '').includes('과학전람회') ||
    String(normalized || '').includes('전람회')
  );
}

function hasExplicitStudentInventionHint(raw = '', normalized = '') {
  const compactNormalized = String(normalized || '').replace(/\s+/g, '');
  return (
    /student\s+invention/i.test(raw) ||
    compactNormalized.includes('학생발명') ||
    compactNormalized.includes('발명품경진대회') ||
    String(normalized || '').includes('발명품')
  );
}

export function classifyQueryProfile(query = '') {
  const raw = String(query || '').trim();
  const normalized = normalizeText(raw);
  const tokens = unique(tokenize(raw));
  const joined = [normalized, ...tokens].join(' ');
  const has = (group) => QUERY_PROFILE_HINTS[group].some((hint) => joined.includes(normalizeText(hint)));
  const rneLikeQuery = isRneLikeQuery(raw, normalized);
  const explicitScienceFairHint = hasExplicitScienceFairHint(raw, normalized);
  const explicitStudentInventionHint = hasExplicitStudentInventionHint(raw, normalized);

  const types = [];
  if (has('patent')) types.push('patent');
  if (has('report') || rneLikeQuery) types.push('report');
  if (has('fair')) types.push('fair_entry');
  if (rneLikeQuery) types.push('fair_entry');
  if (!types.length) types.push('paper');

  const domains = [];
  for (const domain of ['humanities', 'education', 'biomedical', 'engineering', 'earth_space', 'security']) {
    if (has(domain)) domains.push(domain);
  }

  const sourceHints = [];
  if (types.includes('patent')) sourceHints.push('kipris');
  if (types.includes('report')) {
    if (rneLikeQuery) sourceHints.push('rne_report', 'ntis');
    else sourceHints.push('ntis', 'rne_report');
  }
  if (types.includes('fair_entry')) {
    if (explicitScienceFairHint) sourceHints.push('science_fair');
    if (explicitStudentInventionHint) sourceHints.push('student_invention_fair');
    if (rneLikeQuery) sourceHints.push('rne_report');
    if (!explicitScienceFairHint && !explicitStudentInventionHint && !rneLikeQuery) {
      sourceHints.push('science_fair', 'student_invention_fair', 'rne_report');
    }
  }
  if (domains.includes('humanities') || domains.includes('education')) sourceHints.push('riss', 'kci', 'dbpia', 'kiss', 'nanet');
  if (domains.includes('biomedical')) sourceHints.push('pubmed', 'biorxiv', 'medrxiv', 'scienceon', 'semantic_scholar', 'riss');
  if (domains.includes('engineering')) sourceHints.push('arxiv', 'semantic_scholar', 'kci', 'dbpia', 'kipris');
  if (domains.includes('earth_space')) sourceHints.push('semantic_scholar', 'arxiv', 'scienceon', 'ntis');
  if (domains.includes('security')) sourceHints.push('cve', 'blackhat', 'defcon');

  const language = detectLanguage(raw);
  return {
    query: raw,
    language,
    requestedTypes: unique(types),
    domains,
    sourceHints: unique(sourceHints),
  };
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

const LEXICON_CROSSLINGUAL_GENERIC_LATIN = new Set([
  'search',
  'retrieval',
  'discovery',
  'research',
  'paper',
  'article',
  'study',
  'report',
  'graph',
  'network',
  'ai',
]);

const LEXICON_CROSSLINGUAL_GENERIC_KOREAN = new Set([
  '검색',
  '연구',
  '논문',
  '자료',
  '보고서',
  '그래프',
  '네트워크',
  '인공지능',
]);

const LEXICON_FALLBACK_SEED_STOPWORDS_LATIN = new Set([
  'new',
  'topic',
  'search',
  'research',
  'paper',
  'article',
  'study',
  'report',
]);

const LEXICON_FALLBACK_SEED_STOPWORDS_KOREAN = new Set([
  '새로운',
  '주제',
  '검색',
  '연구',
  '논문',
  '보고서',
  '자료',
]);

function buildQueryWindows(query = '') {
  const tokens = unique(tokenize(query));
  const windows = [];
  if (tokens.length >= 2) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      windows.push(tokens.slice(index, index + 2).join(' '));
    }
  }
  if (tokens.length >= 3) {
    for (let index = 0; index < tokens.length - 2; index += 1) {
      windows.push(tokens.slice(index, index + 3).join(' '));
    }
  }
  return windows;
}

function buildLexiconFallbackTranslation(query = '', language = 'none') {
  if (!['ko', 'en'].includes(language)) return '';

  const normalizedQuery = normalizeText(query);
  const normalizedTokens = unique(tokenize(query).map((token) => normalizeText(token)).filter(Boolean));
  const seeds = unique([
    query,
    ...buildQueryWindows(query),
    ...tokenize(query),
  ])
    .filter(Boolean)
    .filter((term) => {
      const normalized = normalizeText(term);
      if (!normalized) return false;
      const tokens = normalized.split(' ').filter(Boolean);
      const stopwords = language === 'ko'
        ? LEXICON_FALLBACK_SEED_STOPWORDS_KOREAN
        : LEXICON_FALLBACK_SEED_STOPWORDS_LATIN;
      return tokens.some((token) => !stopwords.has(token));
    });

  const matchedGroups = semanticLexiconGroups().filter((group) => {
    return group.some((term) => {
      if (!term) return false;
      if (term.includes(' ')) {
        return normalizedQuery.includes(term);
      }
      return normalizedTokens.includes(term);
    });
  });

  const candidates = matchedGroups.flatMap((group) => {
    const sourceTerms = group.filter((term) => (language === 'ko' ? /[가-힣]/.test(term) : /[A-Za-z]/.test(term)));
    const matchedSourceTerms = sourceTerms.filter((term) => {
      if (term.includes(' ')) return normalizedQuery.includes(term);
      return normalizedTokens.includes(term);
    });
    const matchIndex = sourceTerms
      .map((term) => normalizedQuery.indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? Number.MAX_SAFE_INTEGER;
    const phraseMatched = matchedSourceTerms.some((term) => term.includes(' '));
    return group
      .filter((term) => (language === 'ko' ? /[A-Za-z]/.test(term) : /[가-힣]/.test(term)))
      .map((term) => ({ term, matchIndex, phraseMatched }));
  });

  const filtered = candidates.filter(({ term }) => {
    const normalized = normalizeText(term);
    if (!normalized) return false;
    if (language === 'ko') return !LEXICON_CROSSLINGUAL_GENERIC_LATIN.has(normalized);
    return !LEXICON_CROSSLINGUAL_GENERIC_KOREAN.has(normalized);
  });

  const scored = filtered
    .map(({ term, matchIndex, phraseMatched }) => {
      const normalized = normalizeText(term);
      const phrase = /\s/.test(term);
      const score =
        (phrase ? 100 : 0) +
        (matchedGroups.some((group) => group.includes(term) && group.some((item) => item.includes(' '))) ? 25 : 0) +
        (phraseMatched ? 80 : 0) +
        (Number.isFinite(matchIndex) ? Math.max(0, 200 - matchIndex) : 0) +
        normalized.length;
      return { term, normalized, score, matchIndex };
    })
    .sort((a, b) => b.score - a.score || a.matchIndex - b.matchIndex || a.normalized.localeCompare(b.normalized));

  const selected = unique(scored.map((item) => item.term)).slice(0, 4);
  const hasStrongPhrase = selected.some((term) => /\s/.test(term) || normalizeText(term).length >= 8);
  if (!hasStrongPhrase) return '';
  return {
    translatedQuery: selected[0],
    translatedVariants: selected,
  };
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
  const lexiconFallback = buildLexiconFallbackTranslation(base, language);
  if (!appConfig.translationServiceUrl) {
    if (lexiconFallback) {
      return {
        enabled: true,
        originalQuery: base,
        language,
        direction: language === 'ko' ? 'ko-to-en' : language === 'en' ? 'en-to-ko' : 'none',
        translatedQuery: lexiconFallback.translatedQuery,
        translatedVariants: lexiconFallback.translatedVariants,
        variants: unique([...variants, ...lexiconFallback.translatedVariants].filter(Boolean)),
        backend: 'lexicon',
        reason: 'lexicon-fallback'
      };
    }
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
    const translatedQuery = await translateWithBackend(base, 'ko', 'en') || lexiconFallback?.translatedQuery || '';
    const translatedVariants = lexiconFallback?.translatedVariants || (translatedQuery ? [translatedQuery] : []);
    return {
      enabled: Boolean(translatedQuery),
      originalQuery: base,
      language,
      direction: translatedQuery ? 'ko-to-en' : 'none',
      translatedQuery,
      translatedVariants,
      variants: unique([...variants, ...translatedVariants, translatedQuery].filter(Boolean)),
      backend: translatedQuery && translatedQuery === lexiconFallback?.translatedQuery ? 'lexicon' : 'http',
      reason: translatedQuery ? (translatedQuery === lexiconFallback?.translatedQuery ? 'lexicon-fallback' : '') : 'translation-empty'
    };
  }

  if (language === 'en') {
    const translatedQuery = await translateWithBackend(base, 'en', 'ko') || lexiconFallback?.translatedQuery || '';
    const translatedVariants = lexiconFallback?.translatedVariants || (translatedQuery ? [translatedQuery] : []);
    return {
      enabled: Boolean(translatedQuery),
      originalQuery: base,
      language,
      direction: translatedQuery ? 'en-to-ko' : 'none',
      translatedQuery,
      translatedVariants,
      variants: unique([...variants, ...translatedVariants, translatedQuery].filter(Boolean)),
      backend: translatedQuery && translatedQuery === lexiconFallback?.translatedQuery ? 'lexicon' : 'http',
      reason: translatedQuery ? (translatedQuery === lexiconFallback?.translatedQuery ? 'lexicon-fallback' : '') : 'translation-empty'
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
