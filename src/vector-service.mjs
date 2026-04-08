import { expandSemanticLexiconTerms } from './semantic-lexicon.mjs';

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

function normalizeVectorValues(vector = []) {
  const output = Array.isArray(vector) ? vector.map((value) => Number(value || 0)) : [];
  if (!output.length) return [];
  const magnitude = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0)) || 1;
  return output.map((value) => Number((value / magnitude).toFixed(6)));
}

export function hashToken(token, dimensions = 96) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

function detectLanguage(value = '') {
  if (!String(value || '').trim()) return 'none';
  const hasKorean = /[가-힣]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasKorean && hasLatin) return 'mixed';
  if (hasKorean) return 'ko';
  if (hasLatin) return 'en';
  return 'other';
}

function addWeight(map, key, weight) {
  if (!key || !Number.isFinite(weight) || weight <= 0) return;
  map.set(key, (map.get(key) || 0) + weight);
}

function buildCharacterNgrams(text = '') {
  const compact = normalizeText(text).replace(/\s+/g, '');
  const grams = [];
  const min = /[가-힣]/.test(compact) ? 2 : 3;
  const max = /[가-힣]/.test(compact) ? 4 : 5;
  for (let size = min; size <= max; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      const gram = compact.slice(index, index + size);
      if (gram.length === size) grams.push(gram);
    }
  }
  return grams;
}

function buildFeatureMap(text = '') {
  const normalized = normalizeText(text);
  const tokens = tokenize(text);
  const expanded = expandSemanticLexiconTerms([normalized, ...tokens]);
  const phrases = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }
  const featureMap = new Map();
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  for (const [token, count] of counts.entries()) addWeight(featureMap, `tok:${token}`, 1 + Math.log1p(count));
  for (const phrase of phrases) addWeight(featureMap, `phrase:${phrase}`, 1.3);
  for (const item of expanded) addWeight(featureMap, `sem:${item}`, item.includes(' ') ? 1.25 : 1.05);
  for (const gram of buildCharacterNgrams(text)) addWeight(featureMap, `char:${gram}`, 0.28);
  if (normalized) addWeight(featureMap, `full:${normalized.replace(/\s+/g, '')}`, 1.45);
  return featureMap;
}

export function buildDenseVector(text, dimensions = 384) {
  const vector = new Array(dimensions).fill(0);
  const features = buildFeatureMap(text);
  if (!features.size) return vector;

  for (const [feature, weight] of features.entries()) {
    const projections = Math.min(6, Math.max(3, Math.ceil(dimensions / 128)));
    for (let index = 0; index < projections; index += 1) {
      const bucket = hashToken(`${feature}:${index}`, dimensions);
      const sign = hashToken(`sign:${feature}:${index}`, 2) === 0 ? -1 : 1;
      const scale = index === 0 ? 1 : 1 / (index + 0.5);
      vector[bucket] += sign * weight * scale;
    }
  }

  const language = detectLanguage(text);
  if (language === 'ko' || language === 'mixed') {
    const hangul = (normalizeText(text).match(/[가-힣]/g) || []).length;
    vector[0] += hangul * 0.05;
  }
  if (language === 'en' || language === 'mixed') {
    const latin = (normalizeText(text).match(/[a-z]/g) || []).length;
    vector[1] += latin * 0.03;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function fitVectorDimensions(vector = [], dimensions = 384) {
  const normalized = normalizeVectorValues(vector);
  if (!normalized.length) return buildDenseVector('', dimensions);
  if (normalized.length === dimensions) return normalized;
  if (normalized.length > dimensions) {
    const pooled = new Array(dimensions).fill(0);
    const counts = new Array(dimensions).fill(0);
    for (let index = 0; index < normalized.length; index += 1) {
      const bucket = Math.min(dimensions - 1, Math.floor((index * dimensions) / normalized.length));
      pooled[bucket] += normalized[index];
      counts[bucket] += 1;
    }
    return normalizeVectorValues(
      pooled.map((value, index) => (counts[index] ? value / counts[index] : value))
    );
  }
  return normalizeVectorValues([...normalized, ...new Array(dimensions - normalized.length).fill(0)]);
}

export function buildSparseVector(text) {
  const counts = {};
  const normalized = normalizeText(text);
  const tokens = tokenize(text);
  const semantic = expandSemanticLexiconTerms(tokens);
  for (const token of tokens) {
    counts[token] = (counts[token] || 0) + 1;
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const phrase = `${tokens[index]} ${tokens[index + 1]}`;
    counts[phrase] = (counts[phrase] || 0) + 1.75;
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const phrase = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
    counts[phrase] = (counts[phrase] || 0) + 2.2;
  }
  for (const item of semantic) {
    if (!item || item.length < 2) continue;
    counts[item] = Math.max(counts[item] || 0, item.includes(' ') ? 1.25 : 0.85);
  }

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 4) {
    const min = /[가-힣]/.test(compact) ? 2 : 3;
    const max = /[가-힣]/.test(compact) ? 4 : 5;
    for (let size = min; size <= max; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        const gram = compact.slice(index, index + size);
        counts[`char:${gram}`] = (counts[`char:${gram}`] || 0) + 0.2;
      }
    }
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
    document.title,
    document.englishTitle,
    document.englishTitle,
    document.abstract,
    document.abstract,
    document.summary,
    document.novelty,
    document.organization,
    ...(document.keywords || []),
    ...(document.keywords || []),
    ...(document.methods || []),
    ...(document.highlights || []),
    ...(document.alternateSources || []),
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizePassageText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueNonEmpty(values = []) {
  return unique(values.map((value) => normalizePassageText(value)).filter(Boolean));
}

export function buildDocumentPassages(document = {}, maxChars = 360) {
  const labeled = [
    ['title', [document.title, document.englishTitle].filter(Boolean).join(' · ')],
    ['abstract', document.abstract || ''],
    ['summary', document.summary || ''],
    ['novelty', document.novelty || ''],
    ['methods', (document.methods || []).join(' · ')],
    ['highlights', (document.highlights || []).join(' · ')],
    ['keywords', (document.keywords || []).join(' · ')]
  ];

  const passages = [];
  for (const [label, rawText] of labeled) {
    const text = normalizePassageText(rawText);
    if (!text) continue;
    if (text.length <= maxChars) {
      passages.push({ label, text });
      continue;
    }
    const sentences = text.split(/(?<=[.!?다요])\s+/).filter(Boolean);
    let current = '';
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) passages.push({ label, text: current });
      if (sentence.length <= maxChars) {
        current = sentence;
      } else {
        for (let index = 0; index < sentence.length; index += maxChars) {
          passages.push({ label, text: sentence.slice(index, index + maxChars).trim() });
        }
        current = '';
      }
    }
    if (current) passages.push({ label, text: current });
  }

  return uniqueNonEmpty(passages.map((item) => `${item.label}::${item.text}`)).map((entry) => {
    const separator = entry.indexOf('::');
    return {
      label: entry.slice(0, separator),
      text: entry.slice(separator + 2)
    };
  });
}

export function buildTermFrequency(text = '') {
  const tf = new Map();
  const sparse = buildSparseVector(text);
  for (const [term, count] of Object.entries(sparse)) {
    tf.set(term, Number(count || 0));
  }
  return tf;
}

export function averageDocumentLength(termFrequencyMaps = []) {
  if (!termFrequencyMaps.length) return 0;
  const total = termFrequencyMaps.reduce((sum, map) => sum + [...map.values()].reduce((acc, value) => acc + value, 0), 0);
  return total / termFrequencyMaps.length;
}

export function buildDocumentFrequency(termFrequencyMaps = []) {
  const df = new Map();
  for (const map of termFrequencyMaps) {
    for (const term of map.keys()) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  return df;
}

export function bm25Score(
  queryTerms = [],
  termFrequencyMap = new Map(),
  documentFrequencyMap = new Map(),
  totalDocuments = 1,
  averageLength = 1,
  options = {}
) {
  if (!queryTerms.length || !termFrequencyMap.size) return 0;
  const k1 = Number(options.k1 || 1.2);
  const b = Number(options.b || 0.75);
  const documentLength = [...termFrequencyMap.values()].reduce((sum, value) => sum + value, 0) || 1;
  let score = 0;

  for (const term of unique(queryTerms)) {
    const tf = termFrequencyMap.get(term) || 0;
    if (!tf) continue;
    const df = documentFrequencyMap.get(term) || 0;
    const idf = Math.log(1 + (totalDocuments - df + 0.5) / (df + 0.5));
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (documentLength / Math.max(1, averageLength)));
    score += idf * (numerator / denominator);
  }

  return score;
}

export function coverageRatio(tokens = [], text = '') {
  if (!tokens.length) return 0;
  const normalized = normalizeText(text);
  return tokens.filter((token) => normalized.includes(normalizeText(token))).length / tokens.length;
}

export function attachVectors(document, dimensions = 384) {
  const text = textBundle(document);
  return {
    ...document,
    vector: buildDenseVector(text, dimensions),
    sparseVector: buildSparseVector(text),
    searchText: normalizeText(text)
  };
}
