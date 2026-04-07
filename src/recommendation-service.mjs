import { appConfig } from './config.mjs';
import { getDocumentGraph } from './graph-service.mjs';
import { searchVectorCandidates } from './vector-index-service.mjs';
import { cosineSimilarity, normalizeText, tokenize, unique } from './vector-service.mjs';

function canonicalId(document) {
  return document.canonicalId || document.id;
}

function overlap(left = [], right = []) {
  const leftSet = new Set(left.map((item) => String(item).toLowerCase()));
  const rightSet = new Set(right.map((item) => String(item).toLowerCase()));
  return [...leftSet].filter((item) => rightSet.has(item));
}

function resolvedAuthorOverlap(leftDocument = {}, rightDocument = {}) {
  const leftOrg = normalizeText(leftDocument.organization || '');
  const rightOrg = normalizeText(rightDocument.organization || '');
  const leftResolved = new Set((leftDocument.authors || []).map((author) => `${normalizeText(author)}::${leftOrg}`).filter(Boolean));
  const rightResolved = new Set((rightDocument.authors || []).map((author) => `${normalizeText(author)}::${rightOrg}`).filter(Boolean));
  return [...leftResolved].filter((item) => rightResolved.has(item));
}

export async function buildRecommendationSet({
  paper,
  documents = [],
  userProfile = null,
  limit = 5,
}) {
  const baseId = canonicalId(paper);
  const graph = getDocumentGraph(baseId, appConfig.recommendationCandidateLimit);
  const vectorHits = await searchVectorCandidates({
    query: [paper.title, ...(paper.keywords || []), ...(paper.methods || [])].filter(Boolean).join(' '),
    documents,
    limit: appConfig.recommendationCandidateLimit,
  });
  const vectorScoreById = new Map(vectorHits.map((item) => [item.id, item.score]));
  const referenceTargets = new Set(graph.references.map((edge) => edge.targetId));
  const citationSources = new Set(graph.citations.map((edge) => edge.sourceId));
  const authorAffinityTargets = new Set((graph.authorAffinity || []).map((edge) => edge.targetId));
  const interestTerms = unique(tokenize((userProfile?.researchInterests || []).join(' ')));

  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const candidateId = canonicalId(candidate);
      const keywordOverlap = overlap(paper.keywords || [], candidate.keywords || []);
      const authorOverlap = overlap(paper.authors || [], candidate.authors || []);
      const resolvedAuthorMatches = resolvedAuthorOverlap(paper, candidate);
      const interestOverlap = interestTerms.filter((term) =>
        [candidate.title, candidate.summary, ...(candidate.keywords || [])].join(' ').toLowerCase().includes(term)
      );
      const dense = cosineSimilarity(paper.vector || [], candidate.vector || []);
      const vectorBackendScore = vectorScoreById.get(candidateId) || 0;
      const graphBoost =
        (referenceTargets.has(candidateId) ? 0.12 : 0) +
        (citationSources.has(candidateId) ? 0.08 : 0) +
        (authorAffinityTargets.has(candidateId) ? 0.09 : 0);
      const preferredSourceBoost =
        userProfile?.preferredSources?.includes(candidate.source) ? 0.08 : 0;
      const preferredRegionBoost =
        userProfile?.defaultRegion && userProfile.defaultRegion !== 'all' && userProfile.defaultRegion === candidate.region
          ? 0.04
          : 0;
      const freshnessBoost = candidate.year ? Math.max(0, (candidate.year - 2021) * 0.01) : 0;
      const sourceDiversityPenalty =
        candidate.source === paper.source ? 0.04 : 0;
      const noveltyBoost =
        keywordOverlap.length <= 2 && dense >= 0.18 ? 0.05 : 0;
      const score =
        dense * 0.36 +
        vectorBackendScore * 0.22 +
        keywordOverlap.length * 0.05 +
        authorOverlap.length * 0.04 +
        resolvedAuthorMatches.length * 0.05 +
        interestOverlap.length * 0.03 +
        graphBoost +
        preferredSourceBoost +
        preferredRegionBoost +
        freshnessBoost +
        noveltyBoost -
        sourceDiversityPenalty;

      return {
        ...candidate,
        recommendationScore: Number((score * 100).toFixed(2)),
        recommendationRationale: {
          keywordOverlap,
          authorOverlap,
          resolvedAuthorMatches,
          interestOverlap,
          referenceLinked: referenceTargets.has(candidateId),
          citationLinked: citationSources.has(candidateId),
          authorAffinityLinked: authorAffinityTargets.has(candidateId),
          sourceDiversityPenalty,
          noveltyBoost,
        },
        explanation: [
          keywordOverlap.length ? `공통 키워드: ${keywordOverlap.slice(0, 4).join(', ')}` : null,
          authorOverlap.length ? `저자/조직 연결: ${authorOverlap.slice(0, 2).join(', ')}` : null,
          resolvedAuthorMatches.length ? '소속기관까지 고려한 저자 식별 후보와 연결됨' : null,
          referenceTargets.has(candidateId) ? '참고문헌 그래프에서 연결됨' : null,
          citationSources.has(candidateId) ? '인용 그래프에서 연결됨' : null,
          authorAffinityTargets.has(candidateId) ? '저자 연구 맵에서 가까운 후보' : null,
          interestOverlap.length ? `연구 관심사와 일치: ${interestOverlap.slice(0, 3).join(', ')}` : null,
          noveltyBoost ? '같은 주제지만 기여 포인트가 달라 후속 읽기 가치가 높음' : null,
          sourceDiversityPenalty ? '동일 소스 편향을 줄이도록 점수를 조정함' : null,
          userProfile?.preferredSources?.includes(candidate.source) ? `선호 소스(${candidate.source})` : null,
        ].filter(Boolean),
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit);
}
