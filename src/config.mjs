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
  translationProvider: process.env.SCHOLAXIS_TRANSLATION_PROVIDER || 'generic',
  translationHost: process.env.SCHOLAXIS_TRANSLATION_HOST || '127.0.0.1',
  translationPort: readInt('SCHOLAXIS_TRANSLATION_PORT', 5001),
  translationAutostart: readBool('SCHOLAXIS_TRANSLATION_AUTOSTART', true),
  translationStartupTimeoutMs: readInt('SCHOLAXIS_TRANSLATION_STARTUP_TIMEOUT_MS', 20000),
  host: process.env.HOST || '127.0.0.1',
  portFallbackAttempts: readInt('SCHOLAXIS_PORT_FALLBACK_ATTEMPTS', 10),
  storageBackend: process.env.SCHOLAXIS_STORAGE_BACKEND || 'sqlite',
  vectorBackend: process.env.SCHOLAXIS_VECTOR_BACKEND || 'local',
  graphBackend: process.env.SCHOLAXIS_GRAPH_BACKEND || 'local',
  vectorServiceUrl: process.env.SCHOLAXIS_VECTOR_SERVICE_URL || '',
  graphServiceUrl: process.env.SCHOLAXIS_GRAPH_SERVICE_URL || '',
  schedulerIntervalMs: readInt('SCHOLAXIS_SCHEDULER_INTERVAL_MS', 60000),
  workerPollMs: readInt('SCHOLAXIS_WORKER_POLL_MS', 1500),
  workerLeaseMs: readInt('SCHOLAXIS_WORKER_LEASE_MS', 15000),
  citationExpansionLimit: readInt('SCHOLAXIS_CITATION_EXPANSION_LIMIT', 6),
  recommendationCandidateLimit: readInt('SCHOLAXIS_RECOMMENDATION_CANDIDATE_LIMIT', 24),
  enableLiveSources: readBool('SCHOLAXIS_ENABLE_LIVE_SOURCES', false),
  autoLiveOnEmpty: readBool('SCHOLAXIS_AUTO_LIVE_ON_EMPTY', true),
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
  translationServiceUrl:
    process.env.SCHOLAXIS_TRANSLATION_SERVICE_URL ||
    ((process.env.SCHOLAXIS_TRANSLATION_PROVIDER || 'generic') === 'libretranslate'
      ? `http://${process.env.SCHOLAXIS_TRANSLATION_HOST || '127.0.0.1'}:${readInt('SCHOLAXIS_TRANSLATION_PORT', 5001)}/translate`
      : ''),
  translationApiKey: process.env.SCHOLAXIS_TRANSLATION_API_KEY || '',
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
