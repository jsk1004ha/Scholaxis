import { seedCatalog } from './catalog.mjs';
import { appConfig } from './config.mjs';
import { dedupeDocuments } from './dedup-service.mjs';
import { attachSemanticVectors } from './embedding-service.mjs';
import { loadDocumentsFromPostgres } from './postgres-store.mjs';
import { getStoredDocuments, getStoredDocumentsLite } from './storage.mjs';
import { buildDenseVector, buildSparseVector, textBundle, normalizeText } from './vector-service.mjs';

const indexState = {
  key: '',
  documents: [],
  builtAt: null,
  cacheHits: 0,
  cacheMisses: 0,
};

function sortDocuments(documents = []) {
  return [...documents].sort((left, right) => {
    const leftId = left.canonicalId || left.id || '';
    const rightId = right.canonicalId || right.id || '';
    return leftId.localeCompare(rightId);
  });
}

function buildIndexFingerprint(documents = []) {
  return sortDocuments(documents)
    .map((document) => [
      document.canonicalId || document.id || '',
      document.updatedAt || '',
      document.source || '',
      document.year || '',
      String(document.summary || '').length,
      String(document.abstract || '').length,
      (document.keywords || []).length,
      (document.methods || []).length,
      (document.highlights || []).length,
    ].join(':'))
    .join('|');
}

async function loadPersistedDocuments({ fastEmbeddings = false } = {}) {
  if (appConfig.storageBackend === 'postgres') {
    return loadDocumentsFromPostgres();
  }
  return getStoredDocumentsLite();
}

function attachFastSemanticVectors(documents = [], dimensions = appConfig.vectorDimensions) {
  return documents.map((document) => {
    const text = textBundle(document);
    const vector = buildDenseVector(text, dimensions);
    return {
      ...document,
      vector,
      semanticVector: vector,
      sparseVector: buildSparseVector(text),
      searchText: normalizeText(text),
      embeddingProvider: 'hash-projection',
      embeddingModel: 'local-hash-projection',
    };
  });
}

export async function loadSearchIndexDocuments({ liveDocuments = [], fastEmbeddings = false } = {}) {
  const persistedDocuments = await loadPersistedDocuments({ fastEmbeddings });
  const merged = dedupeDocuments([...seedCatalog, ...persistedDocuments, ...(liveDocuments || [])]);
  const fingerprint = `${buildIndexFingerprint(merged)}::fast=${fastEmbeddings ? 1 : 0}`;

  if (fingerprint && fingerprint === indexState.key && indexState.documents.length) {
    indexState.cacheHits += 1;
    return indexState.documents;
  }

  indexState.cacheMisses += 1;
  indexState.key = fingerprint;
  indexState.documents = fastEmbeddings
    ? attachFastSemanticVectors(merged, appConfig.vectorDimensions)
    : await attachSemanticVectors(merged, appConfig.vectorDimensions);
  indexState.builtAt = new Date().toISOString();
  return indexState.documents;
}

export function getSearchIndexDiagnostics() {
  return {
    builtAt: indexState.builtAt,
    cacheHits: indexState.cacheHits,
    cacheMisses: indexState.cacheMisses,
    documents: indexState.documents.length,
    key: indexState.key,
  };
}

export function clearSearchIndexCache() {
  indexState.key = '';
  indexState.documents = [];
  indexState.builtAt = null;
}
