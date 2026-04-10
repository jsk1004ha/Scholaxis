import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hasBrokenEncoding, looksLikeNoise, matchesQueryText } from '../src/source-helpers.mjs';
import { normalizeText, tokenize } from '../src/vector-service.mjs';

export const DEFAULT_QUALITY_FILTERS = Object.freeze({
  region: 'all',
  sourceType: 'all',
  sort: 'relevance',
  autoLive: 0,
});

export const REQUIRED_QUALITY_LABELS = Object.freeze([
  'korean',
  'english',
  'mixed_language',
  'cross_lingual',
  'exact_title',
  'broad_topic',
  'narrow_technical',
  'source_filtered',
  'random_topic',
]);

export const DEFAULT_QUALITY_FIXTURE_PATH = path.resolve('tests/fixtures/search-quality-cases.json');

const SOURCE_ALIASES = new Map([
  ['kci', 'kci'],
  ['dbpia', 'dbpia'],
  ['arxiv', 'arxiv'],
  ['semantic scholar', 'semantic_scholar'],
  ['semanticscholar', 'semantic_scholar'],
  ['kipris', 'kipris'],
  ['ntis', 'ntis'],
  ['학생발명품경진대회', 'student_invention_fair'],
  ['학생 발명품 경진대회', 'student_invention_fair'],
  ['student invention fair', 'student_invention_fair'],
  ['science fair', 'student_invention_fair'],
]);

function normalizeLooseText(value = '') {
  return normalizeText(String(value || '')) || String(value || '').trim().toLowerCase();
}

function normalizeSourceValue(value = '') {
  const normalized = normalizeLooseText(value);
  return SOURCE_ALIASES.get(normalized) || normalized;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function shuffle(values = []) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizeSearchQualityCase(item = {}, index = 0) {
  return {
    id: String(item.id || `case-${index + 1}`),
    query: String(item.query || '').trim(),
    labels: unique((item.labels || []).map((label) => String(label).trim().toLowerCase())),
    filters: {
      ...DEFAULT_QUALITY_FILTERS,
      ...(item.filters || {}),
    },
    expectations: { ...(item.expectations || {}) },
    provenance: item.provenance || null,
    runLiveSample: item.runLiveSample !== false,
    caseKind: item.caseKind || 'deterministic',
  };
}

function validateSearchQualityFixtureSet(data, fixturePath) {
  if (!data || typeof data !== 'object') {
    throw new Error(`Search quality fixture at ${fixturePath} must be a JSON object.`);
  }
  if (!Array.isArray(data.deterministicCases) || !data.deterministicCases.length) {
    throw new Error(`Search quality fixture at ${fixturePath} must contain deterministicCases[].`);
  }
  if (!Array.isArray(data.randomTopicPool) || !data.randomTopicPool.length) {
    throw new Error(`Search quality fixture at ${fixturePath} must contain randomTopicPool[].`);
  }

  const labels = new Set();
  for (const [index, item] of data.deterministicCases.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error(`deterministicCases[${index}] in ${fixturePath} must be an object.`);
    }
    if (!String(item.query || '').trim()) {
      throw new Error(`deterministicCases[${index}] in ${fixturePath} is missing query.`);
    }
    for (const label of item.labels || []) labels.add(String(label).trim().toLowerCase());
  }

  for (const label of REQUIRED_QUALITY_LABELS) {
    if (label === 'random_topic') {
      if (!data.randomTopicPool.length) {
        throw new Error(`Search quality fixture at ${fixturePath} must provide randomTopicPool[] for random_topic coverage.`);
      }
      continue;
    }
    if (!labels.has(label)) {
      throw new Error(`Search quality fixture at ${fixturePath} is missing required label: ${label}`);
    }
  }
}

export async function loadSearchQualityFixtureSet(fixturePath = DEFAULT_QUALITY_FIXTURE_PATH) {
  const resolvedPath = path.resolve(fixturePath);
  const raw = await readFile(resolvedPath, 'utf8');
  const data = JSON.parse(raw);
  validateSearchQualityFixtureSet(data, resolvedPath);
  return {
    fixturePath: resolvedPath,
    deterministicCases: data.deterministicCases.map((item, index) => normalizeSearchQualityCase(item, index)),
    randomTopicPool: unique((data.randomTopicPool || []).map((query) => String(query || '').trim())),
  };
}

export function buildSearchQualityRunPlan({ fixtureSet, apiRuns = 0 } = {}) {
  const deterministicCases = fixtureSet?.deterministicCases || [];
  const targetRuns = Math.max(Number(apiRuns || 0), deterministicCases.length);
  const randomRuns = Math.max(0, targetRuns - deterministicCases.length);
  const randomCases = shuffle(fixtureSet?.randomTopicPool || []).slice(0, randomRuns).map((query, index) =>
    normalizeSearchQualityCase(
      {
        id: `random-${index + 1}`,
        query,
        labels: ['random_topic'],
        expectations: {
          minTotal: 1,
          maxAcceptedRank: 5,
        },
        runLiveSample: false,
        caseKind: 'random',
      },
      index,
    ),
  );
  return [...deterministicCases, ...randomCases];
}

export function buildSearchQualityUrl(baseUrl, testCase, overrides = {}) {
  const params = new URLSearchParams();
  const filters = {
    ...DEFAULT_QUALITY_FILTERS,
    ...(testCase?.filters || {}),
    ...(overrides || {}),
  };
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  params.set('q', testCase?.query || '');
  return `${baseUrl}/api/search?${params.toString()}`;
}

function normalizeResultCandidate(candidate = {}) {
  return {
    id: candidate.id || candidate.canonicalId || '',
    canonicalId: candidate.canonicalId || candidate.id || '',
    title: candidate.title || '',
    englishTitle: candidate.englishTitle || '',
    summary: candidate.summary || candidate.abstract || '',
    keywords: Array.isArray(candidate.keywords) ? candidate.keywords.map((item) => String(item)) : [],
    highlights: Array.isArray(candidate.highlights) ? candidate.highlights.map((item) => String(item)) : [],
    source: normalizeSourceValue(candidate.source || ''),
    type: normalizeLooseText(candidate.type || candidate.sourceType || ''),
    region: normalizeLooseText(candidate.region || ''),
    score: Number(candidate.score || 0),
  };
}

function extractResultCandidates(payload = {}) {
  const items = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.items) ? payload.items : [];
  return items.map((candidate) => normalizeResultCandidate(candidate));
}

function includesAllFragments(text, fragments = []) {
  const normalizedText = normalizeLooseText(text);
  return fragments.every((fragment) => normalizedText.includes(normalizeLooseText(fragment)));
}

function candidateMatchesExpectations(candidate, expectations = {}) {
  if (!candidate) return false;
  if (expectations.source && candidate.source !== normalizeSourceValue(expectations.source)) return false;
  if (expectations.type && candidate.type !== normalizeLooseText(expectations.type)) return false;
  if (expectations.region && candidate.region !== normalizeLooseText(expectations.region)) return false;

  const titleText = [candidate.title, candidate.englishTitle].filter(Boolean).join(' ');
  if (Array.isArray(expectations.titleIncludes) && expectations.titleIncludes.length && !includesAllFragments(titleText, expectations.titleIncludes)) {
    return false;
  }

  const evidenceText = [candidate.title, candidate.englishTitle, candidate.summary, ...candidate.keywords, ...candidate.highlights]
    .filter(Boolean)
    .join(' ');
  if (Array.isArray(expectations.textIncludes) && expectations.textIncludes.length && !includesAllFragments(evidenceText, expectations.textIncludes)) {
    return false;
  }

  return true;
}

function hasStructuredExpectations(expectations = {}) {
  return Boolean(
    expectations.source
      || expectations.type
      || expectations.region
      || (Array.isArray(expectations.titleIncludes) && expectations.titleIncludes.length)
      || (Array.isArray(expectations.textIncludes) && expectations.textIncludes.length),
  );
}

export function evaluateSearchQualityCase(testCase = {}, payload = {}) {
  const results = extractResultCandidates(payload);
  const total = Number(payload?.total ?? results.length ?? 0);
  const top = results[0] || null;
  const expectations = testCase.expectations || {};
  const minTotal = Math.max(0, Number(expectations.minTotal || 0));
  const maxAcceptedRank = Math.max(1, Number(expectations.maxAcceptedRank || 1));

  if (!top || total < Math.max(1, minTotal)) {
    return {
      caseId: testCase.id || '',
      caseKind: testCase.caseKind || 'deterministic',
      labels: testCase.labels || [],
      query: testCase.query || '',
      total,
      verdict: 'no_result',
      reason: total === 0 ? 'empty-result-set' : 'below-min-total',
      matchedExpectationRank: null,
      matchedTitle: '',
      matchedSource: '',
      topTitle: top?.title || top?.englishTitle || '',
      topSource: top?.source || '',
      topType: top?.type || '',
      overlap: [],
    };
  }

  const topEvidence = [top.title, top.englishTitle, top.summary, ...top.keywords, ...top.highlights].filter(Boolean).join(' ');
  const overlap = tokenize(testCase.query || '').filter((token) => normalizeLooseText(topEvidence).includes(token));
  const clean = !hasBrokenEncoding(topEvidence) && !looksLikeNoise(topEvidence);

  let matchedExpectationRank = null;
  let matchedCandidate = null;
  if (hasStructuredExpectations(expectations)) {
    matchedExpectationRank = results.findIndex((candidate) => candidateMatchesExpectations(candidate, expectations));
    if (matchedExpectationRank >= 0) {
      matchedExpectationRank += 1;
      matchedCandidate = results[matchedExpectationRank - 1];
    } else {
      matchedExpectationRank = null;
    }
  }

  let verdict = 'suspect';
  let reason = 'no-query-match';
  if (hasStructuredExpectations(expectations)) {
    if (matchedExpectationRank && matchedExpectationRank <= maxAcceptedRank) {
      verdict = 'relevant';
      reason = matchedExpectationRank === 1 ? 'expectation-match' : `expectation-match-rank-${matchedExpectationRank}`;
    } else if (matchedExpectationRank) {
      verdict = 'suspect';
      reason = `expectation-match-rank-${matchedExpectationRank}`;
    } else {
      verdict = 'suspect';
      reason = 'expectation-miss';
    }
  } else {
    const matches = matchesQueryText(topEvidence, testCase.query || '');
    verdict = clean && matches ? 'relevant' : 'suspect';
    reason = clean ? (matches ? 'query-match' : 'no-query-match') : 'broken-or-noisy';
  }

  return {
    caseId: testCase.id || '',
    caseKind: testCase.caseKind || 'deterministic',
    labels: testCase.labels || [],
    query: testCase.query || '',
    total,
    verdict,
    reason,
    matchedExpectationRank,
    matchedTitle: matchedCandidate?.title || matchedCandidate?.englishTitle || '',
    matchedSource: matchedCandidate?.source || '',
    matchedType: matchedCandidate?.type || '',
    topTitle: top.title || top.englishTitle || '',
    topSource: top.source || '',
    topType: top.type || '',
    overlap,
  };
}

export function summarizeSearchQualityResults(results = []) {
  const summary = {
    total: results.length,
    relevant: 0,
    suspect: 0,
    noResult: 0,
    deterministicRuns: 0,
    randomRuns: 0,
    byLabel: {},
  };

  for (const result of results) {
    if (result.verdict === 'relevant') summary.relevant += 1;
    if (result.verdict === 'suspect') summary.suspect += 1;
    if (result.verdict === 'no_result') summary.noResult += 1;
    if (result.caseKind === 'random') summary.randomRuns += 1;
    else summary.deterministicRuns += 1;

    for (const label of result.labels || ['unlabeled']) {
      if (!summary.byLabel[label]) {
        summary.byLabel[label] = {
          total: 0,
          relevant: 0,
          suspect: 0,
          noResult: 0,
        };
      }
      summary.byLabel[label].total += 1;
      if (result.verdict === 'relevant') summary.byLabel[label].relevant += 1;
      if (result.verdict === 'suspect') summary.byLabel[label].suspect += 1;
      if (result.verdict === 'no_result') summary.byLabel[label].noResult += 1;
    }
  }

  return summary;
}

export function renderSearchQualityMarkdown(report = {}) {
  const labelLines = Object.entries(report.summary?.byLabel || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, counts]) => `- ${label}: ${counts.relevant}/${counts.total} relevant · ${counts.suspect} suspect · ${counts.noResult} no-result`)
    .join('\n');

  const deterministicMisses = (report.apiResults || [])
    .filter((item) => item.caseKind !== 'random' && item.verdict !== 'relevant')
    .map((item) => `- ${item.caseId} (${item.query}) -> ${item.reason} | top=${item.topTitle || 'none'} | matched=${item.matchedTitle || 'none'}`)
    .join('\n');

  const browserFailures = (report.browserFailures || [])
    .map((item) => `- ${item.caseId} (${item.query}) -> hasResults=${item.hasResults} hasError=${item.hasError}${item.error ? ` error=${item.error}` : ''}`)
    .join('\n');

  return `# Search Quality Verification Report\n\n- Fixture: ${report.fixturePath || 'n/a'}\n- API runs: ${report.summary?.total || 0} (${report.summary?.deterministicRuns || 0} deterministic + ${report.summary?.randomRuns || 0} random)\n- Relevant: ${report.summary?.relevant || 0}\n- Suspect: ${report.summary?.suspect || 0}\n- No result: ${report.summary?.noResult || 0}\n- Live sample runs: ${report.liveSampleRuns || 0}\n- Browser runs: ${report.browserRuns || 0}\n- Browser OK: ${report.browserOk || 0}\n\n## Coverage by label\n${labelLines || '- none'}\n\n## Deterministic misses\n${deterministicMisses || '- none'}\n\n## Browser failures\n${browserFailures || '- none'}\n\n## Improvement ideas\n${(report.improvementIdeas || []).map((item) => `- ${item}`).join('\n') || '- none'}\n`;
}
