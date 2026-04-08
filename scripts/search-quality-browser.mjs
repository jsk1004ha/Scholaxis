import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createServer } from '../src/server.mjs';
import {
  buildSearchQualityRunPlan,
  buildSearchQualityUrl,
  evaluateSearchQualityCase,
  loadSearchQualityFixtureSet,
  renderSearchQualityMarkdown,
  summarizeSearchQualityResults,
} from './search-quality-harness.mjs';

const execFileAsync = promisify(execFile);
const REPORT_DIR = path.resolve('.omx/reports');
const API_RUNS = Number(process.env.SCHOLAXIS_QUALITY_API_RUNS || 120);
const BROWSER_RUNS = Number(process.env.SCHOLAXIS_QUALITY_BROWSER_RUNS || 24);
const LIVE_SAMPLE_RUNS = Number(process.env.SCHOLAXIS_QUALITY_LIVE_SAMPLE_RUNS || 0);
const CHROME_PATHS = [
  process.env.CHROME_BIN,
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function pickChrome() {
  return CHROME_PATHS.find((candidate) => existsSync(candidate));
}

async function runBrowserCheck(chromePath, url) {
  const command = [
    'timeout 15s',
    `'${chromePath.replaceAll("'", "'\\''")}'`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--virtual-time-budget=4000',
    '--dump-dom',
    `'${url.replaceAll("'", "'\\''")}'`,
    '2>/dev/null',
  ].join(' ');
  try {
    const { stdout } = await execFileAsync('/bin/bash', ['-lc', command], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const dom = stdout.toString();
    return {
      hasResults: dom.includes('result-card') || dom.includes('개 결과'),
      hasError: dom.includes('검색 오류'),
      domLength: dom.length,
    };
  } catch (error) {
    return {
      hasResults: false,
      hasError: true,
      domLength: 0,
      error: error.message,
    };
  }
}

async function fetchSearchCase(baseUrl, testCase, overrides = {}) {
  const response = await fetch(buildSearchQualityUrl(baseUrl, testCase, overrides));
  const payload = await response.json();
  const verdict = evaluateSearchQualityCase(testCase, payload);
  return {
    ...verdict,
    summary: payload.summary || '',
    status: response.status,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  const fixtureSet = await loadSearchQualityFixtureSet();
  const plan = buildSearchQualityRunPlan({ fixtureSet, apiRuns: API_RUNS });
  const browserCases = plan.filter((item) => item.caseKind !== 'random').slice(0, Math.min(BROWSER_RUNS, plan.length));
  const liveSampleCases = plan.filter((item) => item.runLiveSample !== false).slice(0, Math.min(LIVE_SAMPLE_RUNS, plan.length));

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const apiResults = [];
  for (const [index, testCase] of plan.entries()) {
    apiResults.push(await fetchSearchCase(baseUrl, testCase));
    if ((index + 1) % 20 === 0 || index + 1 === plan.length) {
      console.error(`API progress ${index + 1}/${plan.length}`);
    }
  }

  const liveResults = [];
  for (const testCase of liveSampleCases) {
    liveResults.push(await fetchSearchCase(baseUrl, testCase, { live: 1 }));
  }

  const chromePath = BROWSER_RUNS > 0 ? pickChrome() : null;
  const browserResults = [];
  if (BROWSER_RUNS > 0 && !chromePath) {
    throw new Error('No Chrome/Edge binary found for browser testing. Set CHROME_BIN to override.');
  }
  if (chromePath) {
    for (const [index, testCase] of browserCases.entries()) {
      const browser = await runBrowserCheck(
        chromePath,
        `${baseUrl}/results.html?${new URLSearchParams({
          q: testCase.query,
          region: String(testCase.filters.region || 'all'),
          sourceType: String(testCase.filters.sourceType || 'all'),
          sort: String(testCase.filters.sort || 'relevance'),
          autoLive: String(testCase.filters.autoLive ?? 0),
        }).toString()}`,
      );
      browserResults.push({
        caseId: testCase.id,
        caseKind: testCase.caseKind,
        labels: testCase.labels,
        query: testCase.query,
        ...browser,
      });
      console.error(`Browser progress ${index + 1}/${browserCases.length}`);
    }
  }

  const summary = summarizeSearchQualityResults(apiResults);
  const report = {
    timestamp: new Date().toISOString(),
    fixturePath: fixtureSet.fixturePath,
    baseUrl,
    chromePath,
    summary,
    liveSampleRuns: liveResults.length,
    browserRuns: browserResults.length,
    browserOk: browserResults.filter((item) => item.hasResults && !item.hasError).length,
    browserFailures: browserResults.filter((item) => !item.hasResults || item.hasError),
    apiResults,
    liveResults,
    browserResults,
    improvementIdeas: [
      'Deterministic fixtures should gate ranking changes before broad random-topic review.',
      'Search regressions that miss source/type expectations should be investigated before UI-only tuning.',
      'Keep browser runs deterministic-first so empty/error states are caught before exploratory random sampling.',
    ],
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `search-quality-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `search-quality-${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, renderSearchQualityMarkdown(report), 'utf8');

  server.close();
  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    fixturePath: fixtureSet.fixturePath,
    relevant: summary.relevant,
    suspect: summary.suspect,
    noResult: summary.noResult,
    browserOk: report.browserOk,
  }, null, 2));
}

await main();
