import { dedupeDocuments } from './dedup-service.mjs';
import { seedCatalog } from './catalog.mjs';
import { appConfig } from './config.mjs';
import {
  attachVectors,
  buildDenseVector,
  buildSparseVector,
  cosineSimilarity,
  normalizeText,
  sparseOverlapScore,
  tokenize,
  unique
} from './vector-service.mjs';

const indexedCatalog = dedupeDocuments(seedCatalog).map((document) => attachVectors(document, appConfig.vectorDimensions));

const SECTION_PATTERNS = [
  { key: 'abstract', label: '초록', patterns: [/^abstract$/i, /^초록$/, /^요약$/] },
  { key: 'introduction', label: '서론', patterns: [/^introduction$/i, /^서론$/, /^문제 정의$/] },
  { key: 'method', label: '방법', patterns: [/^method/i, /^approach$/i, /^방법$/, /^방법론$/, /^모형$/, /^모델$/] },
  { key: 'experiment', label: '실험', patterns: [/^experiment/i, /^evaluation$/i, /^results?$/i, /^실험$/, /^평가$/, /^결과$/] },
  { key: 'discussion', label: '논의', patterns: [/^discussion$/i, /^한계$/, /^논의$/] },
  { key: 'conclusion', label: '결론', patterns: [/^conclusion$/i, /^결론$/, /^향후 과제$/, /^future work$/i] }
];

function itemTokenSet(item) {
  return unique(
    tokenize([item.title, item.englishTitle, item.abstract, item.summary, ...(item.keywords || []), ...(item.methods || [])].join(' '))
  );
}

function deriveNovelty(textTokens, strongestMatchTokens) {
  return textTokens.filter((token) => !strongestMatchTokens.includes(token)).slice(0, 8);
}

function canonicalSectionName(rawTitle = '') {
  const normalized = normalizeText(rawTitle);
  for (const descriptor of SECTION_PATTERNS) {
    if (descriptor.patterns.some((pattern) => pattern.test(normalized))) return descriptor;
  }
  return {
    key: normalized || `section-${Math.random().toString(36).slice(2, 6)}`,
    label: rawTitle.trim() || '본문 섹션'
  };
}

function splitIntoSections(text = '') {
  const lines = String(text).split(/\r?\n/);
  const sections = [];
  let current = null;

  function pushCurrent() {
    if (!current) return;
    const content = current.content.join(' ').replace(/\s+/g, ' ').trim();
    if (!content) return;
    sections.push({
      key: current.key,
      label: current.label,
      content,
      tokens: unique(tokenize(content))
    });
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingLike =
      trimmed.length <= 60 &&
      (/^(\d+(\.\d+)*)[\.\)]?\s+/.test(trimmed) ||
        /^[가-힣A-Za-z ]{2,40}:?$/.test(trimmed));

    if (headingLike) {
      const stripped = trimmed
        .replace(/^(\d+(\.\d+)*)[\.\)]?\s+/, '')
        .replace(/:$/, '');
      const descriptor = canonicalSectionName(stripped);
      pushCurrent();
      current = { key: descriptor.key, label: descriptor.label, content: [] };
      continue;
    }

    if (!current) {
      current = { key: 'body', label: '본문', content: [] };
    }
    current.content.push(trimmed);
  }

  pushCurrent();

  if (sections.length > 1) return sections;

  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  if (paragraphs.length === 1) {
    const tokens = unique(tokenize(paragraphs[0]));
    const chunkSize = Math.max(1, Math.ceil(tokens.length / 3));
    const labels = ['문제/배경', '방법/접근', '결과/의의'];
    return labels.map((label, index) => {
      const chunk = tokens.slice(index * chunkSize, (index + 1) * chunkSize).join(' ');
      return {
        key: `inferred-${index + 1}`,
        label,
        content: chunk || paragraphs[0],
        tokens: unique(tokenize(chunk || paragraphs[0]))
      };
    });
  }

  return paragraphs.slice(0, 6).map((paragraph, index) => ({
    key: `paragraph-${index + 1}`,
    label: `문단 ${index + 1}`,
    content: paragraph,
    tokens: unique(tokenize(paragraph))
  }));
}

function buildCatalogSections(item) {
  return [
    item.abstract
      ? {
          key: 'abstract',
          label: '초록',
          content: item.abstract,
          tokens: unique(tokenize(item.abstract))
        }
      : null,
    (item.methods || []).length
      ? {
          key: 'method',
          label: '방법',
          content: item.methods.join(' '),
          tokens: unique(tokenize(item.methods.join(' ')))
        }
      : null,
    item.novelty
      ? {
          key: 'novelty',
          label: '기여',
          content: item.novelty,
          tokens: unique(tokenize(item.novelty))
        }
      : null,
    item.summary
      ? {
          key: 'summary',
          label: '요약',
          content: item.summary,
          tokens: unique(tokenize(item.summary))
        }
      : null
  ].filter(Boolean);
}

function compareSectionStructures(inputSections = [], matchSections = []) {
  if (!inputSections.length || !matchSections.length) return [];

  return inputSections.map((section) => {
    const candidates = matchSections.map((matchSection) => {
      const overlap = section.tokens.filter((token) => matchSection.tokens.includes(token));
      const score =
        sparseOverlapScore(
          Object.fromEntries(section.tokens.map((token) => [token, 1])),
          Object.fromEntries(matchSection.tokens.map((token) => [token, 1]))
        ) * 0.65 +
        (overlap.length / Math.max(1, section.tokens.length)) * 0.35;
      return {
        matchSection,
        overlap,
        score
      };
    });

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    return {
      inputSection: section.label,
      matchedSection: best?.matchSection?.label || '직접 대응 섹션 없음',
      overlapScore: Number(((best?.score || 0) * 100).toFixed(2)),
      sharedTerms: (best?.overlap || []).slice(0, 6),
      divergence:
        best?.score >= 0.55
          ? '구조적으로 유사'
          : best?.score >= 0.3
            ? '부분적으로 유사'
            : '구조 차이가 큼'
    };
  });
}

function buildDifferentiationAnalysis(textTokens = [], paper = {}, strongest = null, sectionComparisons = []) {
  const strongestTokens = strongest?.itemTokens || [];
  const uniqueTerms = textTokens.filter((token) => !strongestTokens.includes(token)).slice(0, 10);
  const methodGaps = unique((paper.methods || []).filter((method) => !normalizeText(strongest?.reason || '').includes(normalizeText(method))));
  const lowOverlapSections = sectionComparisons.filter((section) => section.overlapScore < 35);
  const strengthScore =
    uniqueTerms.length * 4 +
    methodGaps.length * 8 +
    lowOverlapSections.length * 6 +
    (paper.year && paper.year >= 2024 ? 6 : 0);

  const strengthLevel =
    strengthScore >= 55 ? 'strong' : strengthScore >= 30 ? 'moderate' : 'weak';

  return {
    strengthLevel,
    uniqueTerms,
    methodGaps,
    lowOverlapSections: lowOverlapSections.map((section) => section.inputSection),
    summary:
      strengthLevel === 'strong'
        ? '핵심 섹션 구조와 방법 선택에서 차별화 여지가 충분합니다.'
        : strengthLevel === 'moderate'
          ? '일부 섹션은 유사하지만, 고유 키워드와 적용 맥락을 더 밀어주면 차별성이 강화됩니다.'
          : '현재는 구조와 핵심 표현이 겹치는 구간이 많아 차별성 보강이 필요합니다.',
    strategyRecommendations: [
      uniqueTerms.length
        ? `고유 키워드(${uniqueTerms.slice(0, 4).join(', ')})를 초록/기여 요약 전면에 배치하세요.`
        : '고유 키워드를 더 명시적으로 선언하세요.',
      lowOverlapSections.length
        ? `${lowOverlapSections[0].inputSection} 섹션의 차이를 표/비교문으로 강조하세요.`
        : '실험 설계나 적용 맥락 차이를 정량 비교로 드러내세요.',
      methodGaps.length
        ? `방법 차이(${methodGaps.slice(0, 3).join(', ')})를 별도 소제목으로 분리하세요.`
        : '데이터·평가·적용 환경 중 하나를 명확히 차별화하세요.'
    ]
  };
}

function buildSemanticDiff(inputSections = [], strongest = null, sectionComparisons = []) {
  if (!inputSections.length || !strongest) {
    return {
      summary: '섹션 간 의미 차이를 분석할 정보가 아직 부족합니다.',
      insights: []
    };
  }

  const matchedSections = strongest.itemSections || [];
  const insights = sectionComparisons.map((comparison) => {
    const inputSection = inputSections.find((section) => section.label === comparison.inputSection);
    const matchedSection = matchedSections.find((section) => section.label === comparison.matchedSection);
    const inputTokens = inputSection?.tokens || [];
    const matchedTokens = matchedSection?.tokens || [];
    const uniqueToInput = inputTokens.filter((token) => !matchedTokens.includes(token)).slice(0, 5);
    const uniqueToMatch = matchedTokens.filter((token) => !inputTokens.includes(token)).slice(0, 5);
    return {
      section: comparison.inputSection,
      matchedSection: comparison.matchedSection,
      summary:
        comparison.overlapScore >= 60
          ? `${comparison.inputSection}은 ${comparison.matchedSection}과 문제의식은 비슷하지만 ${uniqueToInput.slice(0, 2).join(', ') || '적용 맥락'} 측면에서 차별점이 있습니다.`
          : `${comparison.inputSection}은 ${comparison.matchedSection}과 비교해 ${uniqueToInput.slice(0, 3).join(', ') || '핵심 주장'}에 더 무게를 두며 의미적 방향이 다릅니다.`,
      uniqueToInput,
      uniqueToMatch
    };
  });

  return {
    summary: insights.length
      ? `${insights[0].section}부터 ${insights[0].matchedSection} 대비 의미적 차이를 설명할 수 있습니다.`
      : '의미적 차이 분석 결과가 없습니다.',
    insights
  };
}

export function buildSimilarityReport({ title = '업로드 문서', text = '' } = {}) {
  const textTokens = unique(tokenize(text));
  const textVector = buildDenseVector(text, appConfig.vectorDimensions);
  const textSparse = buildSparseVector(text);
  const inputSections = splitIntoSections(text);

  if (textTokens.length < 8) {
    return {
      title,
      riskLevel: 'insufficient_input',
      score: 0,
      sharedThemes: [],
      noveltySignals: [],
      topMatches: [],
      sectionComparisons: [],
      semanticDiff: {
        summary: '차별점 분석을 위해 더 긴 초록/본문이 필요합니다.',
        insights: []
      },
      differentiationAnalysis: {
        strengthLevel: 'weak',
        uniqueTerms: [],
        methodGaps: [],
        lowOverlapSections: [],
        summary: '차별점 분석을 위해 더 긴 초록/본문이 필요합니다.',
        strategyRecommendations: ['초록 또는 본문 일부를 2~3문단 이상 입력해 주세요.']
      },
      recommendations: [
        '초록 또는 본문 일부를 2~3문단 이상 입력해 주세요.',
        '핵심 키워드와 문제 정의가 포함되면 유사도 분석 정확도가 높아집니다.'
      ]
    };
  }

  const ranked = indexedCatalog
    .map((item) => {
      const tokens = itemTokenSet(item);
      const shared = textTokens.filter((token) => tokens.includes(token));
      const dense = cosineSimilarity(textVector, item.vector || []);
      const sparse = sparseOverlapScore(textSparse, item.sparseVector || {});
      const score = Math.min(98, Math.round(dense * 55 + sparse * 35 + shared.length * 2.5 + (item.year >= 2024 ? 5 : 0)));
      return {
        id: item.canonicalId || item.id,
        title: item.title,
        type: item.type,
        source: item.sourceLabel || item.source,
        year: item.year,
        score,
        sharedKeywords: shared.slice(0, 8),
        reason:
          shared.length > 0
            ? `${shared.slice(0, 4).join(', ')} 키워드와 방법론 단서가 겹치며 주제 구조가 유사합니다.`
            : '공통 키워드는 적지만 문제영역과 문헌 맥락이 유사합니다.',
        itemTokens: tokens,
        dense,
        sparse,
        itemSections: buildCatalogSections(item),
        methods: item.methods || []
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const strongest = ranked[0];
  const noveltySignals = deriveNovelty(textTokens, strongest.itemTokens).map((token) => `${token} 관점 보강`);
  const sharedThemes = unique(ranked.flatMap((item) => item.sharedKeywords)).slice(0, 8);
  const score = strongest.score;
  const sectionComparisons = compareSectionStructures(inputSections, strongest.itemSections || []);
  const semanticDiff = buildSemanticDiff(inputSections, strongest, sectionComparisons);
  const differentiationAnalysis = buildDifferentiationAnalysis(textTokens, strongest, strongest, sectionComparisons);

  return {
    title,
    riskLevel: score >= 82 ? 'high' : score >= 58 ? 'moderate' : 'low',
    score,
    sharedThemes,
    noveltySignals,
    topMatches: ranked.map(({ itemTokens, dense, sparse, itemSections, methods, ...match }) => ({
      ...match,
      denseScore: Number(dense.toFixed(4)),
      sparseScore: Number(sparse.toFixed(4))
    })),
    sectionComparisons,
    semanticDiff,
    differentiationAnalysis,
    recommendations:
      score >= 82
        ? [
            '차별점을 초록 첫 문단과 기여 요약에 명시하세요.',
            '기존 방법 대비 데이터·평가·적용 환경 차이를 표로 정리하세요.',
            '국내 소스(KCI/RISS/NTIS)와의 차이를 분리해 서술하세요.',
            ...differentiationAnalysis.strategyRecommendations
          ]
        : [
            '핵심 비교 연구와의 관계를 본문에서 더 명확히 연결하면 좋습니다.',
            '데이터셋, 평가 프로토콜, 적용 환경 차이를 강조하면 독창성이 더 잘 드러납니다.',
            '학생 발명품/특허와 연결될 실용 포인트가 있으면 별도 항목으로 적으세요.',
            ...differentiationAnalysis.strategyRecommendations
          ]
  };
}
