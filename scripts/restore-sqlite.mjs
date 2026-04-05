import { copyFileSync } from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/restore-sqlite.mjs <backup-file>');
  process.exit(1);
}
const target = path.resolve(process.env.SCHOLAXIS_DB_PATH || '.data/scholaxis.db');
copyFileSync(path.resolve(source), target);
console.log(target);
