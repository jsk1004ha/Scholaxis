import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const check = args.includes('--check');
const filtered = args.filter((arg) => arg !== '--apply' && arg !== '--check');
const outputPath = filtered[0] || '.data/postgres-migration.sql';

if (!check) {
  process.env.SCHOLAXIS_STORAGE_BACKEND ||= 'sqlite';
}

const [{ buildPostgresMigrationSql }, { getPostgresSchemaSql, getPostgresSeriousUsePathDiagnostics }] = await Promise.all([
  import('../src/postgres-migration.mjs'),
  import('../src/postgres-store.mjs')
]);

if (check) {
  const diagnostics = getPostgresSeriousUsePathDiagnostics();
  console.log(JSON.stringify(diagnostics, null, 2));
  if (!diagnostics.ready) {
    process.exit(1);
  }
  process.exit(0);
}

function buildPsqlArgs(sql) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  if (process.env.DATABASE_URL) return [process.env.DATABASE_URL, ...args];
  return args;
}

async function runPsql(sql) {
  const { stdout } = await execFileAsync(process.env.PSQL_BIN || 'psql', buildPsqlArgs(sql), {
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout;
}

await mkdir(path.dirname(outputPath), { recursive: true });
const sql = buildPostgresMigrationSql();
await writeFile(outputPath, sql, 'utf8');
console.log(`PostgreSQL migration bundle written to ${outputPath}`);

if (apply) {
  const configured = Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGSERVICE);
  if (!configured) {
    throw new Error('PostgreSQL apply mode requires DATABASE_URL or PGHOST/PGSERVICE environment variables');
  }

  await runPsql(getPostgresSchemaSql());
  await runPsql(sql);
  console.log('PostgreSQL migration applied successfully.');
}
