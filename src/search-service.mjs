import { catalog, trendingTopics } from './catalog.mjs';

const regionLabel = {
  all: '전체',
  domestic: '국내',
  global: '해외'
};

const sourceTypeLabel = {
  all: '전체',
  paper: '논문',
  patent: '특허',
  report: '보고서'
};

const sourceStatuses = [
  {
    source: 'KCI',
    status: 'online',
    latency: 'fast',
    coverage: '국내 논문',
    note: '한국어 초록/키워드 우선'
  },
  {
    source: 'DBpia',
    status: 'online',
    latency: 'moderate',
    coverage: '국내 논문',
    note: '유료 원문 링크 연동 가능'
  },
  {
    source: 'KIPRIS',
    status: 'online',
    latency: 'moderate',
    coverage: '국내 특허',
    note: '특허·실용신안 메타데이터'
  },
  {
    source: '정부출연연 보고서',
    status: 'online',
    latency: 'fast',
    coverage: '국내 보고서',
    note: '정책·전략 자료'
  },
  {
    source: 'arXiv',
    status: 'online',
    latency: 'fast',
    coverage: '글로벌 오픈액세스 논문',
    note: '최신 선행연구 탐색'
  },
  {
    source: 'Semantic Scholar',
    status: 'degraded',
    latency: 'moderate',
    coverage: '글로벌 논문',
    note: '인용·추천 확장용 mock adapter'
  },
  {
    source: 'OECD',
    status: 'online',
    latency: 'fast',
    coverage: '글로벌 보고서',
    note: '정책/거버넌스 자료'
  }
];

function tokenize(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function unique(values) {
  return [...new Set(values)];
}

function scoreItem(item, queryTokens) {
  if (!queryTokens.length) {
    return item.citations / 10;
  }

  const haystack = [
    item.title,
    item.englishTitle,
    item.abstract,
    item.summary,
    item.novelty,
    item.organization,
    ...item.keywords,
    ...item.methods,
    ...item.highlights
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (item.title.toLowerCase().includes(token)) score += 12;
    if (item.englishTitle.toLowerCase().includes(token)) score += 6;
    if (item.abstract.toLowerCase().includes(token)) score += 5;
    if (item.summary.toLowerCase().includes(token)) score += 4;
    if (item.keywords.some((keyword) => keyword.toLowerCase().includes(token))) score += 7;
    if (item.methods.some((method) => method.toLowerCase().includes(token))) score += 4;
    if (haystack.includes(token)) score += 2;
  }

  score += item.openAccess ? 3 : 0;
  score += item.region === 'domestic' ? 2 : 0;
  score += Math.min(item.citations / 30, 8);
  score += item.year >= 2024 ? 4 : 0;
  return score;
}

function rank(items, sort) {
  const list = [...items];
  switch (sort) {
    case 'latest':
      return list.sort((a, b) => b.year - a.year || b.score - a.score);
    case 'citation':
      return list.sort((a, b) => b.citations - a.citations || b.score - a.score);
    default:
      return list.sort((a, b) => b.score - a.score || b.year - a.year);
  }
}

function summarizeFilters({ region, sourceType, sort }) {
  return `${regionLabel[region] || '전체'} · ${sourceTypeLabel[sourceType] || '전체'} · ${sort === 'latest' ? '최신순' : sort === 'citation' ? '인용순' : '관련도순'}`;
}

export function listTrends() {
  return trendingTopics;
}

export function getSearchSuggestions(query = '') {
  const tokens = unique(tokenize(query));
  const pool = unique([
    ...trendingTopics,
    ...catalog.map((item) => item.title),
    ...catalog.flatMap((item) => item.keywords)
  ]);

  const suggestions = pool
    .filter((entry) => (tokens.length ? tokens.some((token) => entry.toLowerCase().includes(token)) : true))
    .slice(0, 8);

  return {
    query,
    suggestions,
    fallback: trendingTopics.slice(0, 6)
  };
}

export function listSourceStatuses() {
  return sourceStatuses.map((item) => ({ ...item }));
}

export function searchCatalog({
  q = '',
  region = 'all',
  sourceType = 'all',
  sort = 'relevance'
} = {}) {
  const queryTokens = unique(tokenize(q));

  const filtered = catalog
    .filter((item) => (region === 'all' ? true : item.region === region))
    .filter((item) => (sourceType === 'all' ? true : item.type === sourceType))
    .map((item) => ({ ...item, score: scoreItem(item, queryTokens) }));

  const ranked = rank(filtered, sort);

  const summary = q
    ? `“${q}”에 대해 ${ranked.length}건의 ${sourceTypeLabel[sourceType] || '자료'}를 찾았습니다. ${summarizeFilters({ region, sourceType, sort })} 기준 결과입니다.`
    : `탐색 가능한 ${ranked.length}건의 자료를 불러왔습니다. ${summarizeFilters({ region, sourceType, sort })} 기준입니다.`;

  return {
    query: q,
    filters: { region, sourceType, sort },
    summary,
    total: ranked.length,
    relatedQueries: getSearchSuggestions(q).suggestions.slice(0, 4),
    sourceStatus: listSourceStatuses(),
    items: ranked.map((item, index) => ({
      id: item.id,
      rank: index + 1,
      score: Number(item.score.toFixed(1)),
      type: item.type,
      region: item.region,
      year: item.year,
      title: item.title,
      englishTitle: item.englishTitle,
      authors: item.authors,
      organization: item.organization,
      source: item.source,
      citations: item.citations,
      openAccess: item.openAccess,
      summary: item.summary,
      keywords: item.keywords,
      highlights: item.highlights
    })),
    results: ranked.map((item, index) => ({
      id: item.id,
      rank: index + 1,
      score: Number(item.score.toFixed(1)),
      type: item.type,
      region: item.region,
      year: item.year,
      title: item.title,
      englishTitle: item.englishTitle,
      authors: item.authors,
      organization: item.organization,
      source: item.source,
      citations: item.citations,
      openAccess: item.openAccess,
      summary: item.summary,
      keywords: item.keywords,
      highlights: item.highlights
    }))
  };
}

export function getPaperById(id) {
  const paper = catalog.find((item) => item.id === id);
  if (!paper) return null;

  const related = searchCatalog({ q: paper.keywords.slice(0, 3).join(' '), sort: 'relevance' }).results
    .filter((item) => item.id !== id)
    .slice(0, 3);

  return {
    ...paper,
    related,
    metrics: {
      citations: paper.citations,
      references: 18 + paper.keywords.length * 3,
      insightScore: Math.min(97, 70 + paper.keywords.length * 3),
      freshness: paper.year >= 2024 ? '최신 연구' : '안정화 연구'
    }
  };
}

export function expandPaperById(id) {
  const paper = getPaperById(id);
  if (!paper) return null;

  return {
    paper,
    expansion: {
      suggestedQueries: unique([
        ...paper.keywords.slice(0, 3),
        `${paper.keywords[0]} 선행연구`,
        `${paper.organization} 연구 동향`
      ]).slice(0, 5),
      citationPreview: paper.related.map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        year: item.year
      })),
      sourceStatus: sourceStatuses.filter((item) => [paper.source, ...paper.related.map((entry) => entry.source)].includes(item.source))
    }
  };
}
