import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve(process.env.SCHOLAXIS_DB_PATH || '.data/scholaxis.db');
const backupDir = path.resolve('.data/backups');
mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `scholaxis-${timestamp}.db`);
copyFileSync(source, target);
console.log(target);
