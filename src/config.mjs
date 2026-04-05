function readBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readInt(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

export const appConfig = {
  enableLiveSources: readBool('SCHOLAXIS_ENABLE_LIVE_SOURCES', false),
  sourceTimeoutMs: readInt('SCHOLAXIS_SOURCE_TIMEOUT_MS', 4500),
  sourceCacheTtlMs: readInt('SCHOLAXIS_SOURCE_CACHE_TTL_MS', 600000),
  dbPath: process.env.SCHOLAXIS_DB_PATH || '.data/scholaxis.db',
  vectorDimensions: readInt('SCHOLAXIS_VECTOR_DIMS', 96),
  maxLiveResultsPerSource: readInt('SCHOLAXIS_MAX_LIVE_RESULTS_PER_SOURCE', 8),
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  dbpiaApiKey: process.env.DBPIA_API_KEY || '',
  kiprisPlusApiKey: process.env.KIPRIS_PLUS_API_KEY || '',
  kiprisPlusSearchUrl: process.env.KIPRIS_PLUS_SEARCH_URL || '',
  kciSearchUrl: process.env.KCI_SEARCH_URL || '',
  scienceOnSearchUrl:
    process.env.SCIENCEON_SEARCH_URL ||
    'https://scienceon.kisti.re.kr/srch/selectPORSrchArticleList.do',
  userAgent:
    process.env.SCHOLAXIS_USER_AGENT ||
    'ScholaxisResearchBot/0.3 (+https://example.local; contact=local-demo)',
  preferredSources: [
    'semantic_scholar',
    'arxiv',
    'riss',
    'kci',
    'scienceon',
    'dbpia',
    'ntis',
    'kipris',
    'science_fair',
    'student_invention_fair'
  ]
};
