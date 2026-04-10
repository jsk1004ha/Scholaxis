# Request hardening verification

This note is the worker-3 verification checklist for the “request-driven freeze” hardening slice.
The goal is not just to pass unit tests, but to prove that heavy request bursts no longer stall the main HTTP process and that overload is handled with bounded queueing or explicit backpressure.

## Minimum automated evidence

Run the standard repo verification first:

```bash
npm run lint
npm run typecheck
npm test
npm run smoke
```

Then capture one focused burst check with the standalone harness:

```bash
node scripts/search-runtime-burst-check.mjs
```

To point the harness at another branch/module without copying files, override the server entry path:

```bash
SCHOLAXIS_BURST_SERVER_MODULE=/absolute/path/to/src/server.mjs \
node scripts/search-runtime-burst-check.mjs
```

If you already have a server running, target it directly instead of spawning a local one:

```bash
SCHOLAXIS_BURST_BASE_URL=http://127.0.0.1:3000 \
node scripts/search-runtime-burst-check.mjs
```

These four commands remain the release gate even after targeted runtime checks are added.

## Targeted concurrent-request check

After the bounded search runtime lands, run one focused burst test with deliberately small search-runtime limits so queueing/backpressure is easy to observe.
The current runtime draft is shaping around these knobs:

- `SCHOLAXIS_SEARCH_WORKERS`
- `SCHOLAXIS_SEARCH_MAX_QUEUED_TASKS`
- `SCHOLAXIS_SEARCH_REQUEST_TIMEOUT_MS`
- `SCHOLAXIS_SEARCH_OVERLOAD_RETRY_AFTER_MS`
- `SCHOLAXIS_TEST_SEARCH_DELAY_MS` (useful for deterministic burst tests)
- `SCHOLAXIS_BURST_HEALTH_BUDGET_MS` (response-time budget for the health probe in the standalone harness)
- `SCHOLAXIS_BURST_REQUIRE_OVERLOAD` (mark the run as failed unless at least one request is rejected under load)

Use tiny values (for example, `SCHOLAXIS_SEARCH_WORKERS=1` and `SCHOLAXIS_SEARCH_MAX_QUEUED_TASKS=1`) before starting the server so the overload path is easy to reproduce. If the merged implementation renames any knob, update this checklist to match the final config surface.

Verification goal:

1. A small burst of concurrent `/api/search` requests does **not** make `/api/health` stop responding.
2. At least one request is visibly queued or delayed instead of all heavy work running at once.
3. Overflow past the queue limit returns a **controlled** overload response instead of hanging the server.
4. Admin/runtime diagnostics expose the search runtime state while the burst is active.

Suggested manual recipe:

1. Start the server with intentionally small search-runtime capacity.
2. Fire multiple concurrent `/api/search?q=...` requests against a query that exercises the heavy path.
3. While those requests are in flight, hit `/api/health` and confirm it still responds promptly.
4. Check `/api/admin/summary` or `/api/admin/ops` and record the search runtime metrics that move under load.
5. Record the response mix:
   - successful searches
   - queued/delayed searches
   - overload/backpressure responses (if the burst exceeds the queue limit)

Example burst harness:

```bash
PORT=3000 \
SCHOLAXIS_SEARCH_WORKERS=1 \
SCHOLAXIS_SEARCH_MAX_QUEUED_TASKS=1 \
node src/server.mjs

for i in 1 2 3; do
  curl -s -o "/tmp/search-$i.json" -w "search-$i status=%{http_code} total=%{time_total}\n" \
    "http://127.0.0.1:${PORT}/api/search?q=%EB%B0%B0%ED%84%B0%EB%A6%AC%20AI" &
done

sleep 0.2
curl -s -o /tmp/health.json -w "health status=%{http_code} total=%{time_total}\n" \
  "http://127.0.0.1:${PORT}/api/health"
wait
```

The exact response mix can vary, but the important signal is that `/api/health` stays responsive while the burst is active and that excess search load is bounded instead of freezing the process. The standalone harness treats a slow-but-eventually-successful health probe as a failure once it exceeds `SCHOLAXIS_BURST_HEALTH_BUDGET_MS` (default `750`).

If you inspect `/api/admin/summary` or `/api/admin/ops` during the burst, remember those endpoints require an authenticated admin session (`SCHOLAXIS_ADMIN_EMAILS`).

## What to review in the payloads

The exact field names depend on the implementation, but the final review should confirm that the new search runtime exposes enough evidence to answer these questions:

- How many search workers are configured?
- How many are busy right now?
- How many requests are queued?
- How many were rejected because the queue was full?
- Is analysis-runtime telemetry still present beside the new search-runtime telemetry?

## API compatibility checks

The hardening work should preserve the existing user-facing contract unless an intentional overload response is returned.
Review these points during verification:

- existing successful `/api/search` responses still return normal result payloads
- `/api/search/stream` still behaves predictably under load
- admin pages keep rendering if the new search runtime telemetry is present or temporarily zero
- heavy search traffic does not break existing analysis endpoints

## Evidence to include in the final task report

Copy the following structure into the completion note once the feature is merged and verified:

```text
Verification:
- PASS: npm run lint
- PASS: npm run typecheck
- PASS: npm test
- PASS: npm run smoke
- PASS/FAIL: concurrent search burst check (include request count, queue setting, observed behavior)
- PASS/FAIL: admin/runtime diagnostics review (include key search-runtime metrics)
- PASS/FAIL: health endpoint remained responsive during burst
```

If any item fails, capture the command/output and the exact failure mode instead of summarizing it loosely.
