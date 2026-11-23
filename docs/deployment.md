# Deployment Guide

## Local run

```bash
npm start
```

On a fresh clone, `npm start` now auto-creates a minimal `.env` quickstart file when none exists,
boots on SQLite/local-vector defaults, and skips local sentence-transformers autostart when no
local runtime is detected. This keeps first boot deployer-friendly.

The server listens on `PORT` if provided, otherwise `3000`.
If `3000` is already occupied, Scholaxis automatically retries the next ports up to
`SCHOLAXIS_PORT_FALLBACK_ATTEMPTS`.

If `DATABASE_URL` or the standard `PG*` variables are already present, `npm start` also infers:

- `SCHOLAXIS_STORAGE_BACKEND=postgres`
- `SCHOLAXIS_VECTOR_BACKEND=pgvector`

unless you explicitly override them.

### SQLite persistence on restart

SQLite always attempts to reopen `SCHOLAXIS_DB_PATH` (or `.data/scholaxis.db` when unset). Database and WAL size alone never trigger an empty recovery database, so users, sessions, library items, and saved searches remain in the original store across restarts. The former `SCHOLAXIS_DB_MAX_BYTES_BEFORE_RECOVERY` and `SCHOLAXIS_DB_WAL_MAX_BYTES_BEFORE_RECOVERY` variables no longer redirect storage.

Manage storage growth with backups, retention, and WAL maintenance. Existing handling of genuine SQLite corruption and open failures is unchanged; check storage diagnostics and startup warnings when recovery is used.

### SQLite backups

Run `npm run backup` with the same `SCHOLAXIS_DB_PATH` as the application. The command opens the source read-only and uses SQLite `VACUUM INTO` to snapshot committed data from both the database and its WAL while the application remains online. Uncommitted transactions are excluded. A unique `.partial` file is renamed to the final `.data/backups/scholaxis-*.db` only after the snapshot succeeds; ordinary failures remove the partial file and return a nonzero exit status. A missing source is never created as an empty database.

The resulting `.db` is self-contained. Before `npm run restore -- <backup-file>`, stop all processes using the target database and let their SQLite connections close cleanly so an old WAL is not replayed over the restored file. For a database left behind by an unclean shutdown, recover/checkpoint it with SQLite before replacing it. Keep the original files until the restored data has been checked.

## Search / infra env example

```bash
# Primary serious-use path
SCHOLAXIS_STORAGE_BACKEND=postgres
SCHOLAXIS_VECTOR_BACKEND=pgvector
SCHOLAXIS_GRAPH_BACKEND=http
DATABASE_URL=postgres://scholaxis:password@127.0.0.1:5432/scholaxis
SCHOLAXIS_VECTOR_SERVICE_URL=http://127.0.0.1:8100
SCHOLAXIS_GRAPH_SERVICE_URL=http://127.0.0.1:8200
SCHOLAXIS_ENABLE_LIVE_SOURCES=true
# Optional: leave this empty to include all live sources in default auto routing
# Set only the sources you want to keep out of default auto routing
# SCHOLAXIS_EXPERIMENTAL_LIVE_SOURCES=pubmed,biorxiv,medrxiv,kiss,nanet,cve,blackhat,defcon
SCHOLAXIS_SCHEDULER_INTERVAL_MS=60000
SCHOLAXIS_WORKER_POLL_MS=1500
SCHOLAXIS_WORKER_LEASE_MS=15000
SCHOLAXIS_CITATION_EXPANSION_LIMIT=6
SCHOLAXIS_RECOMMENDATION_CANDIDATE_LIMIT=24
```

## PostgreSQL + pgvector migration

Generate migration SQL from the current SQLite-backed state:

```bash
npm run migrate:postgres
```

This writes `.data/postgres-migration.sql` containing:
- `CREATE EXTENSION IF NOT EXISTS vector`
- `documents` with `vector(n)` embedding column
- `graph_edges`
- `background_jobs`
- data export inserts from the current local store

If PostgreSQL is available locally, Scholaxis can also sync runtime documents into the
configured database through the `psql` CLI using `DATABASE_URL` or standard `PG*`
environment variables.

Validate the serious-use path:

```bash
npm run validate:postgres
```

This command exits successfully only when Scholaxis is configured for the
recommended PostgreSQL + pgvector path and the schema/pgvector extension are reachable.

## Startup responsiveness note

Scholaxis now keeps eager search-index warmup **disabled by default** during process
startup so `/api/health`, browser smoke checks, and first-boot diagnostics do not stall
behind a large local index build.

Enable eager warmup only when you explicitly want it:

```bash
export SCHOLAXIS_WARM_SEARCH_INDEX_ON_START=true
```

### `validate:postgres` troubleshooting

`npm run validate:postgres` prints a structured readiness report before it exits.
Interpret the top-level `status` like this:

- `validated` — the serious-use PostgreSQL + pgvector lane is configured correctly and the schema is reachable.
- `configuration-required` — PostgreSQL + pgvector is selected, but one or more prerequisites still need to be fixed.
- `development-fallback` — the app is still running in SQLite/local-vector mode; this is acceptable for local quickstart, but not the recommended serious-use path.

Common fixes:

- `storage-backend` failed → set `SCHOLAXIS_STORAGE_BACKEND=postgres`
- `vector-backend` failed → set `SCHOLAXIS_VECTOR_BACKEND=pgvector`
- `connection-config` failed → set `DATABASE_URL` or the standard `PG*` variables
- `psql-cli` failed → install PostgreSQL client tools or point `PSQL_BIN` at a working `psql`
- `schema-sync` failed → run `npm run migrate:postgres -- --apply` after the connection settings are correct

You can compare the CLI validator with the live runtime view through:

```bash
curl http://127.0.0.1:3000/api/admin/infra
```

The `seriousUsePath` payload mirrors the same readiness contract used by `validate:postgres`.

## Scheduler / worker split

Queue the default infrastructure jobs:

```bash
npm run scheduler
```

Process queued jobs in a separate worker process:

```bash
npm run worker
```

Acquisition is atomic in both storage backends. Workers can take due `queued` jobs or reclaim `leased` jobs whose `leased_until` has passed. PostgreSQL uses `FOR UPDATE SKIP LOCKED` so parallel workers skip claims already being acquired. Each acquisition increments `attempts`, which acts as the ownership token for renewal and completion/failure updates. Retry updates only apply to a failed job with the same attempt number.

Restart all worker processes when deploying this change so older workers cannot acknowledge jobs without checking the ownership token. No schema migration is needed; the token uses the existing `attempts` column.

While an asynchronous job runs, the worker renews its lease every third of `SCHOLAXIS_WORKER_LEASE_MS` (default 15000 ms). A worker that loses ownership returns `lease-lost` and leaves the current claim alone. Set the lease duration above the longest synchronous operation or event-loop stall in your workload; a blocked or stopped process cannot send a heartbeat. Recovery is at-least-once: job side effects should remain idempotent because a worker can stop after applying a side effect and before recording completion.

The normal test command includes live-WAL backup, lease recovery, concurrent SQLite claim, heartbeat, and stale-owner regression tests. To run the same queue contract against real PostgreSQL, use a dedicated disposable database with pgvector already installed and a role permitted to create schemas:

```bash
SCHOLAXIS_TEST_POSTGRES_URL=postgres://user:password@localhost:5432/scholaxis_test \
  node --test tests/background-jobs.test.mjs
```

PostgreSQL tests create and remove their own schemas and explicitly fail if storage falls back to SQLite. They are skipped when the test URL is unset.

Run standalone vector / graph services on separate ports:

```bash
npm run vector-service
npm run graph-service
```

You can also drive the same flow through HTTP:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/jobs \
  -H 'content-type: application/json' \
  -d '{"action":"schedule-defaults"}'

curl -X POST http://127.0.0.1:3000/api/admin/jobs \
  -H 'content-type: application/json' \
  -d '{"action":"run-worker-once","iterations":3}'
```

## Vector / graph service split

Scholaxis now supports these runtime modes:

- `SCHOLAXIS_VECTOR_BACKEND=local` — in-process dense vector search
- `SCHOLAXIS_VECTOR_BACKEND=http` — POST `/upsert`, `/search` on `SCHOLAXIS_VECTOR_SERVICE_URL`
- `SCHOLAXIS_VECTOR_BACKEND=pgvector` — PostgreSQL documents table + pgvector similarity search path

- `SCHOLAXIS_GRAPH_BACKEND=local` — in-process author/citation/reference graph
- `SCHOLAXIS_GRAPH_BACKEND=http` — POST `/upsert` on `SCHOLAXIS_GRAPH_SERVICE_URL`

Diagnostics:

```bash
curl http://127.0.0.1:3000/api/admin/infra
curl http://127.0.0.1:3000/api/admin/postgres-migration
```

## Live source mode

To enable external source fan-out:

```bash
SCHOLAXIS_ENABLE_LIVE_SOURCES=true npm start
```

If you have provider credentials:

```bash
SEMANTIC_SCHOLAR_API_KEY=... \
DBPIA_API_KEY=... \
KIPRIS_PLUS_API_KEY=... \
KIPRIS_PLUS_SEARCH_URL=... \
SCHOLAXIS_ENABLE_LIVE_SOURCES=true \
npm start
```

## Recommended production shape

- Run the Node process behind Nginx, Caddy, or a cloud load balancer.
- Terminate TLS at the edge.
- Keep the unified origin model (`/` for the SPA, `/api/*` for APIs).
- Apply proxy-level rate limiting for expensive crawl/API fan-out requests.
- Prefer explicit source keys over anonymous scraping where providers offer official APIs.
- Run scheduler and worker as separate processes/services.
- Treat PostgreSQL + pgvector as the primary serious-use persistence/search path.
- Run `npm run migrate:postgres -- --apply` and `npm run validate:postgres` as part of deployment bring-up.
- PostgreSQL mode now supports direct pgvector nearest-neighbor search; external vector service remains optional.
- Move citation/reference graph to the graph backend when scale grows.

## Cloudflare Tunnel

Cloudflare Tunnel is supported as the primary single-origin publishing method.

Quick share:

```bash
cloudflared tunnel --url http://localhost:3000
```

Named tunnel validation:

```bash
cloudflared tunnel ingress validate --config cloudflared/config.example.yml
cloudflared tunnel run scholaxis-demo
```

## Example systemd unit

```ini
[Unit]
Description=Scholaxis unified research app
After=network.target

[Service]
WorkingDirectory=/opt/scholaxis
ExecStart=/usr/bin/node /opt/scholaxis/src/server.mjs
Environment=PORT=3000
Restart=always
User=scholaxis
Group=scholaxis

[Install]
WantedBy=multi-user.target
```
