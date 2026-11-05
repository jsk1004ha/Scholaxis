import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const backupScript = fileURLToPath(new URL('../scripts/backup-sqlite.mjs', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'scholaxis-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "live's database.db");
  return {
    directory,
    source,
    options: { cwd: directory, env: { ...process.env, SCHOLAXIS_DB_PATH: source }, encoding: 'utf8' }
  };
}

test('backup snapshots committed WAL data while a writer stays open', (t) => {
  const { directory, source, options } = fixture(t);
  const writer = new DatabaseSync(source);
  t.after(() => writer.close());
  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
    INSERT INTO notes VALUES (1, 'checkpointed');
    PRAGMA wal_checkpoint(TRUNCATE);
    INSERT INTO notes VALUES (2, 'committed in WAL');
  `);
  assert.ok(statSync(`${source}-wal`).size > 0);
  // Prove the fixture would lose data if only the main file were copied.
  const mainOnly = path.join(directory, 'main-only.db');
  copyFileSync(source, mainOnly);
  const copied = new DatabaseSync(mainOnly, { readOnly: true });
  assert.equal(copied.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
  copied.close();

  writer.exec("BEGIN IMMEDIATE; INSERT INTO notes VALUES (3, 'not committed');");
  const targets = [];
  for (let index = 0; index < 2; index += 1) {
    const target = execFileSync(process.execPath, [backupScript], options).trim();
    targets.push(target);
    const backup = new DatabaseSync(target, { readOnly: true });
    assert.deepEqual(backup.prepare('SELECT body FROM notes ORDER BY id').all().map((row) => row.body), [
      'checkpointed', 'committed in WAL'
    ]);
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    backup.close();
  }
  assert.notEqual(targets[0], targets[1]);
  assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3);
  writer.exec('ROLLBACK');
  assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 2);
  assert.equal(readdirSync(path.join(directory, '.data/backups')).filter((name) => name.endsWith('.partial')).length, 0);
});

for (const failure of ['missing', 'corrupt']) {
  test(`backup rejects a ${failure} source without publishing a snapshot`, (t) => {
    const { directory, source, options } = fixture(t);
    if (failure === 'corrupt') writeFileSync(source, 'This is not a SQLite database.');
    const result = spawnSync(process.execPath, [backupScript], options);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    if (failure === 'missing') assert.equal(existsSync(source), false);
    const backups = path.join(directory, '.data/backups');
    assert.deepEqual(existsSync(backups) ? readdirSync(backups) : [], []);
  });
}
