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

function titleTokenOverlap(leftDocument = {}, rightDocument = {}) {
  const leftTokens = new Set(tokenize([leftDocument.title, leftDocument.englishTitle].filter(Boolean).join(' ')));
  const rightTokens = new Set(tokenize([rightDocument.title, rightDocument.englishTitle].filter(Boolean).join(' ')));
  return [...leftTokens].filter((token) => rightTokens.has(token));
}

function methodOverlap(leftDocument = {}, rightDocument = {}) {
  return overlap(leftDocument.methods || [], rightDocument.methods || []);
}

function sourceKeys(document = {}) {
  return unique([document.source, ...(document.alternateSources || [])].filter(Boolean));
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
  const similarTargets = new Set((graph.similar || []).map((edge) => edge.targetId));
  const topicBridgeTargets = new Set((graph.topicBridges || []).map((edge) => edge.targetId));
  const interestTerms = unique(tokenize((userProfile?.researchInterests || []).join(' ')));

  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const candidateId = canonicalId(candidate);
      const keywordOverlap = overlap(paper.keywords || [], candidate.keywords || []);
      const authorOverlap = overlap(paper.authors || [], candidate.authors || []);
      const resolvedAuthorMatches = resolvedAuthorOverlap(paper, candidate);
      const sharedMethods = methodOverlap(paper, candidate);
      const sharedTitleTokens = titleTokenOverlap(paper, candidate);
      const paperSources = sourceKeys(paper);
      const candidateSources = sourceKeys(candidate);
      const sharedSourceKeys = overlap(paperSources, candidateSources);
      const interestOverlap = interestTerms.filter((term) =>
        [candidate.title, candidate.summary, ...(candidate.keywords || [])].join(' ').toLowerCase().includes(term)
      );
      const dense = cosineSimilarity(paper.vector || [], candidate.vector || []);
      const vectorBackendScore = vectorScoreById.get(candidateId) || 0;
      const graphBoost =
        (referenceTargets.has(candidateId) ? 0.12 : 0) +
        (citationSources.has(candidateId) ? 0.08 : 0) +
        (authorAffinityTargets.has(candidateId) ? 0.09 : 0) +
        (similarTargets.has(candidateId) ? 0.05 : 0) +
        (topicBridgeTargets.has(candidateId) ? 0.07 : 0);
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
      const provenanceBoost =
        Math.max(0, candidateSources.length - 1) * 0.025 +
        Math.max(0, sharedSourceKeys.length - 1) * 0.015;
      const metadataBoost =
        sharedMethods.length * 0.035 +
        Math.min(sharedTitleTokens.length, 3) * 0.012;
      const graphSignals = [
        referenceTargets.has(candidateId) ? 'references' : null,
        citationSources.has(candidateId) ? 'citations' : null,
        authorAffinityTargets.has(candidateId) ? 'author_affinity' : null,
        similarTargets.has(candidateId) ? 'similar' : null,
        topicBridgeTargets.has(candidateId) ? 'topic_bridge' : null,
      ].filter(Boolean);
      const metadataSignals = [
        keywordOverlap.length ? 'shared_keywords' : null,
        sharedMethods.length ? 'shared_methods' : null,
        sharedTitleTokens.length ? 'title_overlap' : null,
        resolvedAuthorMatches.length ? 'resolved_author_overlap' : null,
        sharedSourceKeys.length ? 'shared_source_keys' : null,
        candidateSources.length > 1 ? 'multi_source_candidate' : null,
      ].filter(Boolean);
      const evidenceCount = graphSignals.length + metadataSignals.length;
      const score =
        dense * 0.36 +
        vectorBackendScore * 0.22 +
        keywordOverlap.length * 0.05 +
        authorOverlap.length * 0.04 +
        resolvedAuthorMatches.length * 0.05 +
        sharedMethods.length * 0.035 +
        interestOverlap.length * 0.03 +
        graphBoost +
        metadataBoost +
        provenanceBoost +
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
          sharedMethods,
          sharedTitleTokens: sharedTitleTokens.slice(0, 6),
          interestOverlap,
          referenceLinked: referenceTargets.has(candidateId),
          citationLinked: citationSources.has(candidateId),
          authorAffinityLinked: authorAffinityTargets.has(candidateId),
          similarLinked: similarTargets.has(candidateId),
          topicBridgeLinked: topicBridgeTargets.has(candidateId),
          sourceDiversityPenalty,
          provenanceBoost: Number(provenanceBoost.toFixed(4)),
          noveltyBoost,
          sourceGrounding: {
            paperSources,
            candidateSources,
            sharedSourceKeys,
            graphSignals,
            metadataSignals,
            evidenceCount,
          }
        },
        explanation: [
          keywordOverlap.length ? `공통 키워드: ${keywordOverlap.slice(0, 4).join(', ')}` : null,
          sharedMethods.length ? `공통 방법론: ${sharedMethods.slice(0, 3).join(', ')}` : null,
          sharedTitleTokens.length ? `제목/주제 단서: ${sharedTitleTokens.slice(0, 4).join(', ')}` : null,
          authorOverlap.length ? `저자/조직 연결: ${authorOverlap.slice(0, 2).join(', ')}` : null,
          resolvedAuthorMatches.length ? '소속기관까지 고려한 저자 식별 후보와 연결됨' : null,
          referenceTargets.has(candidateId) ? '참고문헌 그래프에서 연결됨' : null,
          citationSources.has(candidateId) ? '인용 그래프에서 연결됨' : null,
          authorAffinityTargets.has(candidateId) ? '저자 연구 맵에서 가까운 후보' : null,
          similarTargets.has(candidateId) ? '유사 문헌 그래프에서 직접 연결됨' : null,
          topicBridgeTargets.has(candidateId) ? '주제 브리지 그래프에서 연결됨' : null,
          candidateSources.length > 1 ? `복수 출처 정합: ${candidateSources.join(', ')}` : null,
          sharedSourceKeys.length ? `공유 provenance 단서: ${sharedSourceKeys.join(', ')}` : null,
          interestOverlap.length ? `연구 관심사와 일치: ${interestOverlap.slice(0, 3).join(', ')}` : null,
          noveltyBoost ? '같은 주제지만 기여 포인트가 달라 후속 읽기 가치가 높음' : null,
          sourceDiversityPenalty ? '동일 소스 편향을 줄이도록 점수를 조정함' : null,
          userProfile?.preferredSources?.includes(candidate.source) ? `선호 소스(${candidate.source})` : null,
          evidenceCount ? `근거 신호 ${evidenceCount}개로 추천을 지지합니다.` : null,
        ].filter(Boolean),
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit);
}
