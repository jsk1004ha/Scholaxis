import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';
import { hasBrokenEncoding, looksLikeNoise, matchesQueryText } from '../src/source-helpers.mjs';
import { normalizeText, tokenize } from '../src/vector-service.mjs';
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
const FIXED_LIMIT = Number(process.env.SCHOLAXIS_QUALITY_FIXED_LIMIT || 0);
const CHROME_PATHS = [
  process.env.CHROME_BIN,
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export const FIXED_SCENARIOS = [
  {
    id: 'ko-exact-title-battery',
    label: 'Korean exact-title battery paper',
    intent: 'exact-title',
    language: 'ko',
    query: '차세대 배터리 열폭주 예측을 위한 멀티모달 AI 진단 프레임워크',
    expected: {
      canonicalId: 'seed-paper-ko-energy-ai',
      source: 'kci',
      type: 'paper',
      topK: 1,
      titleIncludes: ['차세대 배터리 열폭주 예측']
    },
    grounding: 'seed'
  },
  {
    id: 'en-exact-title-quantum',
    label: 'English exact-title graph paper',
    intent: 'exact-title',
    language: 'en',
    query: 'Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval',
    expected: {
      canonicalId: 'seed-paper-global-quantum',
      source: 'arxiv',
      type: 'paper',
      topK: 1,
      titleIncludes: ['Quantum Neural Architectures for Multimodal Scholarly Graph Retrieval']
    },
    grounding: 'seed'
  },
  {
    id: 'mixed-exact-title-battery',
    label: 'Mixed-language exact-title-ish battery query',
    intent: 'exact-title',
    language: 'mixed',
    query: '차세대 배터리 열폭주 prediction multimodal AI diagnostics',
    expected: {
      canonicalId: 'seed-paper-ko-energy-ai',
      source: 'kci',
      type: 'paper',
      topK: 3,
      titleIncludes: ['차세대 배터리 열폭주 예측', 'Multimodal AI Diagnostics']
    },
    grounding: 'seed'
  },
  {
    id: 'ko-broad-battery-safety',
    label: 'Korean broad battery safety discovery',
    intent: 'broad',
    language: 'ko',
    query: '배터리 안전성',
    expected: {
      canonicalId: 'seed-paper-ko-energy-ai',
      source: 'kci',
      type: 'paper',
      topK: 3,
      titleIncludes: ['배터리']
    },
    grounding: 'seed',
    allowLive: true
  },
  {
    id: 'en-broad-climate-policy',
    label: 'English broad climate policy research',
    intent: 'broad',
    language: 'en',
    query: 'climate policy research',
    expected: {
      canonicalId: 'seed-paper-global-climate',
      source: 'semantic_scholar',
      type: 'paper',
      topK: 3,
      titleIncludes: ['Climate Risk Knowledge Distillation']
    },
    grounding: 'seed',
    allowLive: true
  },
  {
    id: 'mixed-broad-battery-policy',
    label: 'Mixed broad battery policy discovery',
    intent: 'broad',
    language: 'mixed',
    query: 'battery 안전성 research',
    expected: {
      canonicalId: 'seed-paper-ko-energy-ai',
      source: 'kci',
      type: 'paper',
      topK: 3,
      titleIncludes: ['배터리', 'Battery']
    },
    grounding: 'seed'
  },
  {
    id: 'ko-narrow-semiconductor',
    label: 'Korean narrow semiconductor defect query',
    intent: 'narrow',
    language: 'ko',
    query: '반도체 결함 분석',
    expected: {
      canonicalId: 'seed-paper-ko-semiconductor',
      source: 'dbpia',
      type: 'paper',
      topK: 3,
      titleIncludes: ['반도체 결함 분석']
    },
    grounding: 'seed'
  },
  {
    id: 'en-narrow-graph-retrieval',
    label: 'English narrow graph retrieval query',
    intent: 'narrow',
    language: 'en',
    query: 'scholarly graph retrieval multimodal',
    expected: {
      canonicalId: 'seed-paper-global-quantum',
      source: 'arxiv',
      type: 'paper',
      topK: 3,
      titleIncludes: ['Scholarly Graph Retrieval']
    },
    grounding: 'seed'
  },
  {
    id: 'mixed-narrow-thermal-runaway',
    label: 'Mixed narrow thermal runaway query',
    intent: 'narrow',
    language: 'mixed',
    query: '배터리 thermal runaway multimodal',
    expected: {
      canonicalId: 'seed-paper-ko-energy-ai',
      source: 'kci',
      type: 'paper',
      topK: 3,
      titleIncludes: ['배터리', 'thermal runaway']
    },
    grounding: 'seed'
  },
  {
    id: 'ko-source-filtered-patent',
    label: 'Korean source-filtered patent query',
    intent: 'source-filtered',
    language: 'ko',
    query: '의료영상 실시간 판독 특허',
    preferredSources: ['kipris'],
    expected: {
      canonicalId: 'seed-patent-ko-edge-medical',
      source: 'kipris',
      type: 'patent',
      topK: 3,
      titleIncludes: ['의료영상']
    },
    grounding: 'seed',
    allowLive: true
  },
  {
    id: 'en-source-filtered-report',
    label: 'English source-filtered report query',
    intent: 'source-filtered',
    language: 'en',
    query: 'biofoundry strategy report',
    preferredSources: ['ntis'],
    expected: {
      canonicalId: 'seed-report-ko-bio',
      source: 'ntis',
      type: 'report',
      topK: 3,
      titleIncludes: ['Biofoundry Strategy', '바이오 파운드리']
    },
    grounding: 'seed',
    allowLive: true
  },
  {
    id: 'mixed-source-filtered-student-fair',
    label: 'Mixed source-filtered student invention fair query',
    intent: 'source-filtered',
    language: 'mixed',
    query: 'portable voltage supply student invention fair',
    preferredSources: ['student_invention_fair'],
    expected: {
      canonicalId: 'seed-fair-student-energy',
      source: 'student_invention_fair',
      type: 'fair_entry',
      topK: 3,
      titleIncludes: ['Portable Voltage Supply', '휴대용 전압 공급장치']
    },
    grounding: 'seed',
    allowLive: true
  },
  {
    id: 'ko-cross-lingual-graph',
    label: 'Korean-to-English graph retrieval',
    intent: 'cross-lingual',
    language: 'ko',
    query: '학술 그래프 검색',
    expected: {
      canonicalId: 'seed-paper-global-quantum',
      source: 'arxiv',
      type: 'paper',
      topK: 5,
      titleIncludes: ['Graph Retrieval', '학술 그래프']
    },
    grounding: 'seed'
  },
  {
    id: 'en-cross-lingual-student-fair',
    label: 'English-to-Korean student fair retrieval',
    intent: 'cross-lingual',
    language: 'en',
    query: 'portable voltage supply',
    expected: {
      canonicalId: 'seed-fair-student-energy',
      source: 'student_invention_fair',
      type: 'fair_entry',
      topK: 5,
      titleIncludes: ['Portable Voltage Supply', '휴대용 전압 공급장치']
    },
    grounding: 'seed'
  }
];

const RANDOM_TOPIC_POOL = [
  '자석진자','자기진자','배터리 열폭주','반도체 결함 분석','양자 암호','디지털 트윈','바이오센서',
  '해양 플라스틱','도시 열섬','수소 저장','탄소 포집','리튬 황 배터리','철도 진동','드론 군집비행',
  '스마트팜','자율주행 라이다','메타물질 안테나','로봇 그리퍼','압전 발전','초전도체','핵융합 플라즈마',
  '단백질 접힘','유전자 편집','암 면역치료','신경망 압축','멀티모달 검색','법률 문서 요약','고대사 연구',
  '중세 섬유 무역','한강 수질','기후 리스크','태양광 예측','풍력 블레이드','폐열 회수','반려동물 행동 분석',
  '스포츠 생체역학','전자현미경','위성 영상 분류','산불 탐지','화산 콘크리트','블루베리 발효','치즈 숙성',
  '커피 향미 분석','고양이 심장질환','고래 소리 분석','우주 쓰레기','달 탐사 로버','행성 자기장',
  '고속철 제동','교량 피로균열','지진 조기경보','하수 처리','미세먼지','대기 에어로졸','수질 모니터링',
  '수면 무호흡','우울증 디지털 치료','재활 로봇','의료영상 세그멘테이션','치과 임플란트','교육 AI',
  '국어 교육','수학 불안','미술 치료','문학 번역','연극 비평','쇼펜하우어 비극관','원숭이 아데노바이러스',
  '세라믹 복합재','나노입자 합성','고분자 점탄성','극저온 냉각','양자센서','해양풍력','우주 날씨',
  '자기부상 열차','고체 전해질','리사이클링 공정','폐배터리 회수','지능형 CCTV','침입 탐지',
  '사이버 위협 인텔리전스','침수 예측','홍수 경보','산사태 위험','국방 무인체계','음성 합성',
  '소음 제거','피아노 연주 분석','한국사 교육','학생 발명 아이디어','에너지 하베스팅','wave energy',
  'hydrogen embrittlement','graph neural network','causal inference','federated learning','speech pathology',
  'marine biodiversity','urban planning','archaeology ceramics','digital humanities','supply chain resilience',
  'biofoundry','KIPRIS 특허','NTIS 과제','RISS 교육연구','KCI 물리학','DBpia 사회학','science fair invention',
  'portable voltage supply','thermal runaway prediction','semiconductor xai','multimodal retrieval','policy forecasting',
  'edge medical imaging','student invention fair','ferroelectric memory','optical lattice','microfluidics'
];

function pickChrome() {
  return CHROME_PATHS.find((candidate) => candidate && existsSync(candidate));
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function detectLanguageBucket(value = '') {
  const hasKorean = /[가-힣]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasKorean && hasLatin) return 'mixed';
  if (hasKorean) return 'ko';
  if (hasLatin) return 'en';
  return 'other';
}

function normalizeScenarioId(id = '') {
  return String(id || '').replace(/^[^:]+:/, '');
}

function normalizeScenarioSource(source = '') {
  return String(source || '').trim().toLowerCase();
}

function extractResultSummary(item = {}) {
  if (!item) return null;
  return {
    id: item.canonicalId || item.id || '',
    title: item.title || '',
    englishTitle: item.englishTitle || '',
    source: item.source || '',
    sourceKey: item.sourceKey || item.source || '',
    type: item.type || '',
    year: item.year || null,
    score: item.score || 0,
    originalUrl: item.links?.original || '',
    detailUrl: item.links?.detail || ''
  };
}

export function relevanceVerdict(query, payload) {
  if (!payload.total) {
    return { verdict: 'no_result', reason: 'empty-result-set' };
  }
  const top = payload.results?.[0] || payload.items?.[0] || null;
  if (!top) {
    return { verdict: 'no_result', reason: 'missing-top-result' };
  }
  const combined = [
    top.title,
    top.englishTitle,
    top.summary,
    ...(top.keywords || []),
    ...(top.highlights || [])
  ]
    .filter(Boolean)
    .join(' ');
  const clean = !hasBrokenEncoding(combined) && !looksLikeNoise(combined);
  const matches = matchesQueryText(combined, query);
  const overlap = tokenize(query).filter((token) => normalizeText(combined).includes(token));
  return {
    verdict: clean && matches ? 'relevant' : 'suspect',
    reason: clean ? (matches ? 'query-match' : 'no-query-match') : 'broken-or-noisy',
    overlap,
    top: extractResultSummary(top),
  };
}

function matchesScenarioExpectation(item = {}, expected = {}) {
  if (!item) return false;
  const itemIds = [item.id, item.canonicalId].filter(Boolean).map(normalizeScenarioId);
  const itemTitleBag = [item.title, item.englishTitle].filter(Boolean).join(' ');
  const itemSource = normalizeScenarioSource(item.sourceKey || item.source);
  const titleIncludes = (expected.titleIncludes || []).filter(Boolean);

  if (expected.canonicalId && !itemIds.includes(normalizeScenarioId(expected.canonicalId))) return false;
  if (expected.source && itemSource !== normalizeScenarioSource(expected.source)) return false;
  if (expected.type && item.type !== expected.type) return false;
  if (titleIncludes.length) {
    const normalizedTitleBag = normalizeText(itemTitleBag);
    const titleMatch = titleIncludes.some((needle) => normalizedTitleBag.includes(normalizeText(needle)));
    if (!titleMatch) return false;
  }
  return true;
}

function buildScenarioReason(scenario, payload, matchedItem, matchIndex) {
  if (!payload.total) return 'no-result';
  if (matchedItem) return `matched-top-${matchIndex + 1}`;
  if (scenario.intent === 'random-topic') {
    const quality = relevanceVerdict(scenario.query, payload);
    return quality.reason;
  }
  return 'expected-result-missing';
}

export function buildScenarioRequest(scenario = {}) {
  return {
    q: scenario.query || '',
    region: scenario.region || 'all',
    sourceType: scenario.sourceType || 'all',
    sort: scenario.sort || 'relevance',
    preferredSources: scenario.preferredSources || [],
    live: Boolean(scenario.live),
    autoLive: Boolean(scenario.autoLive),
  };
}

export function buildSearchUrl(baseUrl, scenario = {}) {
  const request = buildScenarioRequest(scenario);
  const params = new URLSearchParams({
    q: request.q,
    region: request.region,
    sourceType: request.sourceType,
    sort: request.sort,
    live: request.live ? '1' : '0',
    autoLive: request.autoLive ? '1' : '0'
  });
  if (request.preferredSources.length) {
    params.set('preferredSources', request.preferredSources.join(','));
  }
  return `${baseUrl}/api/search?${params.toString()}`;
}

export function buildRandomTopicScenarios(count = API_RUNS) {
  const byLanguage = {
    ko: RANDOM_TOPIC_POOL.filter((topic) => detectLanguageBucket(topic) === 'ko'),
    en: RANDOM_TOPIC_POOL.filter((topic) => detectLanguageBucket(topic) === 'en'),
    mixed: RANDOM_TOPIC_POOL.filter((topic) => detectLanguageBucket(topic) === 'mixed')
  };
  const queues = {
    ko: shuffle(byLanguage.ko),
    en: shuffle(byLanguage.en),
    mixed: shuffle(byLanguage.mixed)
  };
  const order = ['ko', 'en', 'mixed'];
  const scenarios = [];

  while (scenarios.length < count) {
    let progressed = false;
    for (const language of order) {
      const query = queues[language].shift();
      if (!query) continue;
      scenarios.push({
        id: `random-${language}-${scenarios.length + 1}`,
        label: `${language.toUpperCase()} random topic ${scenarios.length + 1}`,
        intent: 'random-topic',
        language,
        query,
        grounding: 'heuristic-random'
      });
      progressed = true;
      if (scenarios.length >= count) break;
    }
    if (!progressed) break;
  }

  return scenarios;
}

export function summarizeScenarioBuckets(results = []) {
  const summary = {};
  for (const result of results) {
    const intent = result.intent || 'unknown';
    const language = result.language || 'unknown';
    summary[intent] ||= {};
    summary[intent][language] ||= { total: 0, pass: 0, fail: 0 };
    summary[intent][language].total += 1;
    summary[intent][language][result.pass ? 'pass' : 'fail'] += 1;
  }
  return summary;
}

export function buildSearchQualityPlan({
  apiRuns = API_RUNS,
  browserRuns = BROWSER_RUNS,
  liveSampleRuns = LIVE_SAMPLE_RUNS,
  fixedLimit = FIXED_LIMIT
} = {}) {
  const fixedScenarios = FIXED_SCENARIOS
    .slice(0, fixedLimit > 0 ? fixedLimit : FIXED_SCENARIOS.length)
    .map((scenario) => ({ ...scenario, autoLive: false, live: false }));
  const randomScenarios = buildRandomTopicScenarios(apiRuns).map((scenario) => ({ ...scenario, autoLive: false, live: false }));
  const liveScenarios = FIXED_SCENARIOS
    .filter((scenario) => scenario.allowLive)
    .slice(0, Math.max(0, liveSampleRuns))
    .map((scenario) => ({ ...scenario, live: true, autoLive: false, grounding: 'live-when-available' }));
  const browserScenarios = [...fixedScenarios, ...randomScenarios].slice(0, Math.max(0, browserRuns));

  return {
    fixedScenarios,
    randomScenarios,
    liveScenarios,
    browserScenarios,
    coverage: summarizeScenarioBuckets([...fixedScenarios, ...randomScenarios])
  };
}

export function evaluateScenarioPayload(scenario = {}, payload = {}) {
  const items = payload.results || payload.items || [];
  if (scenario.intent === 'random-topic') {
    const quality = relevanceVerdict(scenario.query, payload);
    return {
      pass: quality.verdict === 'relevant',
      reason: quality.reason,
      top: quality.top,
      overlap: quality.overlap || [],
    };
  }

  const expected = scenario.expected || {};
  const topK = expected.topK || 3;
  const matchedIndex = items.slice(0, topK).findIndex((item) => matchesScenarioExpectation(item, expected));
  const matchedItem = matchedIndex >= 0 ? items[matchedIndex] : null;

  return {
    pass: matchedIndex >= 0,
    reason: buildScenarioReason(scenario, payload, matchedItem, matchedIndex),
    top: extractResultSummary(matchedItem || items[0]),
    overlap: matchedItem ? tokenize(`${matchedItem.title || ''} ${matchedItem.englishTitle || ''}`) : [],
  };
}

async function runApiScenario(baseUrl, scenario) {
  const url = buildSearchUrl(baseUrl, scenario);
  const response = await fetch(url);
  const payload = await response.json();
  const evaluation = evaluateScenarioPayload(scenario, payload);

  return {
    id: scenario.id,
    label: scenario.label,
    query: scenario.query,
    intent: scenario.intent,
    language: scenario.language || detectLanguageBucket(scenario.query),
    preferredSources: scenario.preferredSources || [],
    live: Boolean(scenario.live),
    grounding: scenario.grounding || 'seed',
    pass: evaluation.pass,
    reason: evaluation.reason,
    total: payload.total || 0,
    fallbackMode: payload.fallbackMode || 'strict',
    top: evaluation.top,
    summary: payload.summary || '',
    overlap: evaluation.overlap || [],
    filters: payload.filters || {},
    sourceStatus: payload.sourceStatus || [],
  };
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
      pass: (dom.includes('result-card') || dom.includes('개 결과')) && !dom.includes('검색 오류'),
      hasResults: dom.includes('result-card') || dom.includes('개 결과'),
      hasError: dom.includes('검색 오류'),
      domLength: dom.length,
    };
  } catch (error) {
    return {
      pass: false,
      hasResults: false,
      hasError: true,
      domLength: 0,
      error: error.message,
    };
  }
}

function buildImprovementIdeas(report) {
  const ideas = [];
  if (report.bucketSummary['source-filtered']) {
    const filtered = Object.values(report.bucketSummary['source-filtered']).reduce((total, item) => total + item.fail, 0);
    if (filtered > 0) ideas.push('preferredSources 가 지정된 검색은 로컬 인덱스에서도 해당 source를 더 강하게 우선해야 합니다.');
  }
  if ((report.randomResults || []).some((item) => !item.pass)) {
    ideas.push('랜덤 토픽 실패 사례는 query reformulation / cross-lingual normalization / source fan-out 순으로 재검토합니다.');
  }
  if ((report.liveResults || []).length && (report.liveResults || []).some((item) => !item.pass)) {
    ideas.push('라이브 샘플 실패는 source 상태와 원문 링크 provenance 를 함께 기록해 회귀 원인을 좁힙니다.');
  }
  if (!(report.browserResults || []).every((item) => item.pass)) {
    ideas.push('브라우저 회귀는 결과/오류/부분실패 상태가 DOM 에 명시적으로 남는지 다시 확인합니다.');
  }
  if (!ideas.length) {
    ideas.push('현재 고정 시나리오와 랜덤 토픽이 모두 통과했습니다. 새 seed/live 시나리오를 주기적으로 추가해 회귀 탐지 폭을 넓히세요.');
  }
  return ideas;
}

export function buildMarkdownReport(report = {}) {
  const lines = [
    '# Search Quality Browser Audit',
    '',
    `- Fixed scenarios: ${report.fixedResults?.length || 0}`,
    `- Random-topic scenarios: ${report.randomResults?.length || 0}`,
    `- Live scenarios: ${report.liveResults?.length || 0}`,
    `- Browser scenarios: ${report.browserResults?.length || 0}`,
    `- Pass: ${report.passCount || 0}`,
    `- Fail: ${report.failCount || 0}`,
    '',
    '## Bucket summary'
  ];

  for (const [intent, languages] of Object.entries(report.bucketSummary || {})) {
    lines.push(`- ${intent}`);
    for (const [language, counts] of Object.entries(languages)) {
      lines.push(`  - ${language}: ${counts.pass}/${counts.total} pass`);
    }
  }

  lines.push('', '## Improvement ideas');
  for (const item of report.improvementIdeas || []) {
    lines.push(`- ${item}`);
  }

  lines.push('', '## Failed checks');
  const failed = [...(report.fixedResults || []), ...(report.randomResults || []), ...(report.liveResults || [])].filter((item) => !item.pass);
  if (!failed.length) {
    lines.push('- none');
  } else {
    for (const item of failed.slice(0, 20)) {
      lines.push(`- [${item.intent}/${item.language}] ${item.query} -> ${item.reason}`);
    }
  }

  lines.push('', '## Browser checks');
  if (!(report.browserResults || []).length) {
    lines.push('- skipped');
  } else {
    for (const item of report.browserResults) {
      lines.push(`- ${item.query} -> ${item.pass ? 'pass' : 'fail'}${item.error ? ` (${item.error})` : ''}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const plan = buildSearchQualityPlan({
    apiRuns: API_RUNS,
    browserRuns: BROWSER_RUNS,
    liveSampleRuns: LIVE_SAMPLE_RUNS,
  });

  const fixedResults = [];
  for (const scenario of plan.fixedScenarios) {
    fixedResults.push(await runApiScenario(baseUrl, scenario));
  }

  const randomResults = [];
  for (const scenario of plan.randomScenarios) {
    randomResults.push(await runApiScenario(baseUrl, scenario));
  }

  const liveResults = [];
  for (const scenario of plan.liveScenarios) {
    liveResults.push(await runApiScenario(baseUrl, scenario));
  }

  const chromePath = pickChrome();
  const browserResults = [];
  for (const scenario of plan.browserScenarios) {
    if (!chromePath) {
      browserResults.push({
        query: scenario.query,
        intent: scenario.intent,
        language: scenario.language,
        pass: false,
        skipped: true,
        error: 'No Chrome/Edge binary found for browser testing.'
      });
      continue;
    }
    const browser = await runBrowserCheck(chromePath, buildSearchUrl(baseUrl, scenario).replace('/api/search?', '/results.html?'));
    browserResults.push({
      query: scenario.query,
      intent: scenario.intent,
      language: scenario.language,
      ...browser,
    });
  }

  const scenarioResults = [...fixedResults, ...randomResults, ...liveResults];
  const passCount = scenarioResults.filter((item) => item.pass).length;
  const failCount = scenarioResults.length - passCount;
  const bucketSummary = summarizeScenarioBuckets([...fixedResults, ...randomResults]);

  const report = {
    timestamp: new Date().toISOString(),
    fixturePath: fixtureSet.fixturePath,
    baseUrl,
    chromePath: chromePath || '',
    fixedResults,
    randomResults,
    liveResults,
    browserResults,
    passCount,
    failCount,
    bucketSummary,
  };
  report.improvementIdeas = buildImprovementIdeas(report);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `search-quality-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `search-quality-${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, buildMarkdownReport(report), 'utf8');

  server.close();
  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    fixedScenarios: fixedResults.length,
    randomScenarios: randomResults.length,
    liveScenarios: liveResults.length,
    browserScenarios: browserResults.length,
    passCount,
    failCount
  }, null, 2));
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
