import { dedupeDocuments } from './dedup-service.mjs';
import { seedCatalog } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { attachVectors, buildDenseVector, buildSparseVector, cosineSimilarity, sparseOverlapScore, tokenize, unique } from './vector-service.mjs';

const indexedCatalog = dedupeDocuments(seedCatalog).map((document) => attachVectors(document, appConfig.vectorDimensions));

function deriveNovelty(textTokens, strongestMatchTokens) {
  return textTokens.filter((token) => !strongestMatchTokens.includes(token)).slice(0, 6);
}

function itemTokenSet(item) {
  return unique(tokenize([item.title, item.englishTitle, item.abstract, item.summary, ...(item.keywords || []), ...(item.methods || [])].join(' ')));
}

export function buildSimilarityReport({ title = '업로드 문서', text = '' } = {}) {
  const textTokens = unique(tokenize(text));
  const textVector = buildDenseVector(text, appConfig.vectorDimensions);
  const textSparse = buildSparseVector(text);

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
        sparse
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const strongest = ranked[0];
  const noveltySignals = deriveNovelty(textTokens, strongest.itemTokens).map((token) => `${token} 관점 보강`);
  const sharedThemes = unique(ranked.flatMap((item) => item.sharedKeywords)).slice(0, 8);
  const score = strongest.score;

  return {
    title,
    riskLevel: score >= 82 ? 'high' : score >= 58 ? 'moderate' : 'low',
    score,
    sharedThemes,
    noveltySignals,
    topMatches: ranked.map(({ itemTokens, dense, sparse, ...match }) => ({
      ...match,
      denseScore: Number(dense.toFixed(4)),
      sparseScore: Number(sparse.toFixed(4))
    })),
    recommendations:
      score >= 82
        ? [
            '차별점을 초록 첫 문단과 기여 요약에 명시하세요.',
            '기존 방법 대비 데이터·평가·적용 환경 차이를 표로 정리하세요.',
            '국내 소스(KCI/RISS/NTIS)와의 차이를 분리해 서술하세요.'
          ]
        : [
            '핵심 비교 연구와의 관계를 본문에서 더 명확히 연결하면 좋습니다.',
            '데이터셋, 평가 프로토콜, 적용 환경 차이를 강조하면 독창성이 더 잘 드러납니다.',
            '학생 발명품/특허와 연결될 실용 포인트가 있으면 별도 항목으로 적으세요.'
          ]
  };
}
