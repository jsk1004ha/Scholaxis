import { appConfig } from './config.mjs';
import { getDocumentGraph } from './graph-service.mjs';
import { searchVectorCandidates } from './vector-index-service.mjs';
import { cosineSimilarity } from './vector-service.mjs';

function canonicalId(document) {
  return document.canonicalId || document.id;
}

function overlap(left = [], right = []) {
  const leftSet = new Set(left.map((item) => String(item).toLowerCase()));
  const rightSet = new Set(right.map((item) => String(item).toLowerCase()));
  return [...leftSet].filter((item) => rightSet.has(item));
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

  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const candidateId = canonicalId(candidate);
      const keywordOverlap = overlap(paper.keywords || [], candidate.keywords || []);
      const authorOverlap = overlap(paper.authors || [], candidate.authors || []);
      const dense = cosineSimilarity(paper.vector || [], candidate.vector || []);
      const vectorBackendScore = vectorScoreById.get(candidateId) || 0;
      const graphBoost =
        (referenceTargets.has(candidateId) ? 0.12 : 0) +
        (citationSources.has(candidateId) ? 0.08 : 0);
      const preferredSourceBoost =
        userProfile?.preferredSources?.includes(candidate.source) ? 0.08 : 0;
      const preferredRegionBoost =
        userProfile?.defaultRegion && userProfile.defaultRegion !== 'all' && userProfile.defaultRegion === candidate.region
          ? 0.04
          : 0;
      const freshnessBoost = candidate.year ? Math.max(0, (candidate.year - 2021) * 0.01) : 0;
      const score =
        dense * 0.36 +
        vectorBackendScore * 0.22 +
        keywordOverlap.length * 0.05 +
        authorOverlap.length * 0.04 +
        graphBoost +
        preferredSourceBoost +
        preferredRegionBoost +
        freshnessBoost;

      return {
        ...candidate,
        recommendationScore: Number((score * 100).toFixed(2)),
        explanation: [
          keywordOverlap.length ? `공통 키워드: ${keywordOverlap.slice(0, 4).join(', ')}` : null,
          authorOverlap.length ? `저자/조직 연결: ${authorOverlap.slice(0, 2).join(', ')}` : null,
          referenceTargets.has(candidateId) ? '참고문헌 그래프에서 연결됨' : null,
          citationSources.has(candidateId) ? '인용 그래프에서 연결됨' : null,
          userProfile?.preferredSources?.includes(candidate.source) ? `선호 소스(${candidate.source})` : null,
        ].filter(Boolean),
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit);
}
