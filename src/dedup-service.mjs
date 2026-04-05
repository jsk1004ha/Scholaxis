import { normalizeText, tokenize, unique } from './vector-service.mjs';

function cleanTitle(title = '') {
  return normalizeText(title)
    .replace(/\b(arxiv|preprint|open access|poster|conference|학위논문|연구보고서)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleKey(document) {
  return cleanTitle(document.title || document.englishTitle || '').replace(/\s+/g, '');
}

function authorKey(document) {
  return unique((document.authors || []).map((author) => normalizeText(author))).slice(0, 3).join('|');
}

function jaccardFromTitles(titleA = '', titleB = '') {
  const tokensA = new Set(tokenize(titleA));
  const tokensB = new Set(tokenize(titleB));
  const all = unique([...tokensA, ...tokensB]);
  if (!all.length) return 0;
  let intersection = 0;
  for (const token of all) {
    if (tokensA.has(token) && tokensB.has(token)) intersection += 1;
  }
  return intersection / all.length;
}

function canonicalIdFor(document) {
  const explicit = document.sourceIds?.doi || document.sourceIds?.semanticScholar || document.sourceIds?.arxiv || document.id;
  return `${document.type}:${normalizeText(explicit).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')}`;
}

export function dedupeDocuments(documents = []) {
  const canonicalMap = new Map();
  const merged = [];

  for (const document of documents) {
    const directKey = document.sourceIds?.doi || titleKey(document);
    let target = canonicalMap.get(directKey);

    if (!target) {
      target = merged.find((candidate) => {
        if (candidate.type !== document.type) return false;
        const sameYear = !candidate.year || !document.year || Math.abs(candidate.year - document.year) <= 1;
        const titleSimilarity = jaccardFromTitles(candidate.title, document.title);
        const authorSimilarity = authorKey(candidate) && authorKey(candidate) === authorKey(document);
        return sameYear && (titleSimilarity >= 0.72 || authorSimilarity);
      });
    }

    if (!target) {
      const fresh = {
        ...document,
        canonicalId: canonicalIdFor(document),
        sourceIds: { ...(document.sourceIds || {}) },
        alternateSources: unique([document.source]),
        rawRecords: [document.rawRecord || null].filter(Boolean)
      };
      merged.push(fresh);
      canonicalMap.set(directKey, fresh);
      continue;
    }

    target.alternateSources = unique([...(target.alternateSources || []), document.source]);
    target.sourceIds = { ...(target.sourceIds || {}), ...(document.sourceIds || {}) };
    target.citations = Math.max(target.citations || 0, document.citations || 0);
    target.openAccess = target.openAccess || document.openAccess;
    target.links = { ...(target.links || {}), ...(document.links || {}) };
    target.keywords = unique([...(target.keywords || []), ...(document.keywords || [])]).slice(0, 12);
    target.highlights = unique([...(target.highlights || []), ...(document.highlights || [])]).slice(0, 10);
    target.methods = unique([...(target.methods || []), ...(document.methods || [])]).slice(0, 10);
    target.rawRecords = [...(target.rawRecords || []), document.rawRecord || null].filter(Boolean);
    if ((document.abstract || '').length > (target.abstract || '').length) target.abstract = document.abstract;
    if ((document.summary || '').length > (target.summary || '').length) target.summary = document.summary;
    if (!target.organization && document.organization) target.organization = document.organization;
    if (!target.englishTitle && document.englishTitle) target.englishTitle = document.englishTitle;
  }

  return merged;
}
