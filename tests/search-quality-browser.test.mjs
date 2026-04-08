import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SCHOLAXIS_EMBEDDING_PROVIDER = 'hash-projection';
process.env.SCHOLAXIS_RERANKER_PROVIDER = process.env.SCHOLAXIS_RERANKER_PROVIDER || 'heuristic';
process.env.SCHOLAXIS_RERANKER_AUTOSTART = 'false';
process.env.SCHOLAXIS_LOCAL_MODEL_AUTOSTART = 'false';
process.env.SCHOLAXIS_AUTO_LIVE_ON_EMPTY = 'false';

const { searchCatalog } = await import('../src/search-service.mjs');
const {
  FIXED_SCENARIOS,
  buildScenarioRequest,
  buildSearchQualityPlan,
  evaluateScenarioPayload,
} = await import('../scripts/search-quality-browser.mjs');

const scenarioById = new Map(FIXED_SCENARIOS.map((scenario) => [scenario.id, scenario]));

function getScenario(id) {
  const scenario = scenarioById.get(id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
}

test('search quality plan covers fixed regression buckets and mixed random topics', () => {
  const plan = buildSearchQualityPlan({ apiRuns: 6, browserRuns: 0, liveSampleRuns: 0 });
  const fixedIntents = new Set(plan.fixedScenarios.map((scenario) => scenario.intent));
  assert.deepEqual(
    [...fixedIntents].sort(),
    ['broad', 'cross-lingual', 'exact-title', 'narrow', 'source-filtered'].sort()
  );

  const fixedLanguages = new Set(
    plan.fixedScenarios
      .filter((scenario) => ['exact-title', 'broad', 'narrow', 'source-filtered'].includes(scenario.intent))
      .map((scenario) => scenario.language)
  );
  assert.deepEqual([...fixedLanguages].sort(), ['en', 'ko', 'mixed']);

  const randomLanguages = new Set(plan.randomScenarios.map((scenario) => scenario.language));
  assert.deepEqual([...randomLanguages].sort(), ['en', 'ko', 'mixed']);
});

test('exact-title and source-filtered regression scenarios resolve expected results', async () => {
  for (const id of [
    'ko-exact-title-battery',
    'en-exact-title-quantum',
    'mixed-source-filtered-student-fair',
    'ko-source-filtered-patent',
    'en-source-filtered-report'
  ]) {
    const scenario = getScenario(id);
    const payload = await searchCatalog(buildScenarioRequest(scenario));
    const verdict = evaluateScenarioPayload(scenario, payload);
    assert.equal(verdict.pass, true, `${id} failed: ${verdict.reason}`);
  }
});

test('cross-lingual regression scenarios still match the seeded target set', async () => {
  for (const id of ['ko-cross-lingual-graph', 'en-cross-lingual-student-fair']) {
    const scenario = getScenario(id);
    const payload = await searchCatalog(buildScenarioRequest(scenario));
    const verdict = evaluateScenarioPayload(scenario, payload);
    assert.equal(verdict.pass, true, `${id} failed: ${verdict.reason}`);
  }
});
