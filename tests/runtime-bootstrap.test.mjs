import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const sanitizedBaseEnv = { ...process.env };
for (const key of [
  'PORT',
  'DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PSQL_BIN',
  'SCHOLAXIS_STORAGE_BACKEND',
  'SCHOLAXIS_VECTOR_BACKEND',
  'SCHOLAXIS_GRAPH_BACKEND',
  'SCHOLAXIS_DB_PATH',
  'SCHOLAXIS_VECTOR_SERVICE_URL',
  'SCHOLAXIS_GRAPH_SERVICE_URL',
  'SCHOLAXIS_LOCAL_MODEL_AUTOSTART',
  'SCHOLAXIS_LOCAL_MODEL_SERVICE_URL',
  'SCHOLAXIS_LOCAL_MODEL_PYTHON_BIN',
  'SCHOLAXIS_EMBEDDING_PROVIDER',
  'SCHOLAXIS_RERANKER_PROVIDER',
]) {
  delete sanitizedBaseEnv[key];
}

function runBootstrapFixture({
  fixtureDir,
  persistEnvFile = false,
  env = {},
}) {
  const script = `
    import { bootstrapRuntime } from './src/runtime-bootstrap.mjs';
    const state = bootstrapRuntime({
      cwd: process.env.TEST_BOOTSTRAP_CWD,
      persistEnvFile: process.env.TEST_BOOTSTRAP_PERSIST === '1',
      localModelProbe: () => false,
    });
    process.stdout.write(JSON.stringify({
      state,
      env: {
        storageBackend: process.env.SCHOLAXIS_STORAGE_BACKEND || '',
        vectorBackend: process.env.SCHOLAXIS_VECTOR_BACKEND || '',
        graphBackend: process.env.SCHOLAXIS_GRAPH_BACKEND || '',
        localModelAutostart: process.env.SCHOLAXIS_LOCAL_MODEL_AUTOSTART || '',
      },
    }));
  `;

  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot,
    env: {
      ...sanitizedBaseEnv,
      ...env,
      TEST_BOOTSTRAP_CWD: fixtureDir,
      TEST_BOOTSTRAP_PERSIST: persistEnvFile ? '1' : '0',
    },
    encoding: 'utf8',
  });

  return JSON.parse(stdout);
}

test('runtime bootstrap creates a quickstart .env on first start', () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'scholaxis-bootstrap-'));
  const result = runBootstrapFixture({ fixtureDir, persistEnvFile: true });

  const envPath = path.join(fixtureDir, '.env');
  const envContents = readFileSync(envPath, 'utf8');

  assert.equal(result.state.createdEnvFile, envPath);
  assert.equal(result.env.storageBackend, 'sqlite');
  assert.equal(result.env.vectorBackend, 'local');
  assert.equal(result.env.graphBackend, 'local');
  assert.equal(result.env.localModelAutostart, '0');
  assert.match(envContents, /SCHOLAXIS_STORAGE_BACKEND=sqlite/);
  assert.match(envContents, /SCHOLAXIS_LOCAL_MODEL_AUTOSTART=0/);
});

test('runtime bootstrap infers postgres defaults from env files without overriding explicit config', () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'scholaxis-bootstrap-'));
  writeFileSync(
    path.join(fixtureDir, '.env'),
    [
      'DATABASE_URL=postgres://scholaxis:password@127.0.0.1:5432/scholaxis',
      'SCHOLAXIS_GRAPH_SERVICE_URL=http://127.0.0.1:8200',
      '',
    ].join('\n'),
    'utf8'
  );

  const inferred = runBootstrapFixture({ fixtureDir });
  assert.equal(inferred.env.storageBackend, 'postgres');
  assert.equal(inferred.env.vectorBackend, 'pgvector');
  assert.equal(inferred.env.graphBackend, 'http');

  const explicit = runBootstrapFixture({
    fixtureDir,
    env: {
      SCHOLAXIS_STORAGE_BACKEND: 'sqlite',
      SCHOLAXIS_VECTOR_BACKEND: 'local',
    },
  });
  assert.equal(explicit.env.storageBackend, 'sqlite');
  assert.equal(explicit.env.vectorBackend, 'local');
});

test('runtime bootstrap keeps running when quickstart .env cannot be written', () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'scholaxis-bootstrap-live-'));
  chmodSync(fixtureDir, 0o555);
  const result = runBootstrapFixture({
    fixtureDir,
    persistEnvFile: true,
  });

  assert.equal(result.state.createdEnvFile, '');
  assert.match(String(result.state.envCreateError || ''), /(read-only|permission|EROFS|EACCES)/i);
  assert.ok(result.state.inferredDefaults.includes('local sentence-transformers runtime not detected → SCHOLAXIS_LOCAL_MODEL_AUTOSTART=0'));
});
