const WORD_RE = /[^\p{L}\p{N}\s]/gu;

export function normalizeText(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(WORD_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function unique(values) {
  return [...new Set(values)];
}

export function hashToken(token, dimensions = 96) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

export function buildDenseVector(text, dimensions = 96) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;

  for (const token of tokens) {
    const bucket = hashToken(token, dimensions);
    const sign = hashToken(`sign:${token}`, 2) === 0 ? -1 : 1;
    vector[bucket] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function buildSparseVector(text) {
  const counts = {};
  const tokens = tokenize(text);
  for (const token of tokens) {
    counts[token] = (counts[token] || 0) + 1;
  }
  return counts;
}

export function cosineSimilarity(vectorA = [], vectorB = []) {
  const length = Math.min(vectorA.length, vectorB.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += vectorA[index] * vectorB[index];
    magA += vectorA[index] * vectorA[index];
    magB += vectorB[index] * vectorB[index];
  }
  if (!magA || !magB) return 0;
  return dot / Math.sqrt(magA * magB);
}

export function sparseOverlapScore(sparseA = {}, sparseB = {}) {
  const keys = unique([...Object.keys(sparseA), ...Object.keys(sparseB)]);
  if (!keys.length) return 0;
  let overlap = 0;
  let total = 0;
  for (const key of keys) {
    const a = sparseA[key] || 0;
    const b = sparseB[key] || 0;
    overlap += Math.min(a, b);
    total += Math.max(a, b);
  }
  return total ? overlap / total : 0;
}

export function textBundle(document) {
  return [
    document.title,
    document.englishTitle,
    document.abstract,
    document.summary,
    document.novelty,
    ...(document.keywords || []),
    ...(document.methods || []),
    ...(document.highlights || [])
  ]
    .filter(Boolean)
    .join(' ');
}

export function attachVectors(document, dimensions = 96) {
  const text = textBundle(document);
  return {
    ...document,
    vector: buildDenseVector(text, dimensions),
    sparseVector: buildSparseVector(text),
    searchText: normalizeText(text)
  };
}
