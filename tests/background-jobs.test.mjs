import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const postgresUrl = process.env.SCHOLAXIS_TEST_POSTGRES_URL;
const preamble = `
  import assert from 'node:assert/strict';
  import * as storage from './src/storage.mjs';
  import { postgresRuntimeReady } from './src/postgres-store.mjs';
  assert.equal(postgresRuntimeReady(), process.env.SCHOLAXIS_STORAGE_BACKEND === 'postgres');
`;

function psql(env, sql) {
  return execFileSync(env.PSQL_BIN || 'psql', [env.DATABASE_URL, '-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function fixture(t, backend) {
  const directory = mkdtempSync(path.join(tmpdir(), 'scholaxis-jobs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    SCHOLAXIS_STORAGE_BACKEND: backend,
    SCHOLAXIS_VECTOR_BACKEND: 'local',
    SCHOLAXIS_DB_PATH: path.join(directory, 'jobs.db'),
    SCHOLAXIS_LOCAL_MODEL_AUTOSTART: '0',
    SCHOLAXIS_WORKER_LEASE_MS: backend === 'postgres' ? '1500' : '300'
  };
  if (backend === 'postgres') {
    env.DATABASE_URL = postgresUrl;
    // A dedicated test database must already have pgvector installed.
    assert.equal(psql(env, "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector'"), '1');
    const schema = `scholaxis_jobs_${path.basename(directory).replaceAll('-', '_').toLowerCase()}`;
    psql(env, `CREATE SCHEMA ${schema}`);
    t.after(() => psql(env, `DROP SCHEMA ${schema} CASCADE`));
    env.PGOPTIONS = `${env.PGOPTIONS || ''} -c search_path=${schema},public`.trim();
  }
  return {
    env,
    run: (source) => execFileSync(process.execPath, ['--input-type=module', '-e', preamble + source], {
      cwd: repoRoot, env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  };
}

for (const backend of ['sqlite', 'postgres']) {
  const options = {
    timeout: 30000,
    skip: backend === 'postgres' && !postgresUrl ? 'Set SCHOLAXIS_TEST_POSTGRES_URL for real PostgreSQL + pgvector coverage' : false
  };

  test(`${backend}: recover an expired lease and reject the previous owner's writes`, options, (t) => {
    const { run } = fixture(t, backend);
    run(`
      const start = Date.now() + 60000;
      const at = (offset) => new Date(start + offset).toISOString();
      const queued = storage.enqueueBackgroundJob({ jobType: 'recovery-test', runAfter: at(0) });
      storage.enqueueBackgroundJob({ jobType: 'future-test', priority: 100, runAfter: at(5000) });
      const first = storage.leaseNextBackgroundJob({ now: at(0), leaseMs: 1000 });
      assert.equal(first.id, queued.id);
      assert.equal(first.attempts, 1);
      assert.equal(Date.parse(first.leasedUntil), start + 1000);
      assert.equal(storage.leaseNextBackgroundJob({ now: at(999), leaseMs: 1000 }), null);
      const renewed = storage.renewBackgroundJobLease(first.id, { attempts: first.attempts, now: at(500), leaseMs: 1000 });
      assert.equal(Date.parse(renewed.leasedUntil), start + 1500);
      assert.equal(storage.leaseNextBackgroundJob({ now: at(1000), leaseMs: 1000 }), null);
      const second = storage.leaseNextBackgroundJob({ now: at(1500), leaseMs: 1000 });
      assert.equal(second.id, first.id);
      assert.equal(second.attempts, 2);
      const oldOwner = { attempts: first.attempts };
      assert.equal(storage.renewBackgroundJobLease(first.id, { ...oldOwner, now: at(1501) }), null);
      assert.equal(storage.completeBackgroundJob(first.id, oldOwner), null);
      assert.equal(storage.failBackgroundJob(first.id, 'late failure', oldOwner), null);
      assert.equal(storage.requeueBackgroundJob(first.id, 0, oldOwner), null);
      assert.equal(storage.completeBackgroundJob(first.id), null);
      assert.equal(storage.completeBackgroundJob(second.id, { attempts: second.attempts }).status, 'completed');
      assert.equal(storage.requeueBackgroundJob(second.id, 0, { attempts: second.attempts }), null);
      assert.equal(storage.leaseNextBackgroundJob({ now: at(4999) }), null);
    `);
  });

  test(`${backend}: a new process recovers abandoned work and retries keep their delay`, options, (t) => {
    const { run } = fixture(t, backend);
    const abandoned = JSON.parse(run(`
      storage.enqueueBackgroundJob({ jobType: 'abandoned-test', runAfter: new Date(Date.now() - 10000).toISOString() });
      process.stdout.write(JSON.stringify(storage.leaseNextBackgroundJob({ now: new Date(Date.now() - 2000).toISOString(), leaseMs: 1000 })));
    `));
    run(`
      const expiredOwner = { attempts: ${abandoned.attempts} };
      assert.equal(storage.renewBackgroundJobLease(${abandoned.id}, expiredOwner), null);
      assert.equal(storage.completeBackgroundJob(${abandoned.id}, expiredOwner), null);
      assert.equal(storage.failBackgroundJob(${abandoned.id}, 'expired failure', expiredOwner), null);
      const recovered = storage.leaseNextBackgroundJob();
      assert.equal(recovered.id, ${abandoned.id});
      assert.equal(recovered.attempts, 2);
      const owner = { attempts: recovered.attempts };
      assert.equal(storage.failBackgroundJob(recovered.id, 'retry me', owner).status, 'failed');
      assert.equal(storage.requeueBackgroundJob(recovered.id, 5000, { attempts: 1 }), null);
      const queued = storage.requeueBackgroundJob(recovered.id, 5000, owner);
      assert.equal(queued.status, 'queued');
      const due = Date.parse(queued.runAfter);
      assert.equal(storage.leaseNextBackgroundJob({ now: new Date(due - 1).toISOString() }), null);
      const retried = storage.leaseNextBackgroundJob({ now: new Date(due).toISOString() });
      assert.equal(retried.id, recovered.id);
      assert.equal(retried.attempts, 3);
    `);
  });

  test(`${backend}: a live worker renews ownership beyond its initial lease`, options, (t) => {
    const { run } = fixture(t, backend);
    run(`
      import { setTimeout as delay } from 'node:timers/promises';
      import { workNextJob } from './src/job-service.mjs';
      import { appConfig } from './src/config.mjs';
      storage.enqueueBackgroundJob({ jobType: 'long-running-test' });
      const processed = await workNextJob({ runJob: async () => {
        for (let index = 0; index < 4; index += 1) {
          await delay(appConfig.workerLeaseMs / 2);
          assert.equal(storage.leaseNextBackgroundJob(), null);
        }
        return { ok: true };
      } });
      assert.equal(processed.status, 'completed');
      assert.equal(processed.attempts, 1);
      assert.equal(storage.listBackgroundJobs()[0].status, 'completed');
    `);
  });

  test(`${backend}: simultaneous worker processes acquire distinct jobs`, options, async (t) => {
    const { env, run } = fixture(t, backend);
    run(`for (let index = 0; index < 4; index += 1) storage.enqueueBackgroundJob({ jobType: 'parallel-test' });`);
    const children = Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', preamble + `
        process.send({ ready: true });
        process.once('message', () => {
          process.send({ job: storage.leaseNextBackgroundJob() });
          process.disconnect();
        });
      `], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      t.after(() => { if (child.exitCode === null) child.kill(); });
      child.stderr.on('data', () => {});
      return child;
    });
    await Promise.all(children.map((child) => once(child, 'message')));
    const results = children.map((child) => once(child, 'message'));
    // Force contention before acquisition. The old SELECT-then-UPDATE gave every worker the same row.
    const blocker = backend === 'sqlite' ? new DatabaseSync(env.SCHOLAXIS_DB_PATH) : null;
    try {
      blocker?.exec('BEGIN IMMEDIATE');
      children.forEach((child) => child.send('claim'));
      if (blocker) {
        await delay(150);
        blocker.exec('COMMIT');
      }
      const jobs = (await Promise.all(results)).map(([message]) => message.job);
      assert.equal(new Set(jobs.map((job) => job?.id)).size, 4);
      assert.ok(jobs.every((job) => job?.attempts === 1));
    } finally {
      blocker?.close();
    }
  });
}

test('a worker that loses ownership cannot complete or fail the replacement lease', (t) => {
  const { run } = fixture(t, 'sqlite');
  run(`
    import { DatabaseSync } from 'node:sqlite';
    import { workNextJob } from './src/job-service.mjs';
    const db = new DatabaseSync(process.env.SCHOLAXIS_DB_PATH);
    for (const shouldFail of [false, true]) {
      db.exec('DELETE FROM background_jobs');
      storage.enqueueBackgroundJob({ jobType: 'lost-lease-test' });
      const processed = await workNextJob({ runJob: async (job) => {
        db.prepare('UPDATE background_jobs SET attempts = attempts + 1 WHERE id = ?').run(job.id);
        if (shouldFail) throw new Error('late failure');
        return { ok: true };
      } });
      assert.equal(processed.status, 'lease-lost');
      const current = storage.listBackgroundJobs()[0];
      assert.equal(current.status, 'leased');
      assert.equal(current.attempts, 2);
    }
    db.close();
  `);
});
