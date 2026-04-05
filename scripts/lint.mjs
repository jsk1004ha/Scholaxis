import { readFile } from 'node:fs/promises';

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
  'public/admin.html',
  'public/library.html',
  'public/styles.css',
  'public/index.html',
  'tests/api.test.mjs',
  'scripts/sync-sources.mjs',
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
    if (/\s+$/.test(line)) violations.push(`${file}:${index + 1}: trailing whitespace`);
  });
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Lint checks passed for ${files.length} files.`);
