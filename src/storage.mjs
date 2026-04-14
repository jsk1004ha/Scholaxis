import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  addLibraryItemInPostgresSync,
  completeBackgroundJobInPostgresSync,
  createSessionInPostgresSync,
  createUserInPostgresSync,
  deleteSessionByHashInPostgresSync,
  enqueueBackgroundJobInPostgresSync,
  failBackgroundJobInPostgresSync,
  findLibraryItemByShareTokenInPostgresSync,
  findSessionByHashInPostgresSync,
  findUserByEmailInPostgresSync,
  getPostgresStorageDiagnosticsSync,
  getRecentRequestLogsFromPostgresSync,
  getRecentSimilarityRunsFromPostgresSync,
  getStoredDocumentsFromPostgresSync,
  getUserProfileFromPostgresSync,
  leaseNextBackgroundJobFromPostgresSync,
  listBackgroundJobsFromPostgresSync,
  listGraphEdgesFromPostgresSync,
  listLibraryItemsFromPostgresSync,
  listSavedSearchesFromPostgresSync,
  persistDocumentsToPostgresSync,
  persistGraphEdgesToPostgresSync,
  persistRequestLogToPostgresSync,
  persistSearchRunToPostgresSync,
  persistSimilarityRunToPostgresSync,
  postgresRuntimeReady,
  removeLibraryItemInPostgresSync,
  removeSavedSearchInPostgresSync,
  replaceGraphEdgesForSourceInPostgresSync,
  requeueBackgroundJobInPostgresSync,
  saveSearchInPostgresSync,
  updateUserProfileInPostgresSync
} from './postgres-store.mjs';
import { seedCatalog } from './catalog.mjs';

const dataDir = path.resolve('.data');
mkdirSync(dataDir, { recursive: true });

function makeRecoveryPath(prefix = 'scholaxis-recovery') {
  return path.join(dataDir, `${prefix}-${Date.now()}.db`);
}

const shouldBootstrapSqlite = !postgresRuntimeReady();
let dbPath = shouldBootstrapSqlite
  ? path.resolve(process.env.SCHOLAXIS_DB_PATH || path.join(dataDir, 'scholaxis.db'))
  : ':memory:';
const opened = openDatabase(dbPath);
dbPath = opened.path;
let db = opened.database;
let dbRecoveryReason = opened.recoveryReason || '';
if (shouldBootstrapSqlite && dbRecoveryReason) {
  console.warn(`[storage] using recovery database at ${dbPath} (${dbRecoveryReason})`);
}

function usePostgresStorage() {
  return postgresRuntimeReady();
}

function openDatabase(targetPath) {
  const explicitDbPath = Boolean(process.env.SCHOLAXIS_DB_PATH);
  const walPath = `${targetPath}-wal`;
  const maxDbBytesBeforeRecovery = Number(process.env.SCHOLAXIS_DB_MAX_BYTES_BEFORE_RECOVERY || 1024 * 1024 * 1024);
  const maxWalBytesBeforeRecovery = Number(process.env.SCHOLAXIS_DB_WAL_MAX_BYTES_BEFORE_RECOVERY || 256 * 1024 * 1024);

  if (!explicitDbPath) {
    const dbSize = existsSync(targetPath) ? statSync(targetPath).size : 0;
    const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
    if (dbSize > maxDbBytesBeforeRecovery || walSize > maxWalBytesBeforeRecovery) {
      const recoveryPath = makeRecoveryPath('scholaxis-startup-recovery');
      const database = new DatabaseSync(recoveryPath);
      database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
      return {
        database,
        path: recoveryPath,
        recoveryReason: `oversized-default-db:${dbSize}:${walSize}`,
      };
    }
  }

  try {
    const database = new DatabaseSync(targetPath);
    database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
    return { database, path: targetPath };
  } catch (error) {
    if (error?.code === 'ERR_SQLITE_ERROR') {
      if (
        /not a database|database disk image is malformed/i.test(error.message) &&
        existsSync(targetPath)
      ) {
        try {
          const brokenPath = `${targetPath}.broken-${Date.now()}`;
          renameSync(targetPath, brokenPath);
          const database = new DatabaseSync(targetPath);
          database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
          return { database, path: targetPath };
        } catch {
          // fall through to tmp recovery
        }
      }

      const recoveryPath = makeRecoveryPath('scholaxis-recovery');
      const database = new DatabaseSync(recoveryPath);
      database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
      return { database, path: recoveryPath, recoveryReason: `sqlite-open-recovery:${error.message}` };
    }
    throw error;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    canonical_id TEXT PRIMARY KEY,
    source TEXT,
    type TEXT,
    title TEXT,
    year INTEGER,
    organization TEXT,
    authors_json TEXT,
    keywords_json TEXT,
    summary TEXT,
    links_json TEXT,
    vector_json TEXT,
    sparse_json TEXT,
    raw_json TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS search_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_text TEXT,
    filters_json TEXT,
    total_results INTEGER,
    live_source_count INTEGER,
    canonical_count INTEGER,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS similarity_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    extraction_method TEXT,
    extracted_characters INTEGER,
    score INTEGER,
    risk_level TEXT,
    top_match_id TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS graph_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT,
    target_id TEXT,
    edge_type TEXT,
    weight REAL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT,
    status TEXT,
    payload_json TEXT,
    priority INTEGER,
    attempts INTEGER,
    last_error TEXT,
    run_after TEXT,
    leased_until TEXT,
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT,
    path TEXT,
    status INTEGER,
    duration_ms REAL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    display_name TEXT,
    password_digest TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    token_hash TEXT UNIQUE,
    created_at TEXT,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    canonical_id TEXT,
    note TEXT,
    highlights_json TEXT,
    share_token TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(user_id, canonical_id)
  );

  CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    label TEXT,
    query_text TEXT,
    filters_json TEXT,
    alert_enabled INTEGER,
    alert_frequency TEXT,
    last_notified_at TEXT,
    last_result_count INTEGER,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    research_interests_json TEXT,
    preferred_sources_json TEXT,
    default_region TEXT,
    alert_opt_in INTEGER,
    cross_language_opt_in INTEGER,
    updated_at TEXT
  );
`);

function ensureColumn(table, columnDefinition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error;
  }
}

ensureColumn('library_items', 'highlights_json TEXT');
ensureColumn('library_items', 'share_token TEXT');
ensureColumn('library_items', 'updated_at TEXT');
ensureColumn('saved_searches', 'alert_enabled INTEGER DEFAULT 0');
ensureColumn('saved_searches', "alert_frequency TEXT DEFAULT 'daily'");
ensureColumn('saved_searches', 'last_notified_at TEXT');
ensureColumn('saved_searches', 'last_result_count INTEGER DEFAULT 0');
ensureColumn('user_preferences', 'cross_language_opt_in INTEGER DEFAULT 0');

function withSqliteRetry(operation, retries = 6, delayMs = 25) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let attempt = 0;
  while (true) {
    try {
      return operation();
    } catch (error) {
      const locked = /database is locked/i.test(String(error?.message || ''));
      if (!locked || attempt >= retries) throw error;
      attempt += 1;
      Atomics.wait(sleeper, 0, 0, delayMs * attempt);
    }
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_graph_edges_source_type ON graph_edges(source_id, edge_type);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_target_type ON graph_edges(target_id, edge_type);
  CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_after ON background_jobs(status, run_after);
`);

const upsertDocument = db.prepare(`
  INSERT INTO documents (
    canonical_id, source, type, title, year, organization,
    authors_json, keywords_json, summary, links_json,
    vector_json, sparse_json, raw_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(canonical_id) DO UPDATE SET
    source=excluded.source,
    type=excluded.type,
    title=excluded.title,
    year=excluded.year,
    organization=excluded.organization,
    authors_json=excluded.authors_json,
    keywords_json=excluded.keywords_json,
    summary=excluded.summary,
    links_json=excluded.links_json,
    vector_json=excluded.vector_json,
    sparse_json=excluded.sparse_json,
    raw_json=excluded.raw_json,
    updated_at=excluded.updated_at
`);

const insertSearchRun = db.prepare(`
  INSERT INTO search_runs (
    query_text, filters_json, total_results, live_source_count, canonical_count, created_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSimilarityRun = db.prepare(`
  INSERT INTO similarity_runs (
    title, extraction_method, extracted_characters, score, risk_level, top_match_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function serializeDocumentSnapshot(document = {}) {
  return JSON.stringify({
    ...document,
    vector: document.semanticVector || document.vector || [],
    sparseVector: document.sparseVector || {},
    rawRecord: document.rawRecord || document.rawRecords || null,
    updatedAt: document.updatedAt || new Date().toISOString(),
  });
}

function hydrateStoredDocument(base = {}, rawJson = 'null') {
  const snapshot = JSON.parse(rawJson || 'null') || {};
  return {
    ...snapshot,
    ...base,
    authors: base.authors || snapshot.authors || [],
    keywords: base.keywords || snapshot.keywords || [],
    methods: snapshot.methods || [],
    highlights: snapshot.highlights || [],
    links: base.links || snapshot.links || {},
    vector: base.vector?.length ? base.vector : snapshot.vector || [],
    semanticVector: snapshot.semanticVector || base.vector || snapshot.vector || [],
    sparseVector: Object.keys(base.sparseVector || {}).length ? base.sparseVector : snapshot.sparseVector || {},
    rawRecord: base.rawRecord || snapshot.rawRecord || snapshot.rawRecords || null,
    updatedAt: base.updatedAt || snapshot.updatedAt,
  };
}

export function persistDocuments(documents = []) {
  if (usePostgresStorage()) {
    persistDocumentsToPostgresSync(documents);
    return;
  }
  const timestamp = new Date().toISOString();
  for (const document of documents) {
    withSqliteRetry(() => upsertDocument.run(
      document.canonicalId || document.id,
      document.source,
      document.type,
      document.title,
      document.year || null,
      document.organization || '',
      JSON.stringify(document.authors || []),
      JSON.stringify(document.keywords || []),
      document.summary || '',
      JSON.stringify(document.links || {}),
      JSON.stringify(document.semanticVector || document.vector || []),
      JSON.stringify(document.sparseVector || {}),
      serializeDocumentSnapshot(document),
      timestamp
    ));
  }
}

export function persistSearchRun({ query = '', filters = {}, total = 0, liveSourceCount = 0, canonicalCount = 0 } = {}) {
  if (usePostgresStorage()) {
    persistSearchRunToPostgresSync({ query, filters, total, liveSourceCount, canonicalCount });
    return;
  }
  withSqliteRetry(() => insertSearchRun.run(
    query,
    JSON.stringify(filters),
    total,
    liveSourceCount,
    canonicalCount,
    new Date().toISOString()
  ));
}

export function persistSimilarityRun({ title = '', extraction = null, report = null } = {}) {
  if (usePostgresStorage()) {
    persistSimilarityRunToPostgresSync({ title, extraction, report });
    return;
  }
  withSqliteRetry(() => insertSimilarityRun.run(
    title,
    extraction?.method || '',
    extraction?.extractedCharacters || 0,
    report?.score || 0,
    report?.riskLevel || '',
    report?.topMatches?.[0]?.id || null,
    new Date().toISOString()
  ));
}

export function getStorageDiagnostics() {
  if (usePostgresStorage()) {
    return {
      ready: true,
      dbPath: process.env.DATABASE_URL || process.env.PGHOST || 'postgres',
      ...(getPostgresStorageDiagnosticsSync() || {})
    };
  }
  const [documentsCount] = db.prepare('SELECT COUNT(*) AS count FROM documents').all();
  const [searchRunsCount] = db.prepare('SELECT COUNT(*) AS count FROM search_runs').all();
  const [similarityRunsCount] = db.prepare('SELECT COUNT(*) AS count FROM similarity_runs').all();
  const [graphEdgesCount] = db.prepare('SELECT COUNT(*) AS count FROM graph_edges').all();
  const [requestLogsCount] = db.prepare('SELECT COUNT(*) AS count FROM request_logs').all();
  const [usersCount] = db.prepare('SELECT COUNT(*) AS count FROM users').all();
  const [sessionsCount] = db.prepare('SELECT COUNT(*) AS count FROM sessions').all();
  const [libraryItemsCount] = db.prepare('SELECT COUNT(*) AS count FROM library_items').all();
  const [savedSearchesCount] = db.prepare('SELECT COUNT(*) AS count FROM saved_searches').all();
  const [userPreferencesCount] = db.prepare('SELECT COUNT(*) AS count FROM user_preferences').all();
  const [pendingJobsCount] = db.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE status IN ('queued', 'leased', 'running')").all();
  const [completedJobsCount] = db.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE status = 'completed'").all();
  return {
    ready: true,
    dbPath,
    recoveryReason: dbRecoveryReason,
    documents: documentsCount?.count || 0,
    searchRuns: searchRunsCount?.count || 0,
    similarityRuns: similarityRunsCount?.count || 0,
    graphEdges: graphEdgesCount?.count || 0,
    requestLogs: requestLogsCount?.count || 0,
    users: usersCount?.count || 0,
    sessions: sessionsCount?.count || 0,
    libraryItems: libraryItemsCount?.count || 0,
    savedSearches: savedSearchesCount?.count || 0,
    userPreferences: userPreferencesCount?.count || 0,
    pendingJobs: pendingJobsCount?.count || 0,
    completedJobs: completedJobsCount?.count || 0
  };
}

const insertGraphEdge = db.prepare(`
  INSERT INTO graph_edges (source_id, target_id, edge_type, weight, created_at) VALUES (?, ?, ?, ?, ?)
`);

const insertRequestLog = db.prepare(`
  INSERT INTO request_logs (method, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)
`);
const createUserStmt = db.prepare(`
  INSERT INTO users (email, display_name, password_digest, created_at) VALUES (?, ?, ?, ?)
`);
const findUserByEmailStmt = db.prepare(`
  SELECT id, email, display_name AS displayName, password_digest AS passwordDigest, created_at AS createdAt
  FROM users
  WHERE email = ?
`);
const createSessionStmt = db.prepare(`
  INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)
`);
const findSessionStmt = db.prepare(`
  SELECT
    s.id,
    s.user_id AS userId,
    s.token_hash AS tokenHash,
    s.expires_at AS expiresAt,
    u.email,
    u.display_name AS displayName
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
const addLibraryItemStmt = db.prepare(`
  INSERT INTO library_items (user_id, canonical_id, note, highlights_json, share_token, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, canonical_id) DO UPDATE SET
    note=excluded.note,
    highlights_json=excluded.highlights_json,
    share_token=COALESCE(excluded.share_token, library_items.share_token),
    updated_at=excluded.updated_at
`);
const listLibraryItemsStmt = db.prepare(`
  SELECT
    li.canonical_id AS canonicalId,
    li.note,
    li.highlights_json AS highlightsJson,
    li.share_token AS shareToken,
    li.created_at AS createdAt,
    li.updated_at AS updatedAt,
    d.title,
    d.source,
    d.type AS sourceType,
    d.year,
    d.organization,
    d.authors_json AS authorsJson,
    d.summary,
    d.links_json AS linksJson
  FROM library_items li
  LEFT JOIN documents d
    ON d.canonical_id = li.canonical_id
    OR d.canonical_id = CASE
      WHEN instr(li.canonical_id, ':') > 0 THEN substr(li.canonical_id, instr(li.canonical_id, ':') + 1)
      ELSE li.canonical_id
    END
  WHERE li.user_id = ?
  ORDER BY li.id DESC
`);
const getLibraryItemByShareTokenStmt = db.prepare(`
  SELECT
    li.user_id AS userId,
    li.canonical_id AS canonicalId,
    li.note,
    li.highlights_json AS highlightsJson,
    li.share_token AS shareToken,
    li.created_at AS createdAt,
    li.updated_at AS updatedAt,
    d.title,
    d.source,
    d.type AS sourceType,
    d.year,
    d.organization,
    d.authors_json AS authorsJson,
    d.summary,
    d.links_json AS linksJson
  FROM library_items li
  LEFT JOIN documents d
    ON d.canonical_id = li.canonical_id
    OR d.canonical_id = CASE
      WHEN instr(li.canonical_id, ':') > 0 THEN substr(li.canonical_id, instr(li.canonical_id, ':') + 1)
      ELSE li.canonical_id
    END
  WHERE li.share_token = ?
`);
const removeLibraryItemStmt = db.prepare(`
  DELETE FROM library_items WHERE user_id = ? AND canonical_id = ?
`);
const saveSearchStmt = db.prepare(`
  INSERT INTO saved_searches (
    user_id, label, query_text, filters_json,
    alert_enabled, alert_frequency, last_notified_at, last_result_count, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listSavedSearchesStmt = db.prepare(`
  SELECT
    id,
    label,
    query_text AS queryText,
    filters_json AS filtersJson,
    alert_enabled AS alertEnabled,
    alert_frequency AS alertFrequency,
    last_notified_at AS lastNotifiedAt,
    last_result_count AS lastResultCount,
    created_at AS createdAt
  FROM saved_searches
  WHERE user_id = ?
  ORDER BY id DESC
`);
const removeSavedSearchStmt = db.prepare(`
  DELETE FROM saved_searches WHERE user_id = ? AND id = ?
`);
const updateDisplayNameStmt = db.prepare(`
  UPDATE users
  SET display_name = ?
  WHERE id = ?
`);
const upsertUserPreferencesStmt = db.prepare(`
  INSERT INTO user_preferences (
    user_id,
    research_interests_json,
    preferred_sources_json,
    default_region,
    alert_opt_in,
    cross_language_opt_in,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    research_interests_json=excluded.research_interests_json,
    preferred_sources_json=excluded.preferred_sources_json,
    default_region=excluded.default_region,
    alert_opt_in=excluded.alert_opt_in,
    cross_language_opt_in=excluded.cross_language_opt_in,
    updated_at=excluded.updated_at
`);
const getUserProfileStmt = db.prepare(`
  SELECT
    u.id,
    u.email,
    u.display_name AS displayName,
    u.created_at AS createdAt,
    p.research_interests_json AS researchInterestsJson,
    p.preferred_sources_json AS preferredSourcesJson,
    p.default_region AS defaultRegion,
    p.alert_opt_in AS alertOptIn,
    p.cross_language_opt_in AS crossLanguageOptIn,
    p.updated_at AS updatedAt
  FROM users u
  LEFT JOIN user_preferences p ON p.user_id = u.id
  WHERE u.id = ?
`);
const deleteGraphEdgesBySourceStmt = db.prepare(`
  DELETE FROM graph_edges WHERE source_id = ?
`);
const listGraphEdgesStmt = db.prepare(`
  SELECT source_id AS sourceId, target_id AS targetId, edge_type AS edgeType, weight, created_at AS createdAt
  FROM graph_edges
  WHERE
    (? IS NULL OR source_id = ?)
    AND (? IS NULL OR target_id = ?)
    AND (? IS NULL OR edge_type = ?)
  ORDER BY weight DESC, id DESC
  LIMIT ?
`);
const insertBackgroundJobStmt = db.prepare(`
  INSERT INTO background_jobs (
    job_type, status, payload_json, priority, attempts, last_error, run_after, leased_until, created_at, updated_at, completed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listBackgroundJobsStmt = db.prepare(`
  SELECT
    id,
    job_type AS jobType,
    status,
    payload_json AS payloadJson,
    priority,
    attempts,
    last_error AS lastError,
    run_after AS runAfter,
    leased_until AS leasedUntil,
    created_at AS createdAt,
    updated_at AS updatedAt,
    completed_at AS completedAt
  FROM background_jobs
  ORDER BY id DESC
  LIMIT ?
`);
const leaseCandidateJobStmt = db.prepare(`
  SELECT id
  FROM background_jobs
  WHERE status = 'queued' AND datetime(run_after) <= datetime(?)
  ORDER BY priority DESC, id ASC
  LIMIT 1
`);
const leaseJobStmt = db.prepare(`
  UPDATE background_jobs
  SET status = 'leased', leased_until = ?, attempts = attempts + 1, updated_at = ?
  WHERE id = ?
`);
const getBackgroundJobByIdStmt = db.prepare(`
  SELECT
    id,
    job_type AS jobType,
    status,
    payload_json AS payloadJson,
    priority,
    attempts,
    last_error AS lastError,
    run_after AS runAfter,
    leased_until AS leasedUntil,
    created_at AS createdAt,
    updated_at AS updatedAt,
    completed_at AS completedAt
  FROM background_jobs
  WHERE id = ?
`);
const completeJobStmt = db.prepare(`
  UPDATE background_jobs
  SET status = 'completed', leased_until = NULL, last_error = NULL, updated_at = ?, completed_at = ?
  WHERE id = ?
`);
const failJobStmt = db.prepare(`
  UPDATE background_jobs
  SET status = 'failed', leased_until = NULL, last_error = ?, updated_at = ?
  WHERE id = ?
`);
const releaseJobStmt = db.prepare(`
  UPDATE background_jobs
  SET status = 'queued', leased_until = NULL, updated_at = ?, run_after = ?
  WHERE id = ?
`);
const getAllDocumentsStmt = db.prepare(`
  SELECT
    canonical_id AS canonicalId,
    source,
    type,
    title,
    year,
    organization,
    authors_json AS authorsJson,
    keywords_json AS keywordsJson,
    summary,
    links_json AS linksJson,
    vector_json AS vectorJson,
    sparse_json AS sparseJson,
    raw_json AS rawJson,
    updated_at AS updatedAt
  FROM documents
  ORDER BY canonical_id ASC
`);

const getLightweightDocumentsStmt = db.prepare(`
  SELECT
    canonical_id AS canonicalId,
    source,
    type,
    title,
    year,
    organization,
    authors_json AS authorsJson,
    keywords_json AS keywordsJson,
    summary,
    links_json AS linksJson,
    raw_json AS rawJson,
    updated_at AS updatedAt
  FROM documents
  ORDER BY canonical_id ASC
`);

export function persistGraphEdges(edges = []) {
  if (usePostgresStorage()) {
    persistGraphEdgesToPostgresSync(edges);
    return;
  }
  const timestamp = new Date().toISOString();
  for (const edge of edges) {
    withSqliteRetry(() => insertGraphEdge.run(edge.sourceId, edge.targetId, edge.edgeType, edge.weight || 0, timestamp));
  }
}

export function replaceGraphEdgesForSource(sourceId, edges = []) {
  if (usePostgresStorage()) {
    replaceGraphEdgesForSourceInPostgresSync(sourceId, edges);
    return;
  }
  deleteGraphEdgesBySourceStmt.run(sourceId);
  persistGraphEdges(edges);
}

export function listGraphEdges({ sourceId = null, targetId = null, edgeType = null, limit = 50 } = {}) {
  if (usePostgresStorage()) {
    return listGraphEdgesFromPostgresSync({ sourceId, targetId, edgeType, limit });
  }
  return listGraphEdgesStmt.all(
    sourceId,
    sourceId,
    targetId,
    targetId,
    edgeType,
    edgeType,
    limit
  );
}

export function getAllGraphEdges(limit = 5000) {
  return listGraphEdges({ limit });
}

export function persistRequestLog({ method = '', path = '', status = 0, durationMs = 0 } = {}) {
  if (usePostgresStorage()) {
    persistRequestLogToPostgresSync({ method, path, status, durationMs });
    return;
  }
  try {
    withSqliteRetry(() => insertRequestLog.run(method, path, status, durationMs, new Date().toISOString()));
  } catch {
    // request logging must not fail the request path
  }
}

export function getRecommendationsFromStorage(canonicalId, limit = 5) {
  const rows = db.prepare(`
    SELECT target_id AS targetId, MAX(weight) AS weight
    FROM graph_edges
    WHERE source_id = ? AND edge_type = 'similar'
    GROUP BY target_id
    ORDER BY weight DESC
    LIMIT ?
  `).all(canonicalId, limit);
  return rows;
}

function normalizeBackgroundJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobType: row.jobType,
    status: row.status,
    payload: JSON.parse(row.payloadJson || '{}'),
    priority: row.priority || 0,
    attempts: row.attempts || 0,
    lastError: row.lastError || '',
    runAfter: row.runAfter,
    leasedUntil: row.leasedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt
  };
}

export function getRecentRequestLogs(limit = 20) {
  if (usePostgresStorage()) return getRecentRequestLogsFromPostgresSync(limit);
  return db.prepare('SELECT method, path, status, duration_ms AS durationMs, created_at AS createdAt FROM request_logs ORDER BY id DESC LIMIT ?').all(limit);
}

export function getRecentSimilarityRuns(limit = 10) {
  if (usePostgresStorage()) return getRecentSimilarityRunsFromPostgresSync(limit);
  return db
    .prepare(`
      SELECT
        id,
        title,
        extraction_method AS extractionMethod,
        extracted_characters AS extractedCharacters,
        score,
        risk_level AS riskLevel,
        top_match_id AS topMatchId,
        created_at AS createdAt
      FROM similarity_runs
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(limit);
}

export function listBackgroundJobs(limit = 50) {
  if (usePostgresStorage()) return listBackgroundJobsFromPostgresSync(limit);
  return listBackgroundJobsStmt.all(limit).map(normalizeBackgroundJob);
}

export function enqueueBackgroundJob({
  jobType,
  payload = {},
  priority = 0,
  runAfter = new Date().toISOString()
}) {
  if (usePostgresStorage()) {
    return enqueueBackgroundJobInPostgresSync({ jobType, payload, priority, runAfter });
  }
  const now = new Date().toISOString();
  insertBackgroundJobStmt.run(
    jobType,
    'queued',
    JSON.stringify(payload),
    priority,
    0,
    '',
    runAfter,
    null,
    now,
    now,
    null
  );
  return normalizeBackgroundJob(getBackgroundJobByIdStmt.get(db.prepare('SELECT last_insert_rowid() AS id').get().id));
}

export function leaseNextBackgroundJob({
  now = new Date().toISOString(),
  leaseMs = 15000
} = {}) {
  if (usePostgresStorage()) {
    return leaseNextBackgroundJobFromPostgresSync({ now, leaseMs });
  }
  const candidate = leaseCandidateJobStmt.get(now);
  if (!candidate?.id) return null;
  const leasedUntil = new Date(Date.now() + leaseMs).toISOString();
  leaseJobStmt.run(leasedUntil, now, candidate.id);
  return normalizeBackgroundJob(getBackgroundJobByIdStmt.get(candidate.id));
}

export function completeBackgroundJob(id) {
  if (usePostgresStorage()) return completeBackgroundJobInPostgresSync(id);
  const now = new Date().toISOString();
  completeJobStmt.run(now, now, id);
  return normalizeBackgroundJob(getBackgroundJobByIdStmt.get(id));
}

export function failBackgroundJob(id, error = '') {
  if (usePostgresStorage()) return failBackgroundJobInPostgresSync(id, error);
  const now = new Date().toISOString();
  failJobStmt.run(String(error || ''), now, id);
  return normalizeBackgroundJob(getBackgroundJobByIdStmt.get(id));
}

export function requeueBackgroundJob(id, delayMs = 0) {
  if (usePostgresStorage()) return requeueBackgroundJobInPostgresSync(id, delayMs);
  const now = new Date().toISOString();
  const runAfter = new Date(Date.now() + delayMs).toISOString();
  releaseJobStmt.run(now, runAfter, id);
  return normalizeBackgroundJob(getBackgroundJobByIdStmt.get(id));
}

export function getStoredDocuments() {
  if (usePostgresStorage()) return getStoredDocumentsFromPostgresSync();
  return getAllDocumentsStmt.all().map((row) => hydrateStoredDocument({
    canonicalId: row.canonicalId,
    id: row.canonicalId,
    source: row.source,
    type: row.type,
    title: row.title,
    year: row.year,
    organization: row.organization,
    authors: JSON.parse(row.authorsJson || '[]'),
    keywords: JSON.parse(row.keywordsJson || '[]'),
    summary: row.summary || '',
    links: JSON.parse(row.linksJson || '{}'),
    vector: JSON.parse(row.vectorJson || '[]'),
    sparseVector: JSON.parse(row.sparseJson || '{}'),
    rawRecord: JSON.parse(row.rawJson || 'null'),
    updatedAt: row.updatedAt
  }, row.rawJson));
}

export function getStoredDocumentsLite() {
  if (usePostgresStorage()) return getStoredDocumentsFromPostgresSync();
  return getLightweightDocumentsStmt.all().map((row) => hydrateStoredDocument({
    canonicalId: row.canonicalId,
    id: row.canonicalId,
    source: row.source,
    type: row.type,
    title: row.title,
    year: row.year,
    organization: row.organization,
    authors: JSON.parse(row.authorsJson || '[]'),
    keywords: JSON.parse(row.keywordsJson || '[]'),
    summary: row.summary || '',
    links: JSON.parse(row.linksJson || '{}'),
    updatedAt: row.updatedAt,
    alternateSources: row.source ? [row.source] : [],
  }, row.rawJson));
}

export function createUser({ email, displayName, passwordDigest }) {
  if (usePostgresStorage()) return createUserInPostgresSync({ email, displayName, passwordDigest });
  createUserStmt.run(email, displayName, passwordDigest, new Date().toISOString());
  return findUserByEmail(email);
}

export function findUserByEmail(email) {
  if (usePostgresStorage()) return findUserByEmailInPostgresSync(email);
  return findUserByEmailStmt.get(email) || null;
}

export function createSession({ userId, tokenHash, expiresAt }) {
  if (usePostgresStorage()) {
    createSessionInPostgresSync({ userId, tokenHash, expiresAt });
    return;
  }
  createSessionStmt.run(userId, tokenHash, new Date().toISOString(), expiresAt);
}

export function findSessionByHash(tokenHash) {
  if (usePostgresStorage()) return findSessionByHashInPostgresSync(tokenHash);
  return findSessionStmt.get(tokenHash) || null;
}

export function deleteSessionByHash(tokenHash) {
  if (usePostgresStorage()) {
    deleteSessionByHashInPostgresSync(tokenHash);
    return;
  }
  deleteSessionStmt.run(tokenHash);
}

function normalizeLibraryItem(row) {
  if (!row) return null;
  const canonicalId = row.canonicalId || '';
  const normalizedCanonicalId =
    typeof canonicalId === 'string' && canonicalId.includes(':')
      ? canonicalId.split(':').slice(1).join(':')
      : canonicalId;
  const seedMatch = seedCatalog.find((item) => item.canonicalId === canonicalId || item.canonicalId === normalizedCanonicalId) || null;
  const highlights =
    Array.isArray(row.highlights)
      ? row.highlights
      : JSON.parse(row.highlightsJson || '[]');
  const authors =
    Array.isArray(row.authors)
      ? row.authors
      : JSON.parse(row.authorsJson || '[]');
  const links = row.linksJson ? JSON.parse(row.linksJson || '{}') : {};
  const sourceType = row.sourceType || seedMatch?.type || '';
  return {
    canonicalId,
    note: row.note || '',
    highlights,
    shareToken: row.shareToken || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    title: row.title || seedMatch?.title || '',
    source: row.source || seedMatch?.source || '',
    sourceType,
    year: row.year || seedMatch?.year || '',
    organization: row.organization || seedMatch?.organization || '',
    authors: authors.length ? authors : (seedMatch?.authors || []),
    summary: row.summary || seedMatch?.summary || '',
    detailUrl: row.detailUrl || links.detail || seedMatch?.links?.detail || '',
    originalUrl: row.originalUrl || links.original || links.detail || seedMatch?.links?.original || seedMatch?.links?.detail || ''
  };
}

export function addLibraryItem({
  userId,
  canonicalId,
  note = '',
  highlights = [],
  shareToken = null,
  share = false
}) {
  if (usePostgresStorage()) {
    addLibraryItemInPostgresSync({ userId, canonicalId, note, highlights, shareToken, share });
    return;
  }
  const nextShareToken = shareToken || (share ? randomUUID() : null);
  const timestamp = new Date().toISOString();
  addLibraryItemStmt.run(
    userId,
    canonicalId,
    note,
    JSON.stringify(Array.isArray(highlights) ? highlights : []),
    nextShareToken,
    timestamp,
    timestamp
  );
}

export function listLibraryItems(userId) {
  if (usePostgresStorage()) return listLibraryItemsFromPostgresSync(userId).map(normalizeLibraryItem);
  return listLibraryItemsStmt.all(userId).map(normalizeLibraryItem);
}

export function findLibraryItemByShareToken(shareToken) {
  if (usePostgresStorage()) return normalizeLibraryItem(findLibraryItemByShareTokenInPostgresSync(shareToken));
  return normalizeLibraryItem(getLibraryItemByShareTokenStmt.get(shareToken));
}

export function removeLibraryItem(userId, canonicalId) {
  if (usePostgresStorage()) {
    removeLibraryItemInPostgresSync(userId, canonicalId);
    return;
  }
  removeLibraryItemStmt.run(userId, canonicalId);
}

export function saveSearch({
  userId,
  label,
  queryText,
  filters = {},
  alertEnabled = false,
  alertFrequency = 'daily',
  lastNotifiedAt = null,
  lastResultCount = 0
}) {
  if (usePostgresStorage()) {
    saveSearchInPostgresSync({ userId, label, queryText, filters, alertEnabled, alertFrequency, lastNotifiedAt, lastResultCount });
    return;
  }
  saveSearchStmt.run(
    userId,
    label,
    queryText,
    JSON.stringify(filters),
    alertEnabled ? 1 : 0,
    alertFrequency || 'daily',
    lastNotifiedAt,
    Number(lastResultCount || 0),
    new Date().toISOString()
  );
}

export function listSavedSearches(userId) {
  if (usePostgresStorage()) return listSavedSearchesFromPostgresSync(userId);
  return listSavedSearchesStmt.all(userId).map((item) => ({
    ...item,
    filters: JSON.parse(item.filtersJson || '{}'),
    alertEnabled: Boolean(item.alertEnabled),
    alertFrequency: item.alertFrequency || 'daily',
    lastNotifiedAt: item.lastNotifiedAt || null,
    lastResultCount: Number(item.lastResultCount || 0)
  }));
}

export function removeSavedSearch(userId, id) {
  if (usePostgresStorage()) {
    removeSavedSearchInPostgresSync(userId, id);
    return;
  }
  removeSavedSearchStmt.run(userId, id);
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    researchInterests: JSON.parse(row.researchInterestsJson || '[]'),
    preferredSources: JSON.parse(row.preferredSourcesJson || '[]'),
    defaultRegion: row.defaultRegion || 'all',
    alertOptIn: Boolean(row.alertOptIn),
    crossLanguageOptIn: Boolean(row.crossLanguageOptIn),
    updatedAt: row.updatedAt || null
  };
}

export function getUserProfile(userId) {
  if (usePostgresStorage()) return getUserProfileFromPostgresSync(userId);
  return normalizeProfileRow(getUserProfileStmt.get(userId));
}

export function updateUserProfile({
  userId,
  displayName,
  researchInterests = [],
  preferredSources = [],
  defaultRegion = 'all',
  alertOptIn = false,
  crossLanguageOptIn = false
}) {
  if (usePostgresStorage()) {
    return updateUserProfileInPostgresSync({ userId, displayName, researchInterests, preferredSources, defaultRegion, alertOptIn, crossLanguageOptIn });
  }
  if (displayName) {
    updateDisplayNameStmt.run(String(displayName).trim(), userId);
  }

  upsertUserPreferencesStmt.run(
    userId,
    JSON.stringify(Array.isArray(researchInterests) ? researchInterests : []),
    JSON.stringify(Array.isArray(preferredSources) ? preferredSources : []),
    defaultRegion || 'all',
    alertOptIn ? 1 : 0,
    crossLanguageOptIn ? 1 : 0,
    new Date().toISOString()
  );

  return getUserProfile(userId);
}
