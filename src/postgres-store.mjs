import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from './config.mjs';

const execFileAsync = promisify(execFile);

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

async function runPsql(sql) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql];
  const { stdout } = await execFileAsync(process.env.PSQL_BIN || 'psql', args, {
    env: process.env,
  });
  return stdout.trim();
}

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

export function getPostgresSchemaSql() {
  return `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
  canonical_id TEXT PRIMARY KEY,
  source TEXT,
  type TEXT,
  title TEXT,
  year INTEGER,
  organization TEXT,
  authors_json JSONB,
  keywords_json JSONB,
  summary TEXT,
  links_json JSONB,
  embedding vector(${appConfig.vectorDimensions}),
  sparse_json JSONB,
  raw_json JSONB,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_documents_embedding_cosine ON documents USING hnsw (embedding vector_cosine_ops);
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
  updated_at TIMESTAMPTZ
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
);`.trim();
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

  const statements = documents.map((document) => {
    const vectorLiteral = `[${(document.vector || []).map((value) => Number(value || 0).toFixed(6)).join(',')}]`;
    return `
INSERT INTO documents (
  canonical_id, source, type, title, year, organization, authors_json, keywords_json,
  summary, links_json, embedding, sparse_json, raw_json, updated_at
) VALUES (
  ${sqlString(document.canonicalId || document.id)},
  ${sqlString(document.source)},
  ${sqlString(document.type)},
  ${sqlString(document.title)},
  ${document.year ?? 'NULL'},
  ${sqlString(document.organization || '')},
  ${sqlJson(document.authors || [])},
  ${sqlJson(document.keywords || [])},
  ${sqlString(document.summary || '')},
  ${sqlJson(document.links || {})},
  ${sqlString(vectorLiteral)}::vector,
  ${sqlJson(document.sparseVector || {})},
  ${sqlJson(document.rawRecord || null)},
  ${sqlString(document.updatedAt || new Date().toISOString())}
)
ON CONFLICT (canonical_id) DO UPDATE SET
  source=EXCLUDED.source,
  type=EXCLUDED.type,
  title=EXCLUDED.title,
  year=EXCLUDED.year,
  organization=EXCLUDED.organization,
  authors_json=EXCLUDED.authors_json,
  keywords_json=EXCLUDED.keywords_json,
  summary=EXCLUDED.summary,
  links_json=EXCLUDED.links_json,
  embedding=EXCLUDED.embedding,
  sparse_json=EXCLUDED.sparse_json,
  raw_json=EXCLUDED.raw_json,
  updated_at=EXCLUDED.updated_at;`.trim();
  });

  try {
    if (statements.length) await runPsql(statements.join('\n'));
    return { enabled: true, synced: documents.length, ready: true };
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
  ORDER BY canonical_id
) t;`);
    if (!output) return [];
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
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
    };
  } catch (error) {
    return {
      enabled: true,
      configured: true,
      ready: false,
      error: error.message,
    };
  }
}
