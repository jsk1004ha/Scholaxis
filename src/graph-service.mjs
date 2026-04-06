import { appConfig } from './config.mjs';
import {
  getAllGraphEdges,
  listGraphEdges,
  persistGraphEdges,
  replaceGraphEdgesForSource,
} from './storage.mjs';
import { cosineSimilarity, tokenize, unique } from './vector-service.mjs';

function canonicalId(document) {
  return document.canonicalId || document.id;
}

function keywordOverlapScore(left = [], right = []) {
  const leftSet = new Set(left.map((item) => String(item).toLowerCase()));
  const rightSet = new Set(right.map((item) => String(item).toLowerCase()));
  const overlap = [...leftSet].filter((token) => rightSet.has(token));
  return overlap.length / Math.max(1, Math.max(leftSet.size, rightSet.size));
}

function buildAuthorEdges(document) {
  const docId = canonicalId(document);
  return (document.authors || []).flatMap((author) => {
    const authorId = `author:${String(author).trim().toLowerCase()}`;
    if (!String(author || '').trim()) return [];
    return [
      { sourceId: docId, targetId: authorId, edgeType: 'authored_by', weight: 1 },
      { sourceId: authorId, targetId: docId, edgeType: 'author_document', weight: 1 },
    ];
  });
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
  persistGraphEdges(edges);
  const remote = await syncRemoteGraph(edges);
  return { edges, remote };
}

export function getDocumentGraph(documentId, limit = 12) {
  return {
    references: listGraphEdges({ sourceId: documentId, edgeType: 'references', limit }),
    citations: listGraphEdges({ targetId: documentId, edgeType: 'references', limit }),
    authors: listGraphEdges({ sourceId: documentId, edgeType: 'authored_by', limit }),
    similar: listGraphEdges({ sourceId: documentId, edgeType: 'similar', limit }),
  };
}

export function getGraphBackendDiagnostics() {
  return {
    backend: appConfig.graphBackend,
    serviceUrl: appConfig.graphServiceUrl || '',
    totalEdges: getAllGraphEdges(5000).length,
    supportsAuthorGraph: true,
    supportsCitationGraph: true,
    supportsReferenceGraph: true,
  };
}
