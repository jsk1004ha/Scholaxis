import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { appConfig } from './config.mjs';
import { embedText } from './embedding-service.mjs';
import { buildDocumentPassages, buildSparseVector, unique } from './vector-service.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_RUNTIME_CACHE_MS = 5_000;
const postgresRuntimeState = {
  checkedAt: 0,
  ready: false,
  lastError: '',
};

function postgresEnabled() {
  return appConfig.storageBackend === 'postgres';
}

function hasConnectionConfig() {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.PGHOST ||
      process.env.PGSERVICE
  );
}

function buildPsqlArgs(sql) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql];
  if (process.env.DATABASE_URL) return [process.env.DATABASE_URL, ...args];
  return args;
}

async function runPsql(sql) {
  const { stdout } = await execFileAsync(process.env.PSQL_BIN || 'psql', buildPsqlArgs(sql), {
    env: process.env,
  });
  return stdout.trim();
}

function runPsqlSync(sql) {
  return execFileSync(process.env.PSQL_BIN || 'psql', buildPsqlArgs(sql), {
    env: process.env,
    encoding: 'utf8',
  }).trim();
}

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

function sqlBool(value) {
  return value ? 'TRUE' : 'FALSE';
}

function jsonRows(sql) {
  const output = runPsqlSync(sql);
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function firstJsonRow(sql) {
  return jsonRows(sql)[0] || null;
}

function serializeDocumentSnapshot(document = {}) {
  return {
    ...document,
    vector: document.semanticVector || document.vector || [],
    sparseVector: document.sparseVector || {},
    rawRecord: document.rawRecord || document.rawRecords || null,
    updatedAt: document.updatedAt || new Date().toISOString(),
  };
}

function hydrateStoredDocument(base = {}, rawSnapshot = null) {
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  return {
    ...snapshot,
    ...base,
    authors: base.authors || snapshot.authors || [],
    keywords: base.keywords || snapshot.keywords || [],
    methods: snapshot.methods || [],
    highlights: snapshot.highlights || [],
    links: base.links || snapshot.links || {},
    vector: snapshot.vector || [],
    semanticVector: snapshot.semanticVector || snapshot.vector || [],
    sparseVector: base.sparseVector || snapshot.sparseVector || {},
    rawRecord: base.rawRecord || snapshot.rawRecord || snapshot.rawRecords || null,
    updatedAt: base.updatedAt || snapshot.updatedAt,
  };
}

function postgresStorageReady() {
  return postgresEnabled() && hasConnectionConfig();
}

function ensurePostgresSchemaSync() {
  if (!postgresStorageReady()) {
    postgresRuntimeState.ready = false;
    postgresRuntimeState.lastError = postgresEnabled() ? 'postgres-not-configured' : '';
    postgresRuntimeState.checkedAt = Date.now();
    return false;
  }

  if (
    postgresRuntimeState.checkedAt &&
    Date.now() - postgresRuntimeState.checkedAt < POSTGRES_RUNTIME_CACHE_MS
  ) {
    return postgresRuntimeState.ready;
  }

  try {
    runPsqlSync(getPostgresSchemaSql());
    postgresRuntimeState.ready = true;
    postgresRuntimeState.lastError = '';
    return true;
  } catch (error) {
    postgresRuntimeState.ready = false;
    postgresRuntimeState.lastError = error.message;
    return false;
  } finally {
    postgresRuntimeState.checkedAt = Date.now();
  }
}

export function getPostgresSchemaSql() {
  return `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
  canonical_id TEXT PRIMARY KEY,
  source TEXT,
  type TEXT,
  title TEXT,
  english_title TEXT,
  year INTEGER,
  organization TEXT,
  language TEXT,
  region TEXT,
  citations INTEGER,
  open_access BOOLEAN,
  authors_json JSONB,
  keywords_json JSONB,
  methods_json JSONB,
  highlights_json JSONB,
  alternate_sources_json JSONB,
  source_ids_json JSONB,
  abstract TEXT,
  summary TEXT,
  novelty TEXT,
  search_text TEXT,
  links_json JSONB,
  embedding vector(${appConfig.vectorDimensions}),
  embedding_provider TEXT,
  embedding_model TEXT,
  sparse_json JSONB,
  raw_json JSONB,
  updated_at TIMESTAMPTZ
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS english_title TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS citations INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS open_access BOOLEAN;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS methods_json JSONB;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS highlights_json JSONB;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS alternate_sources_json JSONB;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_ids_json JSONB;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS abstract TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS novelty TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_provider TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_model TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_embedding_cosine ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_source_type_year ON documents(source, type, year DESC);
CREATE INDEX IF NOT EXISTS idx_documents_region_year ON documents(region, year DESC);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_search_text_tsv ON documents USING GIN (to_tsvector('simple', COALESCE(search_text, '')));
CREATE TABLE IF NOT EXISTS source_records (
  canonical_id TEXT,
  source_key TEXT,
  source_document_id TEXT,
  source_label TEXT,
  detail_url TEXT,
  original_url TEXT,
  raw_json JSONB,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (canonical_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_source_records_canonical_id ON source_records(canonical_id);
CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id TEXT PRIMARY KEY,
  canonical_id TEXT,
  ordinal INTEGER,
  label TEXT,
  content TEXT,
  embedding vector(${appConfig.vectorDimensions}),
  sparse_json JSONB,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_document_chunks_canonical_id ON document_chunks(canonical_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_cosine ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_tsv ON document_chunks USING GIN (to_tsvector('simple', COALESCE(content, '')));
CREATE TABLE IF NOT EXISTS search_runs (
  id BIGSERIAL PRIMARY KEY,
  query_text TEXT,
  filters_json JSONB,
  total_results INTEGER,
  live_source_count INTEGER,
  canonical_count INTEGER,
  created_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS similarity_runs (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  extraction_method TEXT,
  extracted_characters INTEGER,
  score INTEGER,
  risk_level TEXT,
  top_match_id TEXT,
  created_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS graph_edges (
  source_id TEXT,
  target_id TEXT,
  edge_type TEXT,
  weight DOUBLE PRECISION,
  created_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_type ON graph_edges(source_id, edge_type);
CREATE TABLE IF NOT EXISTS background_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT,
  status TEXT,
  payload_json JSONB,
  priority INTEGER,
  attempts INTEGER,
  last_error TEXT,
  run_after TIMESTAMPTZ,
  leased_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  method TEXT,
  path TEXT,
  status INTEGER,
  duration_ms DOUBLE PRECISION,
  created_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  password_digest TEXT,
  created_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  token_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS library_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  canonical_id TEXT,
  note TEXT,
  highlights_json JSONB,
  share_token TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(user_id, canonical_id)
);
CREATE TABLE IF NOT EXISTS saved_searches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  label TEXT,
  query_text TEXT,
  filters_json JSONB,
  alert_enabled BOOLEAN,
  alert_frequency TEXT,
  last_notified_at TIMESTAMPTZ,
  last_result_count INTEGER,
  created_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT PRIMARY KEY,
  research_interests_json JSONB,
  preferred_sources_json JSONB,
  default_region TEXT,
  alert_opt_in BOOLEAN,
  cross_language_opt_in BOOLEAN,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_type ON graph_edges(target_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_after ON background_jobs(status, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_items_share_token ON library_items(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);`.trim();
}

export async function ensurePostgresSchema() {
  if (!postgresEnabled() || !hasConnectionConfig()) {
    return { enabled: postgresEnabled(), ready: false, reason: 'postgres-not-configured' };
  }
  try {
    await runPsql(getPostgresSchemaSql());
    return { enabled: true, ready: true };
  } catch (error) {
    return { enabled: true, ready: false, error: error.message };
  }
}

export async function syncDocumentsToPostgres(documents = []) {
  if (!postgresEnabled() || !hasConnectionConfig()) {
    return { enabled: postgresEnabled(), synced: 0, reason: 'postgres-not-configured' };
  }
  const schema = await ensurePostgresSchema();
  if (!schema.ready) return { ...schema, synced: 0 };

  const documentStatements = documents.map((document) => {
    const vectorLiteral = `[${(document.vector || []).map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
    return `
INSERT INTO documents (
  canonical_id, source, type, title, english_title, year, organization, language, region, citations, open_access,
  authors_json, keywords_json, methods_json, highlights_json, alternate_sources_json, source_ids_json,
  abstract, summary, novelty, search_text, links_json, embedding, embedding_provider, embedding_model,
  sparse_json, raw_json, updated_at
) VALUES (
  ${sqlString(document.canonicalId || document.id)},
  ${sqlString(document.source)},
  ${sqlString(document.type)},
  ${sqlString(document.title)},
  ${sqlString(document.englishTitle || '')},
  ${document.year ?? 'NULL'},
  ${sqlString(document.organization || '')},
  ${sqlString(document.language || '')},
  ${sqlString(document.region || '')},
  ${Number(document.citations || 0)},
  ${sqlBool(document.openAccess)},
  ${sqlJson(document.authors || [])},
  ${sqlJson(document.keywords || [])},
  ${sqlJson(document.methods || [])},
  ${sqlJson(document.highlights || [])},
  ${sqlJson(document.alternateSources || [])},
  ${sqlJson(document.sourceIds || {})},
  ${sqlString(document.abstract || '')},
  ${sqlString(document.summary || '')},
  ${sqlString(document.novelty || '')},
  ${sqlString(document.searchText || '')},
  ${sqlJson(document.links || {})},
  ${sqlString(vectorLiteral)}::vector,
  ${sqlString(document.embeddingProvider || '')},
  ${sqlString(document.embeddingModel || '')},
  ${sqlJson(document.sparseVector || {})},
  ${sqlJson(serializeDocumentSnapshot(document))},
  ${sqlString(document.updatedAt || new Date().toISOString())}
)
ON CONFLICT (canonical_id) DO UPDATE SET
  source=EXCLUDED.source,
  type=EXCLUDED.type,
  title=EXCLUDED.title,
  english_title=EXCLUDED.english_title,
  year=EXCLUDED.year,
  organization=EXCLUDED.organization,
  language=EXCLUDED.language,
  region=EXCLUDED.region,
  citations=EXCLUDED.citations,
  open_access=EXCLUDED.open_access,
  authors_json=EXCLUDED.authors_json,
  keywords_json=EXCLUDED.keywords_json,
  methods_json=EXCLUDED.methods_json,
  highlights_json=EXCLUDED.highlights_json,
  alternate_sources_json=EXCLUDED.alternate_sources_json,
  source_ids_json=EXCLUDED.source_ids_json,
  abstract=EXCLUDED.abstract,
  summary=EXCLUDED.summary,
  novelty=EXCLUDED.novelty,
  search_text=EXCLUDED.search_text,
  links_json=EXCLUDED.links_json,
  embedding=EXCLUDED.embedding,
  embedding_provider=EXCLUDED.embedding_provider,
  embedding_model=EXCLUDED.embedding_model,
  sparse_json=EXCLUDED.sparse_json,
  raw_json=EXCLUDED.raw_json,
  updated_at=EXCLUDED.updated_at;`.trim();
  });

  const sourceRecordStatements = [];
  const chunkStatements = [];

  for (const document of documents) {
    const canonicalId = document.canonicalId || document.id;
    const updatedAt = document.updatedAt || new Date().toISOString();
    sourceRecordStatements.push(`DELETE FROM source_records WHERE canonical_id = ${sqlString(canonicalId)};`);
    chunkStatements.push(`DELETE FROM document_chunks WHERE canonical_id = ${sqlString(canonicalId)};`);

    const sourceKeys = unique([document.source, ...(document.alternateSources || [])].filter(Boolean));
    for (const sourceKey of sourceKeys) {
      sourceRecordStatements.push(`
INSERT INTO source_records (
  canonical_id, source_key, source_document_id, source_label, detail_url, original_url, raw_json, updated_at
) VALUES (
  ${sqlString(canonicalId)},
  ${sqlString(sourceKey)},
  ${sqlString(document.sourceIds?.[sourceKey] || canonicalId)},
  ${sqlString(document.sourceLabel || sourceKey)},
  ${sqlString(document.links?.detail || '')},
  ${sqlString(document.links?.original || document.links?.detail || '')},
  ${sqlJson(document.rawRecord || serializeDocumentSnapshot(document))},
  ${sqlString(updatedAt)}
)
ON CONFLICT (canonical_id, source_key) DO UPDATE SET
  source_document_id = EXCLUDED.source_document_id,
  source_label = EXCLUDED.source_label,
  detail_url = EXCLUDED.detail_url,
  original_url = EXCLUDED.original_url,
  raw_json = EXCLUDED.raw_json,
  updated_at = EXCLUDED.updated_at;`.trim());
    }

    const passages = buildDocumentPassages(document).slice(0, 8);
    const chunkVectors = await Promise.all(
      passages.map((passage) => embedText(`${document.title || ''}\n${passage.text}`))
    );
    passages.forEach((passage, index) => {
      const vectorLiteral = `[${(chunkVectors[index] || []).map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
      chunkStatements.push(`
INSERT INTO document_chunks (
  chunk_id, canonical_id, ordinal, label, content, embedding, sparse_json, updated_at
) VALUES (
  ${sqlString(`${canonicalId}::${index + 1}`)},
  ${sqlString(canonicalId)},
  ${index + 1},
  ${sqlString(passage.label)},
  ${sqlString(passage.text)},
  ${sqlString(vectorLiteral)}::vector,
  ${sqlJson(buildSparseVector(passage.text))},
  ${sqlString(updatedAt)}
)
ON CONFLICT (chunk_id) DO UPDATE SET
  canonical_id = EXCLUDED.canonical_id,
  ordinal = EXCLUDED.ordinal,
  label = EXCLUDED.label,
  content = EXCLUDED.content,
  embedding = EXCLUDED.embedding,
  sparse_json = EXCLUDED.sparse_json,
  updated_at = EXCLUDED.updated_at;`.trim());
    });
  }

  try {
    const statements = [...documentStatements, ...sourceRecordStatements, ...chunkStatements];
    if (statements.length) await runPsql(statements.join('\n'));
    return { enabled: true, synced: documents.length, sourceRecords: sourceRecordStatements.length, chunks: chunkStatements.length, ready: true };
  } catch (error) {
    return { enabled: true, ready: false, synced: 0, error: error.message };
  }
}

export async function loadDocumentsFromPostgres() {
  if (!postgresEnabled() || !hasConnectionConfig()) return [];
  try {
    const output = await runPsql(`
SELECT row_to_json(t)
FROM (
  SELECT
    canonical_id AS "canonicalId",
    source,
    type,
    title,
    english_title AS "englishTitle",
    year,
    organization,
    language,
    region,
    citations,
    open_access AS "openAccess",
    authors_json AS authors,
    keywords_json AS keywords,
    methods_json AS methods,
    highlights_json AS highlights,
    alternate_sources_json AS "alternateSources",
    source_ids_json AS "sourceIds",
    abstract,
    summary,
    novelty,
    search_text AS "searchText",
    links_json AS links,
    sparse_json AS "sparseVector",
    raw_json AS "rawRecord",
    updated_at AS "updatedAt"
  FROM documents
  ORDER BY canonical_id
) t;`);
    if (!output) return [];
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line);
        return hydrateStoredDocument(row, row.rawRecord);
      });
  } catch {
    return [];
  }
}

export async function getPostgresDiagnostics() {
  if (!postgresEnabled()) {
    return { enabled: false, configured: false, ready: false };
  }
  const configured = hasConnectionConfig();
  if (!configured) {
    return { enabled: true, configured: false, ready: false };
  }

  try {
    const output = await runPsql(`
SELECT row_to_json(t)
FROM (
  SELECT
    (SELECT COUNT(*) FROM documents) AS documents,
    (SELECT COUNT(*) FROM source_records) AS source_records,
    (SELECT COUNT(*) FROM document_chunks) AS document_chunks,
    (SELECT COUNT(*) FROM graph_edges) AS graph_edges,
    (SELECT COUNT(*) FROM background_jobs) AS background_jobs,
    (SELECT COUNT(*) FROM library_items) AS library_items,
    (SELECT COUNT(*) FROM saved_searches) AS saved_searches,
    (SELECT COUNT(*) FROM user_preferences) AS user_preferences
) t;`);
    return {
      enabled: true,
      configured: true,
      ready: true,
      stats: output ? JSON.parse(output) : {},
      lastError: postgresRuntimeState.lastError,
    };
  } catch (error) {
    postgresRuntimeState.ready = false;
    postgresRuntimeState.lastError = error.message;
    return {
      enabled: true,
      configured: true,
      ready: false,
      error: error.message,
    };
  }
}

export function postgresRuntimeReady() {
  return ensurePostgresSchemaSync();
}

export function searchDocumentsByEmbeddingSync({ queryVector = [], limit = 12 } = {}) {
  if (!ensurePostgresSchemaSync() || !Array.isArray(queryVector) || !queryVector.length) return [];
  const vectorLiteral = `[${queryVector.map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    canonical_id AS id,
    GREATEST(0, 1 - (embedding <=> ${sqlString(vectorLiteral)}::vector)) AS score
  FROM documents
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> ${sqlString(vectorLiteral)}::vector ASC
  LIMIT ${Math.max(1, Number(limit || 12))}
) t;`).map((row) => ({
    id: row.id,
    score: Number(row.score || 0)
  }));
}

export function persistDocumentsToPostgresSync(documents = []) {
  if (!ensurePostgresSchemaSync()) return { enabled: postgresEnabled(), synced: 0, reason: 'postgres-not-configured' };
  if (!documents.length) return { enabled: true, synced: 0, ready: true };
  const statements = documents.map((document) => {
    const vectorLiteral = `[${(document.vector || []).map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
    return `
INSERT INTO documents (
  canonical_id, source, type, title, english_title, year, organization, language, region, citations, open_access,
  authors_json, keywords_json, methods_json, highlights_json, alternate_sources_json, source_ids_json,
  abstract, summary, novelty, search_text, links_json, embedding, embedding_provider, embedding_model,
  sparse_json, raw_json, updated_at
) VALUES (
  ${sqlString(document.canonicalId || document.id)},
  ${sqlString(document.source)},
  ${sqlString(document.type)},
  ${sqlString(document.title)},
  ${sqlString(document.englishTitle || '')},
  ${document.year ?? 'NULL'},
  ${sqlString(document.organization || '')},
  ${sqlString(document.language || '')},
  ${sqlString(document.region || '')},
  ${Number(document.citations || 0)},
  ${sqlBool(document.openAccess)},
  ${sqlJson(document.authors || [])},
  ${sqlJson(document.keywords || [])},
  ${sqlJson(document.methods || [])},
  ${sqlJson(document.highlights || [])},
  ${sqlJson(document.alternateSources || [])},
  ${sqlJson(document.sourceIds || {})},
  ${sqlString(document.abstract || '')},
  ${sqlString(document.summary || '')},
  ${sqlString(document.novelty || '')},
  ${sqlString(document.searchText || '')},
  ${sqlJson(document.links || {})},
  ${sqlString(`[${(document.vector || []).map((value) => Number(value || 0).toFixed(6)).join(',')}]`)}::vector,
  ${sqlString(document.embeddingProvider || '')},
  ${sqlString(document.embeddingModel || '')},
  ${sqlJson(document.sparseVector || {})},
  ${sqlJson(serializeDocumentSnapshot(document))},
  ${sqlString(document.updatedAt || new Date().toISOString())}
)
ON CONFLICT (canonical_id) DO UPDATE SET
  source=EXCLUDED.source,
  type=EXCLUDED.type,
  title=EXCLUDED.title,
  english_title=EXCLUDED.english_title,
  year=EXCLUDED.year,
  organization=EXCLUDED.organization,
  language=EXCLUDED.language,
  region=EXCLUDED.region,
  citations=EXCLUDED.citations,
  open_access=EXCLUDED.open_access,
  authors_json=EXCLUDED.authors_json,
  keywords_json=EXCLUDED.keywords_json,
  methods_json=EXCLUDED.methods_json,
  highlights_json=EXCLUDED.highlights_json,
  alternate_sources_json=EXCLUDED.alternate_sources_json,
  source_ids_json=EXCLUDED.source_ids_json,
  abstract=EXCLUDED.abstract,
  summary=EXCLUDED.summary,
  novelty=EXCLUDED.novelty,
  search_text=EXCLUDED.search_text,
  links_json=EXCLUDED.links_json,
  embedding=EXCLUDED.embedding,
  embedding_provider=EXCLUDED.embedding_provider,
  embedding_model=EXCLUDED.embedding_model,
  sparse_json=EXCLUDED.sparse_json,
  raw_json=EXCLUDED.raw_json,
  updated_at=EXCLUDED.updated_at;`.trim();
  });
  runPsqlSync(statements.join('\n'));
  return { enabled: true, synced: documents.length, ready: true };
}

export function persistSearchRunToPostgresSync({ query = '', filters = {}, total = 0, liveSourceCount = 0, canonicalCount = 0 } = {}) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`
CREATE TABLE IF NOT EXISTS search_runs (
  id BIGSERIAL PRIMARY KEY,
  query_text TEXT,
  filters_json JSONB,
  total_results INTEGER,
  live_source_count INTEGER,
  canonical_count INTEGER,
  created_at TIMESTAMPTZ
);
INSERT INTO search_runs (query_text, filters_json, total_results, live_source_count, canonical_count, created_at)
VALUES (${sqlString(query)}, ${sqlJson(filters)}, ${Number(total || 0)}, ${Number(liveSourceCount || 0)}, ${Number(canonicalCount || 0)}, ${sqlString(new Date().toISOString())});
`);
}

export function persistSimilarityRunToPostgresSync({ title = '', extraction = null, report = null } = {}) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`
CREATE TABLE IF NOT EXISTS similarity_runs (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  extraction_method TEXT,
  extracted_characters INTEGER,
  score INTEGER,
  risk_level TEXT,
  top_match_id TEXT,
  created_at TIMESTAMPTZ
);
INSERT INTO similarity_runs (title, extraction_method, extracted_characters, score, risk_level, top_match_id, created_at)
VALUES (
  ${sqlString(title)},
  ${sqlString(extraction?.method || '')},
  ${Number(extraction?.extractedCharacters || 0)},
  ${Number(report?.score || 0)},
  ${sqlString(report?.riskLevel || '')},
  ${sqlString(report?.topMatches?.[0]?.id || null)},
  ${sqlString(new Date().toISOString())}
);
`);
}

export function getPostgresStorageDiagnosticsSync() {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
SELECT row_to_json(t)
FROM (
  SELECT
    (SELECT COUNT(*) FROM documents) AS documents,
    (SELECT COUNT(*) FROM source_records) AS "sourceRecords",
    (SELECT COUNT(*) FROM document_chunks) AS "documentChunks",
    COALESCE((SELECT COUNT(*) FROM search_runs), 0) AS "searchRuns",
    COALESCE((SELECT COUNT(*) FROM similarity_runs), 0) AS "similarityRuns",
    (SELECT COUNT(*) FROM graph_edges) AS "graphEdges",
    COALESCE((SELECT COUNT(*) FROM request_logs), 0) AS "requestLogs",
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM sessions) AS sessions,
    (SELECT COUNT(*) FROM library_items) AS "libraryItems",
    (SELECT COUNT(*) FROM saved_searches) AS "savedSearches",
    (SELECT COUNT(*) FROM user_preferences) AS "userPreferences",
    (SELECT COUNT(*) FROM background_jobs WHERE status IN ('queued', 'leased', 'running')) AS "pendingJobs",
    (SELECT COUNT(*) FROM background_jobs WHERE status = 'completed') AS "completedJobs"
) t;`) || { ready: true };
}

export function persistGraphEdgesToPostgresSync(edges = []) {
  if (!ensurePostgresSchemaSync()) return null;
  if (!edges.length) return;
  const now = new Date().toISOString();
  runPsqlSync(edges.map((edge) =>
    `INSERT INTO graph_edges (source_id, target_id, edge_type, weight, created_at) VALUES (${sqlString(edge.sourceId)}, ${sqlString(edge.targetId)}, ${sqlString(edge.edgeType)}, ${Number(edge.weight || 0)}, ${sqlString(edge.createdAt || now)});`
  ).join('\n'));
}

export function replaceGraphEdgesForSourceInPostgresSync(sourceId, edges = []) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`DELETE FROM graph_edges WHERE source_id = ${sqlString(sourceId)};`);
  if (edges.length) persistGraphEdgesToPostgresSync(edges);
}

export function listGraphEdgesFromPostgresSync({ sourceId = null, targetId = null, edgeType = null, limit = 50 } = {}) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    source_id AS "sourceId",
    target_id AS "targetId",
    edge_type AS "edgeType",
    weight,
    created_at AS "createdAt"
  FROM graph_edges
  WHERE (${sqlString(sourceId)} IS NULL OR source_id = ${sqlString(sourceId)})
    AND (${sqlString(targetId)} IS NULL OR target_id = ${sqlString(targetId)})
    AND (${sqlString(edgeType)} IS NULL OR edge_type = ${sqlString(edgeType)})
  ORDER BY weight DESC, created_at DESC
  LIMIT ${Number(limit || 50)}
) t;`);
}

export function persistRequestLogToPostgresSync({ method = '', path = '', status = 0, durationMs = 0 } = {}) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`
CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  method TEXT,
  path TEXT,
  status INTEGER,
  duration_ms DOUBLE PRECISION,
  created_at TIMESTAMPTZ
);
INSERT INTO request_logs (method, path, status, duration_ms, created_at)
VALUES (${sqlString(method)}, ${sqlString(path)}, ${Number(status || 0)}, ${Number(durationMs || 0)}, ${sqlString(new Date().toISOString())});
`);
}

export function getRecentRequestLogsFromPostgresSync(limit = 20) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT method, path, status, duration_ms AS "durationMs", created_at AS "createdAt"
  FROM request_logs
  ORDER BY created_at DESC
  LIMIT ${Number(limit || 20)}
) t;`);
}

export function getRecentSimilarityRunsFromPostgresSync(limit = 10) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    id,
    title,
    extraction_method AS "extractionMethod",
    extracted_characters AS "extractedCharacters",
    score,
    risk_level AS "riskLevel",
    top_match_id AS "topMatchId",
    created_at AS "createdAt"
  FROM similarity_runs
  ORDER BY created_at DESC
  LIMIT ${Number(limit || 10)}
) t;`);
}

export function listBackgroundJobsFromPostgresSync(limit = 50) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    id,
    job_type AS "jobType",
    status,
    payload_json AS payload,
    priority,
    attempts,
    last_error AS "lastError",
    run_after AS "runAfter",
    leased_until AS "leasedUntil",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    completed_at AS "completedAt"
  FROM background_jobs
  ORDER BY id DESC
  LIMIT ${Number(limit || 50)}
) t;`);
}

export function enqueueBackgroundJobInPostgresSync({ jobType, payload = {}, priority = 0, runAfter = new Date().toISOString() }) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
WITH ins AS (
  INSERT INTO background_jobs (job_type, status, payload_json, priority, attempts, last_error, run_after, leased_until, created_at, updated_at, completed_at)
  VALUES (${sqlString(jobType)}, 'queued', ${sqlJson(payload)}, ${Number(priority || 0)}, 0, '', ${sqlString(runAfter)}, NULL, ${sqlString(new Date().toISOString())}, ${sqlString(new Date().toISOString())}, NULL)
  RETURNING *
)
SELECT row_to_json(t)
FROM (
  SELECT
    id,
    job_type AS "jobType",
    status,
    payload_json AS payload,
    priority,
    attempts,
    last_error AS "lastError",
    run_after AS "runAfter",
    leased_until AS "leasedUntil",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    completed_at AS "completedAt"
  FROM ins
) t;`);
}

export function leaseNextBackgroundJobFromPostgresSync({ now = new Date().toISOString(), leaseMs = 15000 } = {}) {
  if (!ensurePostgresSchemaSync()) return null;
  const leasedUntil = new Date(Date.now() + leaseMs).toISOString();
  return firstJsonRow(`
WITH candidate AS (
  SELECT id
  FROM background_jobs
  WHERE status = 'queued' AND run_after <= ${sqlString(now)}
  ORDER BY priority DESC, id ASC
  LIMIT 1
),
upd AS (
  UPDATE background_jobs
  SET status = 'leased', leased_until = ${sqlString(leasedUntil)}, attempts = attempts + 1, updated_at = ${sqlString(now)}
  WHERE id IN (SELECT id FROM candidate)
  RETURNING *
)
SELECT row_to_json(t)
FROM (
  SELECT
    id,
    job_type AS "jobType",
    status,
    payload_json AS payload,
    priority,
    attempts,
    last_error AS "lastError",
    run_after AS "runAfter",
    leased_until AS "leasedUntil",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    completed_at AS "completedAt"
  FROM upd
) t;`);
}

function updateJobStatusSql(id, fields = {}) {
  const sets = Object.entries(fields)
    .map(([key, value]) => `${key} = ${value}`)
    .join(', ');
  return `
UPDATE background_jobs
SET ${sets}
WHERE id = ${Number(id)};
`;
}

export function completeBackgroundJobInPostgresSync(id) {
  if (!ensurePostgresSchemaSync()) return null;
  const now = new Date().toISOString();
  runPsqlSync(updateJobStatusSql(id, {
    status: sqlString('completed'),
    leased_until: 'NULL',
    last_error: 'NULL',
    updated_at: sqlString(now),
    completed_at: sqlString(now)
  }));
  return firstJsonRow(`SELECT row_to_json(t) FROM (SELECT id, job_type AS "jobType", status, payload_json AS payload, priority, attempts, last_error AS "lastError", run_after AS "runAfter", leased_until AS "leasedUntil", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM background_jobs WHERE id = ${Number(id)}) t;`);
}

export function failBackgroundJobInPostgresSync(id, error = '') {
  if (!ensurePostgresSchemaSync()) return null;
  const now = new Date().toISOString();
  runPsqlSync(updateJobStatusSql(id, {
    status: sqlString('failed'),
    leased_until: 'NULL',
    last_error: sqlString(String(error || '')),
    updated_at: sqlString(now)
  }));
  return firstJsonRow(`SELECT row_to_json(t) FROM (SELECT id, job_type AS "jobType", status, payload_json AS payload, priority, attempts, last_error AS "lastError", run_after AS "runAfter", leased_until AS "leasedUntil", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM background_jobs WHERE id = ${Number(id)}) t;`);
}

export function requeueBackgroundJobInPostgresSync(id, delayMs = 0) {
  if (!ensurePostgresSchemaSync()) return null;
  const now = new Date().toISOString();
  const runAfter = new Date(Date.now() + delayMs).toISOString();
  runPsqlSync(updateJobStatusSql(id, {
    status: sqlString('queued'),
    leased_until: 'NULL',
    updated_at: sqlString(now),
    run_after: sqlString(runAfter)
  }));
  return firstJsonRow(`SELECT row_to_json(t) FROM (SELECT id, job_type AS "jobType", status, payload_json AS payload, priority, attempts, last_error AS "lastError", run_after AS "runAfter", leased_until AS "leasedUntil", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM background_jobs WHERE id = ${Number(id)}) t;`);
}

export function getStoredDocumentsFromPostgresSync() {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    canonical_id AS "canonicalId",
    canonical_id AS id,
    source,
    type,
    title,
    year,
    organization,
    authors_json AS authors,
    keywords_json AS keywords,
    summary,
    links_json AS links,
    sparse_json AS "sparseVector",
    raw_json AS "rawRecord",
    updated_at AS "updatedAt"
  FROM documents
  ORDER BY canonical_id ASC
) t;`).map((row) => hydrateStoredDocument(row, row.rawRecord));
}

export function createUserInPostgresSync({ email, displayName, passwordDigest }) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
WITH ins AS (
  INSERT INTO users (email, display_name, password_digest, created_at)
  VALUES (${sqlString(email)}, ${sqlString(displayName)}, ${sqlString(passwordDigest)}, ${sqlString(new Date().toISOString())})
  RETURNING *
)
SELECT row_to_json(t)
FROM (
  SELECT id, email, display_name AS "displayName", password_digest AS "passwordDigest", created_at AS "createdAt"
  FROM ins
) t;`);
}

export function findUserByEmailInPostgresSync(email) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
SELECT row_to_json(t)
FROM (
  SELECT id, email, display_name AS "displayName", password_digest AS "passwordDigest", created_at AS "createdAt"
  FROM users
  WHERE email = ${sqlString(email)}
  LIMIT 1
) t;`);
}

export function createSessionInPostgresSync({ userId, tokenHash, expiresAt }) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`
INSERT INTO sessions (user_id, token_hash, created_at, expires_at)
VALUES (${Number(userId)}, ${sqlString(tokenHash)}, ${sqlString(new Date().toISOString())}, ${sqlString(expiresAt)});
`);
}

export function findSessionByHashInPostgresSync(tokenHash) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
SELECT row_to_json(t)
FROM (
  SELECT
    s.id,
    s.user_id AS "userId",
    s.token_hash AS "tokenHash",
    s.expires_at AS "expiresAt",
    u.email,
    u.display_name AS "displayName"
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ${sqlString(tokenHash)}
  LIMIT 1
) t;`);
}

export function deleteSessionByHashInPostgresSync(tokenHash) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`DELETE FROM sessions WHERE token_hash = ${sqlString(tokenHash)};`);
}

export function addLibraryItemInPostgresSync({ userId, canonicalId, note = '', highlights = [], shareToken = null, share = false }) {
  if (!ensurePostgresSchemaSync()) return null;
  const nextShareToken = shareToken || (share ? randomUUID() : null);
  const now = new Date().toISOString();
  runPsqlSync(`
INSERT INTO library_items (user_id, canonical_id, note, highlights_json, share_token, created_at, updated_at)
VALUES (${Number(userId)}, ${sqlString(canonicalId)}, ${sqlString(note)}, ${sqlJson(highlights)}, ${sqlString(nextShareToken)}, ${sqlString(now)}, ${sqlString(now)})
ON CONFLICT (user_id, canonical_id) DO UPDATE SET
  note = EXCLUDED.note,
  highlights_json = EXCLUDED.highlights_json,
  share_token = COALESCE(EXCLUDED.share_token, library_items.share_token),
  updated_at = EXCLUDED.updated_at;
`);
}

export function listLibraryItemsFromPostgresSync(userId) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    canonical_id AS "canonicalId",
    note,
    highlights_json AS highlights,
    share_token AS "shareToken",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM library_items
  WHERE user_id = ${Number(userId)}
  ORDER BY created_at DESC
) t;`);
}

export function findLibraryItemByShareTokenInPostgresSync(shareToken) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
SELECT row_to_json(t)
FROM (
  SELECT
    canonical_id AS "canonicalId",
    note,
    highlights_json AS highlights,
    share_token AS "shareToken",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM library_items
  WHERE share_token = ${sqlString(shareToken)}
  LIMIT 1
) t;`);
}

export function removeLibraryItemInPostgresSync(userId, canonicalId) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`DELETE FROM library_items WHERE user_id = ${Number(userId)} AND canonical_id = ${sqlString(canonicalId)};`);
}

export function saveSearchInPostgresSync({ userId, label, queryText, filters = {}, alertEnabled = false, alertFrequency = 'daily', lastNotifiedAt = null, lastResultCount = 0 }) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`
INSERT INTO saved_searches (user_id, label, query_text, filters_json, alert_enabled, alert_frequency, last_notified_at, last_result_count, created_at)
VALUES (${Number(userId)}, ${sqlString(label)}, ${sqlString(queryText)}, ${sqlJson(filters)}, ${sqlBool(alertEnabled)}, ${sqlString(alertFrequency)}, ${sqlString(lastNotifiedAt)}, ${Number(lastResultCount || 0)}, ${sqlString(new Date().toISOString())});
`);
}

export function listSavedSearchesFromPostgresSync(userId) {
  if (!ensurePostgresSchemaSync()) return [];
  return jsonRows(`
SELECT row_to_json(t)
FROM (
  SELECT
    id,
    label,
    query_text AS "queryText",
    filters_json AS filters,
    alert_enabled AS "alertEnabled",
    alert_frequency AS "alertFrequency",
    last_notified_at AS "lastNotifiedAt",
    last_result_count AS "lastResultCount",
    created_at AS "createdAt"
  FROM saved_searches
  WHERE user_id = ${Number(userId)}
  ORDER BY created_at DESC
) t;`);
}

export function removeSavedSearchInPostgresSync(userId, id) {
  if (!ensurePostgresSchemaSync()) return null;
  runPsqlSync(`DELETE FROM saved_searches WHERE user_id = ${Number(userId)} AND id = ${Number(id)};`);
}

export function getUserProfileFromPostgresSync(userId) {
  if (!ensurePostgresSchemaSync()) return null;
  return firstJsonRow(`
SELECT row_to_json(t)
FROM (
  SELECT
    u.id,
    u.email,
    u.display_name AS "displayName",
    u.created_at AS "createdAt",
    p.research_interests_json AS "researchInterests",
    p.preferred_sources_json AS "preferredSources",
    p.default_region AS "defaultRegion",
    p.alert_opt_in AS "alertOptIn",
    p.cross_language_opt_in AS "crossLanguageOptIn",
    p.updated_at AS "updatedAt"
  FROM users u
  LEFT JOIN user_preferences p ON p.user_id = u.id
  WHERE u.id = ${Number(userId)}
  LIMIT 1
) t;`);
}

export function updateUserProfileInPostgresSync({ userId, displayName, researchInterests = [], preferredSources = [], defaultRegion = 'all', alertOptIn = false, crossLanguageOptIn = false }) {
  if (!ensurePostgresSchemaSync()) return null;
  if (displayName) {
    runPsqlSync(`UPDATE users SET display_name = ${sqlString(String(displayName).trim())} WHERE id = ${Number(userId)};`);
  }
  runPsqlSync(`
INSERT INTO user_preferences (user_id, research_interests_json, preferred_sources_json, default_region, alert_opt_in, cross_language_opt_in, updated_at)
VALUES (${Number(userId)}, ${sqlJson(researchInterests)}, ${sqlJson(preferredSources)}, ${sqlString(defaultRegion)}, ${sqlBool(alertOptIn)}, ${sqlBool(crossLanguageOptIn)}, ${sqlString(new Date().toISOString())})
ON CONFLICT (user_id) DO UPDATE SET
  research_interests_json = EXCLUDED.research_interests_json,
  preferred_sources_json = EXCLUDED.preferred_sources_json,
  default_region = EXCLUDED.default_region,
  alert_opt_in = EXCLUDED.alert_opt_in,
  cross_language_opt_in = EXCLUDED.cross_language_opt_in,
  updated_at = EXCLUDED.updated_at;
`);
  return getUserProfileFromPostgresSync(userId);
}
