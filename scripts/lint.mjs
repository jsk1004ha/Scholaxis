import { readFile } from 'node:fs/promises';

const files = [
  'src/catalog.mjs',
  'src/config.mjs',
  'src/dedup-service.mjs',
  'src/auth-service.mjs',
  'src/docx-text-extractor.mjs',
  'src/graph-service.mjs',
  'src/graph-backend-server.mjs',
  'src/hwp-text-extractor.mjs',
  'src/http-helpers.mjs',
  'src/job-service.mjs',
  'src/pdf-text-extractor.mjs',
  'src/postgres-migration.mjs',
  'src/postgres-store.mjs',
  'src/recommendation-service.mjs',
  'src/runtime-bootstrap.mjs',
  'src/search-service.mjs',
  'src/server.mjs',
  'src/source-cache.mjs',
  'src/storage.mjs',
  'src/similarity-service.mjs',
  'src/source-adapters.mjs',
  'src/source-helpers.mjs',
  'src/vector-backend-server.mjs',
  'src/vector-index-service.mjs',
  'src/vector-service.mjs',
  'public/app.js',
  'public/site.js',
  'public/admin.html',
  'public/library.html',
  'public/styles.css',
  'public/index.html',
  'tests/api.test.mjs',
  'tests/runtime-bootstrap.test.mjs',
  'scripts/sync-sources.mjs',
  'scripts/postgres-migrate.mjs',
  'scripts/search-quality-browser.mjs',
  'scripts/start.mjs',
  'scripts/start-scheduler.mjs',
  'scripts/start-vector-service.mjs',
  'scripts/start-graph-service.mjs',
  'scripts/start-worker.mjs',
  'scripts/backup-sqlite.mjs',
  'scripts/restore-sqlite.mjs',
  'README.md',
  'docs/security.md',
  'docs/deployment.md',
  'docs/cloudflared-tunnel.md',
  '.env.example'
];

const violations = [];
for (const file of files) {
  const contents = await readFile(file, 'utf8');
  if (contents.includes('\t')) violations.push(`${file}: tab character detected`);
  if (/console\.log\(/.test(contents) && !file.endsWith('src/server.mjs') && !file.startsWith('scripts/')) violations.push(`${file}: unexpected console.log`);
  if (/debugger;/.test(contents)) violations.push(`${file}: debugger statement found`);
  contents.split('\n').forEach((line, index) => {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (/[ \t]+$/.test(normalizedLine)) violations.push(`${file}:${index + 1}: trailing whitespace`);
  });
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Lint checks passed for ${files.length} files.`);
