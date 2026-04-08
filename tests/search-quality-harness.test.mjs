import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import {
  REQUIRED_QUALITY_LABELS,
  buildSearchQualityRunPlan,
  buildSearchQualityUrl,
  evaluateSearchQualityCase,
  loadSearchQualityFixtureSet,
  summarizeSearchQualityResults,
} from '../scripts/search-quality-harness.mjs';

async function startTestServer() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('search quality fixtures cover every required verification label', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const labels = new Set(fixtureSet.deterministicCases.flatMap((item) => item.labels));
  for (const label of REQUIRED_QUALITY_LABELS) {
    if (label === 'random_topic') {
      assert.ok(fixtureSet.randomTopicPool.length > 0);
      continue;
    }
    assert.ok(labels.has(label), `missing fixture label ${label}`);
  }
});

test('search quality plan preserves deterministic cases and appends random-topic runs', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const plan = buildSearchQualityRunPlan({ fixtureSet, apiRuns: fixtureSet.deterministicCases.length + 4 });
  assert.equal(plan.length, fixtureSet.deterministicCases.length + 4);
  assert.equal(plan[0].caseKind, 'deterministic');
  assert.ok(plan.slice(-4).every((item) => item.caseKind === 'random'));
  assert.ok(plan.slice(-4).every((item) => item.labels.includes('random_topic')));
});

test('search quality harness validates deterministic seeded regressions against the local server', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const cases = fixtureSet.deterministicCases.filter((item) => [
    'ko-exact-title-battery',
    'en-exact-title-graph',
    'source-filter-patent-edge-medical',
    'en-crosslingual-portable-voltage',
  ].includes(item.id));

  const { server, baseUrl } = await startTestServer();
  for (const testCase of cases) {
    const response = await fetch(buildSearchQualityUrl(baseUrl, testCase));
    const payload = await response.json();
    const verdict = evaluateSearchQualityCase(testCase, payload);
    assert.equal(response.status, 200);
    assert.equal(verdict.verdict, 'relevant', `${testCase.id} => ${verdict.reason}`);
    assert.ok(verdict.matchedExpectationRank && verdict.matchedExpectationRank <= (testCase.expectations.maxAcceptedRank || 1));
  }
  server.close();
});

test('search quality summary counts verdicts by label', () => {
  const summary = summarizeSearchQualityResults([
    { caseKind: 'deterministic', labels: ['korean', 'exact_title'], verdict: 'relevant' },
    { caseKind: 'deterministic', labels: ['english'], verdict: 'suspect' },
    { caseKind: 'random', labels: ['random_topic'], verdict: 'no_result' },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.relevant, 1);
  assert.equal(summary.suspect, 1);
  assert.equal(summary.noResult, 1);
  assert.equal(summary.deterministicRuns, 2);
  assert.equal(summary.randomRuns, 1);
  assert.equal(summary.byLabel.korean.relevant, 1);
  assert.equal(summary.byLabel.english.suspect, 1);
  assert.equal(summary.byLabel.random_topic.noResult, 1);
});
