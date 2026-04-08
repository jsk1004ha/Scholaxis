import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function readBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readInt(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

const translationProvider = process.env.SCHOLAXIS_TRANSLATION_PROVIDER || 'generic';
const translationHost = process.env.SCHOLAXIS_TRANSLATION_HOST || '127.0.0.1';
const translationPort = readInt('SCHOLAXIS_TRANSLATION_PORT', 5001);
const translationServiceUrl =
  process.env.SCHOLAXIS_TRANSLATION_SERVICE_URL ||
  (translationProvider === 'libretranslate' ? 'http://' + translationHost + ':' + translationPort + '/translate' : '');

const localModelHost = process.env.SCHOLAXIS_LOCAL_MODEL_HOST || '127.0.0.1';
const localModelPort = readInt('SCHOLAXIS_LOCAL_MODEL_PORT', 11435);
const localModelServiceUrl = process.env.SCHOLAXIS_LOCAL_MODEL_SERVICE_URL || ('http://' + localModelHost + ':' + localModelPort);
const defaultLocalModelAutostart = process.env.NODE_ENV !== 'test';
function pythonHasSentenceTransformers(binary) {
  if (!binary) return false;
  try {
    execFileSync(binary, ['-c', 'import sentence_transformers'], {
      stdio: 'ignore',
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
}

const preferredLocalModelPython =
  process.env.SCHOLAXIS_LOCAL_MODEL_PYTHON_BIN ||
  (
    existsSync('.venv-local-models/bin/python') &&
    pythonHasSentenceTransformers('.venv-local-models/bin/python')
      ? '.venv-local-models/bin/python'
      : 'python3'
  );

export const appConfig = {
  translationProvider,
  translationHost,
  translationPort,
  translationAutostart: readBool('SCHOLAXIS_TRANSLATION_AUTOSTART', true),
  translationStartupTimeoutMs: readInt('SCHOLAXIS_TRANSLATION_STARTUP_TIMEOUT_MS', 20000),
  translationServiceUrl,
  translationApiKey: process.env.SCHOLAXIS_TRANSLATION_API_KEY || '',
  host: process.env.HOST || '127.0.0.1',
  portFallbackAttempts: readInt('SCHOLAXIS_PORT_FALLBACK_ATTEMPTS', 10),
  storageBackend: process.env.SCHOLAXIS_STORAGE_BACKEND || 'sqlite',
  vectorBackend: process.env.SCHOLAXIS_VECTOR_BACKEND || 'local',
  graphBackend: process.env.SCHOLAXIS_GRAPH_BACKEND || 'local',
  embeddingProvider: process.env.SCHOLAXIS_EMBEDDING_PROVIDER || 'auto',
  embeddingServiceUrl: process.env.SCHOLAXIS_EMBEDDING_SERVICE_URL || '',
  embeddingModel: process.env.SCHOLAXIS_EMBEDDING_MODEL || 'BAAI/bge-m3',
  embeddingApiKey: process.env.SCHOLAXIS_EMBEDDING_API_KEY || '',
  vectorServiceUrl: process.env.SCHOLAXIS_VECTOR_SERVICE_URL || '',
  graphServiceUrl: process.env.SCHOLAXIS_GRAPH_SERVICE_URL || '',
  ollamaUrl: process.env.SCHOLAXIS_OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaEmbeddingModel: process.env.SCHOLAXIS_OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
  ollamaRerankerModel: process.env.SCHOLAXIS_OLLAMA_RERANKER_MODEL || 'qwen2.5:3b',
  ollamaQueryModel: process.env.SCHOLAXIS_OLLAMA_QUERY_MODEL || 'qwen2.5:3b',
  ollamaKeepAlive: process.env.SCHOLAXIS_OLLAMA_KEEP_ALIVE || '5m',
  modelRequestTimeoutMs: readInt('SCHOLAXIS_MODEL_REQUEST_TIMEOUT_MS', 20000),
  schedulerIntervalMs: readInt('SCHOLAXIS_SCHEDULER_INTERVAL_MS', 60000),
  workerPollMs: readInt('SCHOLAXIS_WORKER_POLL_MS', 1500),
  workerLeaseMs: readInt('SCHOLAXIS_WORKER_LEASE_MS', 15000),
  citationExpansionLimit: readInt('SCHOLAXIS_CITATION_EXPANSION_LIMIT', 8),
  recommendationCandidateLimit: readInt('SCHOLAXIS_RECOMMENDATION_CANDIDATE_LIMIT', 32),
  enableLiveSources: readBool('SCHOLAXIS_ENABLE_LIVE_SOURCES', false),
  autoLiveOnEmpty: readBool('SCHOLAXIS_AUTO_LIVE_ON_EMPTY', true),
  sourceTimeoutMs: readInt('SCHOLAXIS_SOURCE_TIMEOUT_MS', 4500),
  sourceCacheTtlMs: readInt('SCHOLAXIS_SOURCE_CACHE_TTL_MS', 600000),
  dbPath: process.env.SCHOLAXIS_DB_PATH || '.data/scholaxis.db',
  vectorDimensions: readInt('SCHOLAXIS_VECTOR_DIMS', 1024),
  maxLiveResultsPerSource: readInt('SCHOLAXIS_MAX_LIVE_RESULTS_PER_SOURCE', 8),
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  dbpiaApiKey: process.env.DBPIA_API_KEY || '',
  rissSearchUrl: process.env.RISS_SEARCH_URL || 'https://www.riss.kr/search/Search.do',
  kiprisPlusApiKey: process.env.KIPRIS_PLUS_API_KEY || '',
  kiprisPlusSearchUrl: process.env.KIPRIS_PLUS_SEARCH_URL || '',
  kiprisPublicSearchUrl: process.env.KIPRIS_PUBLIC_SEARCH_URL || 'https://plus.kipris.or.kr/portal/search/clasList/List.do',
  kciSearchUrl: process.env.KCI_SEARCH_URL || '',
  ntisSearchUrl: process.env.NTIS_SEARCH_URL || 'https://www.ntis.go.kr/ThSearchProjectList.do',
  scienceOnSearchUrl: process.env.SCIENCEON_SEARCH_URL || 'https://scienceon.kisti.re.kr/srch/selectPORSrchArticleList.do',
  scienceFairUrl: process.env.SCIENCE_FAIR_URL || 'https://www.science.go.kr/mps/1079/bbs/423/moveBbsNttList.do',
  studentInventionFairUrl: process.env.STUDENT_INVENTION_FAIR_URL || 'https://www.science.go.kr/mps/1075/bbs/424/moveBbsNttList.do',
  rneReportUrl: process.env.RNE_REPORT_URL || 'http://www.rne.or.kr/gnuboard5/bbs/board.php?bo_table=rs_report',
  rerankerProvider: process.env.SCHOLAXIS_RERANKER_PROVIDER || 'auto',
  rerankerHost: process.env.SCHOLAXIS_RERANKER_HOST || '127.0.0.1',
  rerankerPort: readInt('SCHOLAXIS_RERANKER_PORT', 8300),
  rerankerAutostart: readBool('SCHOLAXIS_RERANKER_AUTOSTART', true),
  rerankerStartupTimeoutMs: readInt('SCHOLAXIS_RERANKER_STARTUP_TIMEOUT_MS', 10000),
  rerankerServiceUrl: process.env.SCHOLAXIS_RERANKER_SERVICE_URL || '',
  rerankerApiKey: process.env.SCHOLAXIS_RERANKER_API_KEY || '',
  rerankerTopK: readInt('SCHOLAXIS_RERANKER_TOP_K', 12),
  rerankerModel: process.env.SCHOLAXIS_RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3',
  localModelProvider: process.env.SCHOLAXIS_LOCAL_MODEL_PROVIDER || 'sentence-transformers',
  localModelHost,
  localModelPort,
  localModelServiceUrl,
  localModelAutostart: readBool('SCHOLAXIS_LOCAL_MODEL_AUTOSTART', defaultLocalModelAutostart),
  localModelStartupTimeoutMs: readInt('SCHOLAXIS_LOCAL_MODEL_STARTUP_TIMEOUT_MS', 180000),
  localModelPythonBin: preferredLocalModelPython,
  localModelTorchDevice: process.env.SCHOLAXIS_LOCAL_MODEL_DEVICE || 'cpu',
  localModelCacheDir: process.env.SCHOLAXIS_LOCAL_MODEL_CACHE_DIR || '',
  userAgent: process.env.SCHOLAXIS_USER_AGENT || 'ScholaxisResearchBot/0.3 (+https://example.local; contact=local-demo)',
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
    'student_invention_fair',
    'rne_report'
  ]
};
