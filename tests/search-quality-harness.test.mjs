import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_QUALITY_LABELS,
  buildSearchQualityRunPlan,
  buildSearchQualityUrl,
  evaluateSearchQualityCase,
  loadSearchQualityFixtureSet,
  summarizeSearchQualityResults,
} from '../scripts/search-quality-harness.mjs';

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

test('search quality URL builder preserves deterministic filters and overrides', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const testCase = fixtureSet.deterministicCases.find((item) => item.id === 'source-filter-patent-edge-medical');
  const url = new URL(buildSearchQualityUrl('http://127.0.0.1:3000', testCase, { live: 1 }));
  assert.equal(url.searchParams.get('q'), '의료영상 실시간 판독');
  assert.equal(url.searchParams.get('region'), 'domestic');
  assert.equal(url.searchParams.get('sourceType'), 'patent');
  assert.equal(url.searchParams.get('sort'), 'relevance');
  assert.equal(url.searchParams.get('autoLive'), '0');
  assert.equal(url.searchParams.get('live'), '1');
});

test('search quality harness marks seeded exact-title payloads as relevant', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const testCase = fixtureSet.deterministicCases.find((item) => item.id === 'ko-exact-title-battery');
  const verdict = evaluateSearchQualityCase(testCase, {
    total: 1,
    items: [
      {
        id: 'seed-paper-ko-energy-ai',
        type: 'paper',
        region: 'domestic',
        source: 'KCI',
        title: '차세대 배터리 열폭주 예측을 위한 멀티모달 AI 진단 프레임워크',
        englishTitle: 'Multimodal AI Diagnostics for Next-Generation Battery Thermal Runaway Prediction',
        summary: '센서와 영상 데이터를 결합해 배터리 이상 징후를 빠르게 탐지하는 국내 대표 연구입니다.',
        keywords: ['배터리', '열폭주', '센서융합'],
        highlights: ['산업 현장 적용'],
      },
    ],
  });
  assert.equal(verdict.verdict, 'relevant');
  assert.equal(verdict.matchedExpectationRank, 1);
  assert.equal(verdict.topSource, 'kci');
});

test('search quality harness matches fair-entry crosslingual expectations from payload metadata', async () => {
  const fixtureSet = await loadSearchQualityFixtureSet();
  const testCase = fixtureSet.deterministicCases.find((item) => item.id === 'en-crosslingual-portable-voltage');
  const verdict = evaluateSearchQualityCase(testCase, {
    total: 1,
    items: [
      {
        id: 'fair_entry:seed-fair-student-energy',
        type: 'fair_entry',
        region: 'domestic',
        title: '태양에너지를 이용한 휴대용 전압 공급장치',
        englishTitle: 'Portable Voltage Supply Powered by Solar Energy for a Student Invention Fair Project',
        source: '학생발명품경진대회',
        summary: '학생 발명품경진대회·science fair 계열 탐색을 대표하는 사례입니다.',
        keywords: ['태양에너지', '휴대용 전원', 'student invention fair'],
        highlights: ['학생 발명', 'student invention fair'],
      },
    ],
  });
  assert.equal(verdict.verdict, 'relevant');
  assert.equal(verdict.matchedExpectationRank, 1);
  assert.equal(verdict.topSource, 'student_invention_fair');
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
