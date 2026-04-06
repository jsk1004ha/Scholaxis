import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createServer } from '../src/server.mjs';
import { hasBrokenEncoding, looksLikeNoise, matchesQueryText } from '../src/source-helpers.mjs';
import { normalizeText, tokenize } from '../src/vector-service.mjs';

const execFileAsync = promisify(execFile);
const REPORT_DIR = path.resolve('.omx/reports');
const SAMPLE_DIR = path.join(REPORT_DIR, 'browser-search-samples');
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

const TOPICS = [
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
  return CHROME_PATHS.find((candidate) => {
    try {
      return candidate && candidate.length > 0;
    } catch {
      return false;
    }
  });
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function relevanceVerdict(query, payload) {
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
    ...(top.highlights || []),
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
    top,
  };
}

async function runBrowserCheck(chromePath, url, screenshotPath) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--virtual-time-budget=4000',
    `--screenshot=${screenshotPath}`,
    '--window-size=1440,1200',
    '--dump-dom',
    url,
  ];
  const { stdout } = await execFileAsync(chromePath, args, { maxBuffer: 8 * 1024 * 1024 });
  const dom = stdout.toString();
  return {
    hasResults: dom.includes('result-card') || dom.includes('개 결과'),
    hasError: dom.includes('검색 오류'),
    domLength: dom.length,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(SAMPLE_DIR, { recursive: true });

  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const chromePath = pickChrome();
  if (!chromePath) throw new Error('No Chrome/Edge binary found for browser testing.');

  const topics = shuffle(TOPICS).slice(0, API_RUNS);
  const apiResults = [];

  for (const query of topics) {
    const response = await fetch(
      `${baseUrl}/api/search?q=${encodeURIComponent(query)}&region=all&sourceType=all&sort=relevance&autoLive=0`
    );
    const payload = await response.json();
    const quality = relevanceVerdict(query, payload);
    apiResults.push({
      query,
      total: payload.total,
      summary: payload.summary,
      verdict: quality.verdict,
      reason: quality.reason,
      overlap: quality.overlap || [],
      topTitle: quality.top?.title || '',
      topSource: quality.top?.source || '',
    });
  }

  const liveTopics = topics.slice(0, Math.min(LIVE_SAMPLE_RUNS, topics.length));
  const liveResults = [];
  for (const query of liveTopics) {
    const response = await fetch(
      `${baseUrl}/api/search?q=${encodeURIComponent(query)}&region=all&sourceType=all&sort=relevance&live=1`
    );
    const payload = await response.json();
    const quality = relevanceVerdict(query, payload);
    liveResults.push({
      query,
      total: payload.total,
      verdict: quality.verdict,
      reason: quality.reason,
      topTitle: quality.top?.title || '',
      topSource: quality.top?.source || '',
    });
  }

  const browserTopics = topics.slice(0, Math.min(BROWSER_RUNS, topics.length));
  const browserResults = [];
  for (let index = 0; index < browserTopics.length; index += 1) {
    const query = browserTopics[index];
    const url = `${baseUrl}/results.html?q=${encodeURIComponent(query)}&region=all&sourceType=all&sort=relevance&autoLive=0`;
    const screenshotPath = path.join(SAMPLE_DIR, `search-${String(index + 1).padStart(3, '0')}.png`);
    const browser = await runBrowserCheck(chromePath, url, screenshotPath);
    browserResults.push({ query, screenshotPath, ...browser });
  }

  const relevant = apiResults.filter((item) => item.verdict === 'relevant').length;
  const suspect = apiResults.filter((item) => item.verdict === 'suspect').length;
  const noResult = apiResults.filter((item) => item.verdict === 'no_result').length;
  const browserOk = browserResults.filter((item) => item.hasResults && !item.hasError).length;

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    chromePath,
    apiRuns: apiResults.length,
    liveSampleRuns: liveResults.length,
    browserRuns: browserResults.length,
    relevant,
    suspect,
    noResult,
    liveRelevant: liveResults.filter((item) => item.verdict === 'relevant').length,
    liveSuspect: liveResults.filter((item) => item.verdict === 'suspect').length,
    liveNoResult: liveResults.filter((item) => item.verdict === 'no_result').length,
    browserOk,
    browserFailures: browserResults.filter((item) => !item.hasResults || item.hasError),
    suspectExamples: apiResults.filter((item) => item.verdict === 'suspect').slice(0, 20),
    noResultExamples: apiResults.filter((item) => item.verdict === 'no_result').slice(0, 20),
    apiResults,
    liveResults,
    browserResults,
    improvementIdeas: [
      'live-source 결과를 source별 confidence score로 재정렬하고 noise source별 패널티를 추가한다.',
      '0건 질의에는 query reformulation(띄어쓰기/영문 번역/동의어) 제안을 UI에 노출한다.',
      '브라우저 결과 페이지에서 source 상태/오류를 더 직접적으로 보여주고 silent fallback을 금지한다.'
    ]
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `search-quality-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `search-quality-${stamp}.md`);

  const md = `# Search Quality Browser Audit\n
- API runs: ${report.apiRuns}
- Live sample runs: ${report.liveSampleRuns}
- Browser runs: ${report.browserRuns}
- Relevant: ${report.relevant}
- Suspect: ${report.suspect}
- No result: ${report.noResult}
- Live relevant: ${report.liveRelevant}
- Live suspect: ${report.liveSuspect}
- Live no result: ${report.liveNoResult}
- Browser OK: ${report.browserOk}

## Improvement ideas
${report.improvementIdeas.map((item) => `- ${item}`).join('\n')}

## Suspect examples
${report.suspectExamples.map((item) => `- ${item.query} -> ${item.topTitle} (${item.reason})`).join('\n') || '- none'}

## No-result examples
${report.noResultExamples.map((item) => `- ${item.query}`).join('\n') || '- none'}
`;

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, md, 'utf8');

  server.close();
  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    relevant,
    suspect,
    noResult,
    browserOk
  }, null, 2));
}

await main();
