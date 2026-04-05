import { catalog } from './catalog.mjs';

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

function overlap(tokensA, tokensB) {
  const setB = new Set(tokensB);
  return tokensA.filter((token) => setB.has(token));
}

function scoreAgainstDocument(textTokens, item) {
  const itemTokens = unique(
    tokenize([item.title, item.englishTitle, item.abstract, item.summary, ...item.keywords, ...item.methods].join(' '))
  );
  const shared = overlap(textTokens, itemTokens);
  const denominator = Math.max(8, new Set([...textTokens, ...itemTokens]).size);
  const score = Math.min(96, Math.round((shared.length / denominator) * 280) + (item.year >= 2024 ? 8 : 0));
  return { score, shared, itemTokens };
}

function deriveNovelty(textTokens, strongestMatchTokens) {
  return textTokens.filter((token) => !strongestMatchTokens.includes(token)).slice(0, 4);
}

export function buildSimilarityReport({ title = '업로드 문서', text = '' } = {}) {
  const textTokens = unique(tokenize(text));

  if (textTokens.length < 8) {
    return {
      title,
      riskLevel: 'insufficient_input',
      score: 0,
      sharedThemes: [],
      noveltySignals: [],
      topMatches: [],
      recommendations: [
        '초록 또는 본문 일부를 2~3문단 이상 입력해 주세요.',
        '핵심 키워드와 문제 정의가 포함되면 유사도 분석 정확도가 높아집니다.'
      ]
    };
  }

  const ranked = catalog
    .map((item) => {
      const analysis = scoreAgainstDocument(textTokens, item);
      return {
        id: item.id,
        title: item.title,
        type: item.type,
        source: item.source,
        year: item.year,
        score: analysis.score,
        sharedKeywords: analysis.shared.slice(0, 6),
        reason:
          analysis.shared.length > 0
            ? `${analysis.shared.slice(0, 3).join(', ')} 키워드가 겹치며 ${item.type === 'paper' ? '연구 방법' : '문서 맥락'}이 유사합니다.`
            : '공통 키워드는 적지만 주제 범주가 유사합니다.',
        itemTokens: analysis.itemTokens
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const strongest = ranked[0];
  const noveltySignals = deriveNovelty(textTokens, strongest.itemTokens).map((token) => `${token} 관점 보강`);
  const sharedThemes = unique(ranked.flatMap((item) => item.sharedKeywords)).slice(0, 6);
  const score = strongest.score;

  return {
    title,
    riskLevel: score >= 80 ? 'high' : score >= 55 ? 'moderate' : 'low',
    score,
    sharedThemes,
    noveltySignals,
    topMatches: ranked.map(({ itemTokens, ...match }) => match),
    recommendations:
      score >= 80
        ? [
            '차별점을 초록 첫 문단과 기여 요약에 명시하세요.',
            '기존 방법 대비 데이터·평가·적용 환경 차이를 표로 정리하세요.'
          ]
        : [
            '핵심 비교 연구와의 관계를 본문에서 더 명확히 연결하면 좋습니다.',
            '데이터셋, 평가 프로토콜, 적용 환경 차이를 강조하면 독창성이 더 잘 드러납니다.'
          ]
  };
}
