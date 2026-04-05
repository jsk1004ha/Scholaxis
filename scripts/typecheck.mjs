import { spawnSync } from 'node:child_process';

const files = [
  'src/catalog.mjs',
  'src/config.mjs',
  'src/dedup-service.mjs',
  'src/auth-service.mjs',
  'src/docx-text-extractor.mjs',
  'src/http-helpers.mjs',
  'src/pdf-text-extractor.mjs',
  'src/search-service.mjs',
  'src/server.mjs',
  'src/source-cache.mjs',
  'src/storage.mjs',
  'src/similarity-service.mjs',
  'src/source-adapters.mjs',
  'src/source-helpers.mjs',
  'src/vector-service.mjs',
  'public/app.js',
  'public/site.js',
  'tests/api.test.mjs',
  'scripts/lint.mjs',
  'scripts/smoke-test.mjs',
  'scripts/sync-sources.mjs',
  'scripts/backup-sqlite.mjs',
  'scripts/restore-sqlite.mjs'
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax/type-equivalent checks passed for ${files.length} files.`);
