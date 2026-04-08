import { appConfig } from './config.mjs';
import {
  getAllGraphEdges,
  listGraphEdges,
  persistGraphEdges,
  replaceGraphEdgesForSource,
} from './storage.mjs';
import { cosineSimilarity, normalizeText, tokenize, unique } from './vector-service.mjs';

function canonicalId(document) {
  return document.canonicalId || document.id;
}

function keywordOverlapScore(left = [], right = []) {
  const leftSet = new Set(left.map((item) => String(item).toLowerCase()));
  const rightSet = new Set(right.map((item) => String(item).toLowerCase()));
  const overlap = [...leftSet].filter((token) => rightSet.has(token));
  return overlap.length / Math.max(1, Math.max(leftSet.size, rightSet.size));
}

function titleTokenOverlap(document = {}, candidate = {}) {
  const left = new Set(tokenize([document.title, document.englishTitle].filter(Boolean).join(' ')));
  const right = new Set(tokenize([candidate.title, candidate.englishTitle].filter(Boolean).join(' ')));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token));
  return overlap.length / Math.max(1, Math.max(left.size, right.size));
}

function organizationKey(value = '') {
  return unique(tokenize(normalizeText(value)))
    .slice(0, 3)
    .join(':');
}

function authorIdentityKey(author = '', document = {}) {
  const normalizedAuthor = normalizeText(author).replace(/\s+/g, '');
  if (!normalizedAuthor) return '';
  const orgKey = organizationKey(document.organization || '');
  return orgKey ? `${normalizedAuthor}::${orgKey}` : normalizedAuthor;
}

function buildAuthorEdges(document) {
  const docId = canonicalId(document);
  return (document.authors || []).flatMap((author) => {
    const authorId = `author:${authorIdentityKey(author, document)}`;
    if (!String(author || '').trim()) return [];
    return [
      { sourceId: docId, targetId: authorId, edgeType: 'authored_by', weight: 1 },
      { sourceId: authorId, targetId: docId, edgeType: 'author_document', weight: 1 },
    ];
  });
}

function deriveAuthorAffinityCandidates(document, documents = [], limit = 4) {
  const baseId = canonicalId(document);
  const baseAuthors = new Set((document.authors || []).map((author) => authorIdentityKey(author, document)).filter(Boolean));
  const baseOrg = organizationKey(document.organization || '');
  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const candidateAuthors = new Set((candidate.authors || []).map((author) => authorIdentityKey(author, candidate)).filter(Boolean));
      const sharedAuthors = [...baseAuthors].filter((author) => candidateAuthors.has(author));
      const sharedOrg = baseOrg && baseOrg === organizationKey(candidate.organization || '');
      const keywordOverlap = keywordOverlapScore(document.keywords || [], candidate.keywords || []);
      const dense = cosineSimilarity(document.vector || [], candidate.vector || []);
      const score =
        sharedAuthors.length * 0.55 +
        (sharedOrg ? 0.18 : 0) +
        keywordOverlap * 0.17 +
        dense * 0.1;
      return { candidate, score, sharedAuthors, sharedOrg };
    })
    .filter((entry) => entry.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}


function deriveSimilarityCandidates(document, documents = [], limit = 4) {
  const baseId = canonicalId(document);
  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const keywordOverlap = keywordOverlapScore(document.keywords || [], candidate.keywords || []);
      const dense = cosineSimilarity(document.vector || [], candidate.vector || []);
      const score = dense * 0.68 + keywordOverlap * 0.2 + Math.min((candidate.citations || 0) / 400, 0.12);
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0.26)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function deriveReferenceCandidates(document, documents = [], limit = appConfig.citationExpansionLimit) {
  const baseId = canonicalId(document);
  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .filter((candidate) => (candidate.year || 0) <= (document.year || Number.MAX_SAFE_INTEGER))
    .map((candidate) => {
      const overlap = keywordOverlapScore(document.keywords || [], candidate.keywords || []);
      const dense = cosineSimilarity(document.vector || [], candidate.vector || []);
      const score = overlap * 0.55 + dense * 0.45 + Math.min((candidate.citations || 0) / 300, 0.2);
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function deriveSemanticSimilarityCandidates(document, documents = [], limit = 4) {
  const baseId = canonicalId(document);
  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const overlap = keywordOverlapScore(document.keywords || [], candidate.keywords || []);
      const dense = cosineSimilarity(document.semanticVector || document.vector || [], candidate.semanticVector || candidate.vector || []);
      const score = dense * 0.72 + overlap * 0.28;
      return { candidate, score };
    })
    .filter((entry) => entry.score >= 0.33)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function deriveTopicBridgeCandidates(document, documents = [], limit = 4) {
  const baseId = canonicalId(document);
  return documents
    .filter((candidate) => canonicalId(candidate) !== baseId)
    .map((candidate) => {
      const keywordOverlap = keywordOverlapScore(document.keywords || [], candidate.keywords || []);
      const titleOverlap = titleTokenOverlap(document, candidate);
      const dense = cosineSimilarity(document.semanticVector || document.vector || [], candidate.semanticVector || candidate.vector || []);
      const sameRegion = document.region && candidate.region && document.region === candidate.region ? 0.06 : 0;
      const score = keywordOverlap * 0.42 + titleOverlap * 0.3 + dense * 0.22 + sameRegion;
      return { candidate, score, keywordOverlap, titleOverlap, dense };
    })
    .filter((entry) => entry.score >= 0.22)
    .filter((entry) => entry.keywordOverlap > 0 || entry.titleOverlap > 0 || entry.dense >= 0.46)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function traceGraphPaths(documentId, limit = 10) {
  const edges = getAllGraphEdges(20000);
  if (!documentId || !edges.length) return [];
  const outgoing = edges.filter((edge) => edge.sourceId === documentId);
  const outgoingBySource = new Map();
  for (const edge of edges) {
    const bucket = outgoingBySource.get(edge.sourceId) || [];
    bucket.push(edge);
    outgoingBySource.set(edge.sourceId, bucket);
  }

  const paths = [];
  for (const first of outgoing) {
    const secondHop = outgoingBySource.get(first.targetId) || [];
    for (const second of secondHop) {
      if (second.targetId === documentId) continue;
      const weight = Number((Number(first.weight || 0) * Number(second.weight || 0)).toFixed(4));
      paths.push({
        from: documentId,
        via: first.targetId,
        to: second.targetId,
        firstEdgeType: first.edgeType,
        secondEdgeType: second.edgeType,
        weight,
        summary: `${first.edgeType} → ${second.edgeType} 경로로 ${second.targetId}에 연결됩니다.`
      });
    }
  }

  const seen = new Set();
  return paths
    .sort((a, b) => b.weight - a.weight)
    .filter((path) => {
      const key = `${path.via}:${path.to}:${path.firstEdgeType}:${path.secondEdgeType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function deriveGraphEdges(documents = []) {
  const edges = [];

  for (const document of documents) {
    const docId = canonicalId(document);
    edges.push(...buildAuthorEdges(document));

    const references = deriveReferenceCandidates(document, documents);
    for (const entry of references) {
      const targetId = canonicalId(entry.candidate);
      edges.push({
        sourceId: docId,
        targetId,
        edgeType: 'references',
        weight: Number(entry.score.toFixed(4)),
      });
      edges.push({
        sourceId: targetId,
        targetId: docId,
        edgeType: 'cited_by',
        weight: Number(entry.score.toFixed(4)),
      });
    }

    const authorAffinity = deriveAuthorAffinityCandidates(document, documents);
    for (const entry of authorAffinity) {
      const targetId = canonicalId(entry.candidate);
      edges.push({
        sourceId: docId,
        targetId,
        edgeType: 'author_affinity',
        weight: Number(entry.score.toFixed(4)),
      });
    }

    const semanticSimilar = deriveSemanticSimilarityCandidates(document, documents);
    for (const entry of semanticSimilar) {
      const targetId = canonicalId(entry.candidate);
      edges.push({
        sourceId: docId,
        targetId,
        edgeType: 'similar',
        weight: Number(entry.score.toFixed(4)),
      });
    }

    const topicBridges = deriveTopicBridgeCandidates(document, documents);
    for (const entry of topicBridges) {
      const targetId = canonicalId(entry.candidate);
      edges.push({
        sourceId: docId,
        targetId,
        edgeType: 'topic_bridge',
        weight: Number(entry.score.toFixed(4)),
      });
    }
  }

  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.sourceId}:${edge.targetId}:${edge.edgeType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function syncRemoteGraph(edges = []) {
  if (appConfig.graphBackend !== 'http' || !appConfig.graphServiceUrl) {
    return { backend: appConfig.graphBackend, synced: edges.length, mode: 'local-inline' };
  }

  try {
    const response = await fetch(new URL('/upsert', appConfig.graphServiceUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ edges }),
    });
    if (!response.ok) throw new Error(`graph backend request failed: ${response.status}`);
    const payload = await response.json();
    return { backend: 'http', synced: payload.synced || edges.length, mode: 'remote-http' };
  } catch (error) {
    return { backend: 'http', synced: 0, mode: 'remote-http-fallback', error: error.message };
  }
}

export async function syncDocumentGraph(documents = []) {
  const edges = deriveGraphEdges(documents);
  const grouped = new Map();
  for (const edge of edges) {
    const bucket = grouped.get(edge.sourceId) || [];
    bucket.push(edge);
    grouped.set(edge.sourceId, bucket);
  }
  for (const [sourceId, sourceEdges] of grouped.entries()) {
    replaceGraphEdgesForSource(sourceId, sourceEdges);
  }
  const remote = await syncRemoteGraph(edges);
  return { edges, remote };
}

export function getDocumentGraph(documentId, limit = 12) {
  return {
    references: listGraphEdges({ sourceId: documentId, edgeType: 'references', limit }),
    citations: listGraphEdges({ targetId: documentId, edgeType: 'references', limit }),
    authors: listGraphEdges({ sourceId: documentId, edgeType: 'authored_by', limit }),
    authorAffinity: listGraphEdges({ sourceId: documentId, edgeType: 'author_affinity', limit }),
    similar: listGraphEdges({ sourceId: documentId, edgeType: 'similar', limit }),
    topicBridges: listGraphEdges({ sourceId: documentId, edgeType: 'topic_bridge', limit }),
    pathTrace: traceGraphPaths(documentId, limit),
  };
}

function relationLabel(edgeType = '') {
  return (
    {
      references: '선행 참고',
      citations: '후속 인용',
      cited_by: '후속 인용',
      author_affinity: '저자/기관 연결',
      similar: '유사 문헌',
      topic_bridge: '주제 연결',
      authored_by: '저자'
    }[edgeType] || edgeType
  );
}

function toGraphPath(startId, edgeA, edgeB, docMap = new Map()) {
  const middleId = edgeA?.targetId || edgeA?.sourceId;
  const endId = edgeB?.targetId || edgeB?.sourceId;
  const middle = docMap.get(middleId);
  const end = docMap.get(endId);
  const weight = Number((((edgeA?.weight || 0) * 0.55) + ((edgeB?.weight || 0) * 0.45)).toFixed(4));
  const parts = [
    middle?.title ? `${relationLabel(edgeA?.edgeType)} ${middle.title}` : null,
    end?.title ? `${relationLabel(edgeB?.edgeType)} ${end.title}` : null
  ].filter(Boolean);
  return {
    hop: 2,
    from: startId,
    via: middleId,
    to: endId,
    weight,
    relations: [edgeA?.edgeType, edgeB?.edgeType].filter(Boolean),
    summary: parts.length ? `${parts.join(' → ')} 경로가 연결됩니다.` : '연관 경로가 연결됩니다.'
  };
}

export function traceDocumentGraph(documentId, documents = [], limit = 8) {
  const graph = getDocumentGraph(documentId, Math.max(limit, 12));
  const docMap = new Map(
    documents
      .map((document) => [canonicalId(document), document])
      .filter((entry) => entry[0])
  );
  const directEdges = [
    ...graph.references,
    ...graph.citations.map((edge) => ({ ...edge, edgeType: 'citations' })),
    ...graph.authorAffinity,
    ...graph.similar,
    ...graph.topicBridges
  ]
    .filter((edge) => edge.sourceId !== edge.targetId)
    .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));

  const directPaths = directEdges.slice(0, limit).map((edge) => {
    const targetId = edge.targetId === documentId ? edge.sourceId : edge.targetId;
    const target = docMap.get(targetId);
    return {
      hop: 1,
      from: documentId,
      to: targetId,
      weight: Number(edge.weight || 0),
      relations: [edge.edgeType],
      summary: target?.title
        ? `${relationLabel(edge.edgeType)}으로 ${target.title}와 직접 연결됩니다.`
        : `${relationLabel(edge.edgeType)} 직접 연결이 있습니다.`
    };
  });

  const secondaryPaths = [];
  for (const edge of directEdges.slice(0, Math.min(limit, 4))) {
    const pivotId = edge.targetId === documentId ? edge.sourceId : edge.targetId;
    const pivotGraph = getDocumentGraph(pivotId, 4);
    const pivotEdges = [
      ...pivotGraph.references,
      ...pivotGraph.citations.map((item) => ({ ...item, edgeType: 'citations' })),
      ...pivotGraph.authorAffinity,
      ...pivotGraph.similar,
      ...pivotGraph.topicBridges
    ];
    for (const pivotEdge of pivotEdges) {
      const endId = pivotEdge.targetId === pivotId ? pivotEdge.sourceId : pivotEdge.targetId;
      if (!endId || endId === documentId || endId === pivotId) continue;
      secondaryPaths.push(toGraphPath(documentId, { ...edge, targetId: pivotId }, { ...pivotEdge, targetId: endId }, docMap));
    }
  }

  const seen = new Set();
  const paths = [...directPaths, ...secondaryPaths]
    .filter((path) => {
      const key = `${path.from}:${path.via || ''}:${path.to}:${(path.relations || []).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0))
    .slice(0, limit);

  return {
    graph,
    paths,
    nodes: [
      { id: documentId, role: 'focus' },
      ...paths.flatMap((path) => [path.via, path.to]).filter(Boolean).map((id) => ({ id, role: 'connected' }))
    ],
    edges: directEdges.slice(0, Math.max(limit, 12))
  };
}

export function getGraphBackendDiagnostics() {
  return {
    backend: appConfig.graphBackend,
    serviceUrl: appConfig.graphServiceUrl || '',
    totalEdges: getAllGraphEdges(5000).length,
    supportsAuthorGraph: true,
    supportsAuthorResolution: true,
    supportsCitationGraph: true,
    supportsReferenceGraph: true,
    supportsPathTrace: true,
    supportsTopicBridge: true,
  };
}
