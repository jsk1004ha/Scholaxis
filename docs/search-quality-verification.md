# Search quality verification

Scholaxis search hardening must ship with repeatable evidence, not just ad-hoc manual spot checks. The search-quality harness now uses a committed fixture set plus randomized spillover queries so regression evidence covers:

- Korean queries
- English queries
- mixed-language queries
- exact-title regressions
- broad-topic recall
- narrow technical precision
- source-filtered retrieval
- random-topic sanity checks

## Fixture asset

- Fixture file: `tests/fixtures/search-quality-cases.json`
- Harness logic: `scripts/search-quality-harness.mjs`
- Browser/evidence runner: `scripts/search-quality-browser.mjs`

Deterministic cases are grounded in the local seed catalog and record the expected source/type/title fragments for each regression query. Random-topic coverage comes from the committed `randomTopicPool`, so repeated runs stay comparable while still sampling beyond the deterministic set.

## Commands

```bash
npm run quality:search
npm run quality:search:quick
```

Useful environment overrides:

- `SCHOLAXIS_QUALITY_API_RUNS` — total API cases to execute (deterministic fixtures first, then random-topic pool)
- `SCHOLAXIS_QUALITY_BROWSER_RUNS` — number of deterministic-first result-page browser checks
- `SCHOLAXIS_QUALITY_LIVE_SAMPLE_RUNS` — number of live-source samples to probe after the local regression pass
- `CHROME_BIN` — explicit Chrome/Edge binary if auto-detection fails

## Evidence output

Every harness run writes:

- `.omx/reports/search-quality-<timestamp>.json`
- `.omx/reports/search-quality-<timestamp>.md`

The JSON report keeps per-query evidence (`query`, `labels`, `verdict`, `reason`, `matchedExpectationRank`, top result metadata). The Markdown summary is intended for quick review in task reports / PR notes.

## Review rules

1. Deterministic exact-title regressions should be `relevant` at rank 1 unless the ranking change was explicitly intended.
2. Cross-lingual and source-filtered fixtures should remain within the configured accepted rank window.
3. Random-topic failures should be treated as investigation input, not silently ignored.
4. Browser checks must not silently degrade into empty or error-only result pages.
5. Keep fixture expectations source-grounded; do not turn the harness into a hardcoded ranking implementation.
