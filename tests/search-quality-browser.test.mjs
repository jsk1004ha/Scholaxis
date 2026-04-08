import test from 'node:test';
import assert from 'node:assert/strict';

const {
  FIXED_SCENARIOS,
  buildScenarioRequest,
  buildSearchQualityPlan,
  evaluateScenarioPayload,
  relevanceVerdict,
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

test('scenario requests preserve preferred source filters', () => {
  const scenario = getScenario('mixed-source-filtered-student-fair');
  const request = buildScenarioRequest(scenario);
  assert.deepEqual(request.preferredSources, ['student_invention_fair']);
  assert.equal(request.q, 'portable voltage supply student invention fair');
  assert.equal(request.autoLive, false);
});

test('evaluation passes when a fixed scenario target appears inside the allowed top-k window', () => {
  const scenario = getScenario('ko-source-filtered-patent');
  const payload = {
    total: 2,
    results: [
      {
        canonicalId: 'seed-paper-ko-energy-ai',
        sourceKey: 'kci',
        source: 'KCI',
        type: 'paper',
        title: '차세대 배터리 열폭주 예측을 위한 멀티모달 AI 진단 프레임워크',
        englishTitle: 'Multimodal AI Diagnostics for Next-Generation Battery Thermal Runaway Prediction',
      },
      {
        canonicalId: 'seed-patent-ko-edge-medical',
        sourceKey: 'kipris',
        source: 'KIPRIS',
        type: 'patent',
        title: '엣지 컴퓨팅 기반 의료영상 실시간 판독 보조 시스템',
        englishTitle: 'Edge-Assisted Real-Time Medical Imaging Support System',
      }
    ]
  };
  const verdict = evaluateScenarioPayload(scenario, payload);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.reason, 'matched-top-2');
});

test('random-topic relevance verdict rejects noisy top results', () => {
  const verdict = relevanceVerdict('graph neural network', {
    total: 1,
    results: [
      {
        title: 'function renderGraph() { return window.__graph; }',
        englishTitle: '',
        summary: 'document.querySelector("#graph") => unexpected output',
        keywords: [],
        highlights: []
      }
    ]
  });
  assert.equal(verdict.verdict, 'suspect');
  assert.equal(verdict.reason, 'broken-or-noisy');
});
