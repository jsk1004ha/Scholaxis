import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = path.resolve(process.env.SCHOLAXIS_DB_PATH || '.data/scholaxis.db');
const backupDir = path.resolve('.data/backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `scholaxis-${timestamp}-${randomUUID()}.db`);
const temporary = `${target}.partial`;
// A read-only connection also ensures a missing source cannot become an empty backup.
const database = new DatabaseSync(source, { readOnly: true });
try {
  mkdirSync(backupDir, { recursive: true });
  database.exec('PRAGMA busy_timeout = 5000;');
  // SQLite reads a consistent snapshot, including committed pages still in the WAL.
  database.prepare('VACUUM INTO ?').run(temporary);
  renameSync(temporary, target);
} finally {
  database.close();
  rmSync(temporary, { force: true });
}
console.log(target);
