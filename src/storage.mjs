import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve('.data');
mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(process.env.SCHOLAXIS_DB_PATH || path.join(dataDir, 'scholaxis.db'));
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);

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
    created_at TEXT,
    UNIQUE(user_id, canonical_id)
  );

  CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    label TEXT,
    query_text TEXT,
    filters_json TEXT,
    created_at TEXT
  );
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

export function persistDocuments(documents = []) {
  const timestamp = new Date().toISOString();
  for (const document of documents) {
    upsertDocument.run(
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
      JSON.stringify(document.vector || []),
      JSON.stringify(document.sparseVector || {}),
      JSON.stringify(document.rawRecord || document.rawRecords || null),
      timestamp
    );
  }
}

export function persistSearchRun({ query = '', filters = {}, total = 0, liveSourceCount = 0, canonicalCount = 0 } = {}) {
  insertSearchRun.run(
    query,
    JSON.stringify(filters),
    total,
    liveSourceCount,
    canonicalCount,
    new Date().toISOString()
  );
}

export function persistSimilarityRun({ title = '', extraction = null, report = null } = {}) {
  insertSimilarityRun.run(
    title,
    extraction?.method || '',
    extraction?.extractedCharacters || 0,
    report?.score || 0,
    report?.riskLevel || '',
    report?.topMatches?.[0]?.id || null,
    new Date().toISOString()
  );
}

export function getStorageDiagnostics() {
  const [documentsCount] = db.prepare('SELECT COUNT(*) AS count FROM documents').all();
  const [searchRunsCount] = db.prepare('SELECT COUNT(*) AS count FROM search_runs').all();
  const [similarityRunsCount] = db.prepare('SELECT COUNT(*) AS count FROM similarity_runs').all();
  const [graphEdgesCount] = db.prepare('SELECT COUNT(*) AS count FROM graph_edges').all();
  const [requestLogsCount] = db.prepare('SELECT COUNT(*) AS count FROM request_logs').all();
  const [usersCount] = db.prepare('SELECT COUNT(*) AS count FROM users').all();
  const [sessionsCount] = db.prepare('SELECT COUNT(*) AS count FROM sessions').all();
  const [libraryItemsCount] = db.prepare('SELECT COUNT(*) AS count FROM library_items').all();
  const [savedSearchesCount] = db.prepare('SELECT COUNT(*) AS count FROM saved_searches').all();
  return {
    ready: true,
    dbPath,
    documents: documentsCount?.count || 0,
    searchRuns: searchRunsCount?.count || 0,
    similarityRuns: similarityRunsCount?.count || 0,
    graphEdges: graphEdgesCount?.count || 0,
    requestLogs: requestLogsCount?.count || 0,
    users: usersCount?.count || 0,
    sessions: sessionsCount?.count || 0,
    libraryItems: libraryItemsCount?.count || 0,
    savedSearches: savedSearchesCount?.count || 0
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
  INSERT INTO library_items (user_id, canonical_id, note, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, canonical_id) DO UPDATE SET note=excluded.note
`);
const listLibraryItemsStmt = db.prepare(`
  SELECT canonical_id AS canonicalId, note, created_at AS createdAt
  FROM library_items
  WHERE user_id = ?
  ORDER BY id DESC
`);
const removeLibraryItemStmt = db.prepare(`
  DELETE FROM library_items WHERE user_id = ? AND canonical_id = ?
`);
const saveSearchStmt = db.prepare(`
  INSERT INTO saved_searches (user_id, label, query_text, filters_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const listSavedSearchesStmt = db.prepare(`
  SELECT id, label, query_text AS queryText, filters_json AS filtersJson, created_at AS createdAt
  FROM saved_searches
  WHERE user_id = ?
  ORDER BY id DESC
`);
const removeSavedSearchStmt = db.prepare(`
  DELETE FROM saved_searches WHERE user_id = ? AND id = ?
`);

export function persistGraphEdges(edges = []) {
  const timestamp = new Date().toISOString();
  for (const edge of edges) {
    insertGraphEdge.run(edge.sourceId, edge.targetId, edge.edgeType, edge.weight || 0, timestamp);
  }
}

export function persistRequestLog({ method = '', path = '', status = 0, durationMs = 0 } = {}) {
  insertRequestLog.run(method, path, status, durationMs, new Date().toISOString());
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

export function getRecentRequestLogs(limit = 20) {
  return db.prepare('SELECT method, path, status, duration_ms AS durationMs, created_at AS createdAt FROM request_logs ORDER BY id DESC LIMIT ?').all(limit);
}

export function createUser({ email, displayName, passwordDigest }) {
  createUserStmt.run(email, displayName, passwordDigest, new Date().toISOString());
  return findUserByEmail(email);
}

export function findUserByEmail(email) {
  return findUserByEmailStmt.get(email) || null;
}

export function createSession({ userId, tokenHash, expiresAt }) {
  createSessionStmt.run(userId, tokenHash, new Date().toISOString(), expiresAt);
}

export function findSessionByHash(tokenHash) {
  return findSessionStmt.get(tokenHash) || null;
}

export function deleteSessionByHash(tokenHash) {
  deleteSessionStmt.run(tokenHash);
}

export function addLibraryItem({ userId, canonicalId, note = '' }) {
  addLibraryItemStmt.run(userId, canonicalId, note, new Date().toISOString());
}

export function listLibraryItems(userId) {
  return listLibraryItemsStmt.all(userId);
}

export function removeLibraryItem(userId, canonicalId) {
  removeLibraryItemStmt.run(userId, canonicalId);
}

export function saveSearch({ userId, label, queryText, filters = {} }) {
  saveSearchStmt.run(userId, label, queryText, JSON.stringify(filters), new Date().toISOString());
}

export function listSavedSearches(userId) {
  return listSavedSearchesStmt.all(userId).map((item) => ({
    ...item,
    filters: JSON.parse(item.filtersJson || '{}')
  }));
}

export function removeSavedSearch(userId, id) {
  removeSavedSearchStmt.run(userId, id);
}
