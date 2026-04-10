import { appConfig } from './config.mjs';
import { expandSemanticLexiconTerms } from './semantic-lexicon.mjs';
import {
  buildDocument,
  buildSourceStatus,
  expandQueryVariants,
  extractListItems,
  fetchJson,
  fetchText,
  hasBrokenEncoding,
  isGuidanceOnlyFairDocument,
  isUsableSearchText,
  normalizeAuthors,
  normalizeKeywordBag,
  looksLikeNoise,
  matchesQueryText,
  safeYear,
  stripTags,
  summarizeDocument,
  textBetween
} from './source-helpers.mjs';
import { normalizeText, unique } from './vector-service.mjs';
import { execFileSync } from 'node:child_process';
import { clearSourceCache, getCachedSourceResult, getSourceCacheDiagnostics, setCachedSourceResult } from './source-cache.mjs';

const BROWSERISH_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const experimentalLiveSourceSet = new Set((appConfig.experimentalLiveSources || []).map((item) => String(item || '').trim()).filter(Boolean));


function fetchTextWithPythonDecoding(url, { timeoutMs = 12000, userAgent = BROWSERISH_USER_AGENT } = {}) {
  const pythonScript = [
    'import ssl, urllib.request',
    'def decode_best(raw):',
    "    for enc in ('cp949','euc-kr','utf-8','latin1'):",
    '        try:',
    '            text = raw.decode(enc)',
    "            if any('가' <= ch <= '힣' for ch in text) or enc in ('utf-8','latin1'):",
    '                return text',
    '        except Exception:',
    '            continue',
    "    return raw.decode('utf-8', 'replace')",
    'ctx = ssl.create_default_context()',
    'ctx.check_hostname = False',
    'ctx.verify_mode = ssl.CERT_NONE',
    `url = ${JSON.stringify(url)}`,
    `timeout = ${Math.max(1, Math.ceil(12000 / 1000))}`,
    `user_agent = ${JSON.stringify(BROWSERISH_USER_AGENT)}`,
    "req = urllib.request.Request(url, headers={'User-Agent': user_agent})",
    'with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:',
    '    raw = resp.read()',
    'print(decode_best(raw))',
  ].join('\n');

  return execFileSync('python3', ['-c', pythonScript], { encoding: 'utf8' });
}

function sourceDetailUrl(source, query = '') {
  const encoded = encodeURIComponent(query);
  switch (source) {
    case 'semantic_scholar':
      return `https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=${encoded}`;
    case 'arxiv':
      return `https://export.arxiv.org/api/query?search_query=all:${encoded}`;
    case 'biorxiv':
      return buildPreprintSearchUrl('biorxiv', query, 10);
    case 'medrxiv':
      return buildPreprintSearchUrl('medrxiv', query, 10);
    case 'pubmed':
      return `${appConfig.pubmedSearchUrl}?term=${encoded}`;
    case 'riss':
      return `${appConfig.rissSearchUrl}?query=${encoded}`;
    case 'scienceon':
      return `${appConfig.scienceOnSearchUrl}?page=1&searchKeyword=${encoded}&prefixQuery=&collectionQuery=&showQuery=${encoded}&resultCount=10&sortName=RANK&sortOrder=DESC`;
    case 'dbpia':
      return appConfig.dbpiaApiKey
        ? `http://api.dbpia.co.kr/v2/search/search.xml?key=${encodeURIComponent(appConfig.dbpiaApiKey)}&target=se&searchall=${encoded}&pagecount=10&pagenumber=1`
        : 'https://www.dbpia.co.kr/search/';
    case 'ntis':
      return `${appConfig.ntisSearchUrl}?searchWord=${encoded}&dbt=project&sort=RANK%2FDESC`;
    case 'science_fair':
      return appConfig.scienceFairUrl;
    case 'student_invention_fair':
      return appConfig.studentInventionFairUrl;
    case 'kipris':
      return appConfig.kiprisPlusSearchUrl || appConfig.kiprisPublicSearchUrl;
    case 'kci':
      return appConfig.kciSearchUrl || 'https://www.kci.go.kr/kciportal/mobile/po/search/poTotalSearList.kci';
    case 'kiss':
      return `${appConfig.kissSearchUrl}?field=0&isDetail=N&query=${encoded}`;
    case 'nanet':
      return `${appConfig.nanetSearchUrl}?query=${encoded}`;
    case 'cve':
      return `https://nvd.nist.gov/vuln/search/results?query=${encoded}&search_type=all`;
    case 'blackhat':
      return `${appConfig.blackHatSearchUrl}?q=${encoded}`;
    case 'defcon':
      return `${appConfig.defconSearchUrl}?query=${encoded}`;
    case 'rne_report':
      return appConfig.rneReportUrl;
    default:
      return '';
  }
}

function absoluteUrl(baseUrl = '', href = '') {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function truncateText(value = '', maxLength = 320) {
  const text = stripTags(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function parseAuthorText(text = '') {
  return normalizeAuthors(
    stripTags(text)
      .replace(/\bet al\.?/gi, '')
      .replace(/\s{2,}/g, ', ')
      .replace(/\s+\|\s+/g, ', ')
  );
}

function buildPreprintSearchUrl(source, query = '', limit = 10) {
  const base = source === 'medrxiv' ? appConfig.medrxivSearchUrl : appConfig.biorxivSearchUrl;
  const trimmedBase = String(base || '').replace(/\/+$/, '');
  const suffix = encodeURIComponent(` numresults:${Math.max(limit, 10)} sort:relevance-rank`);
  return `${trimmedBase}/${encodeURIComponent(query)}${suffix}`;
}

function isExperimentalLiveSource(source = '') {
  return experimentalLiveSourceSet.has(String(source || '').trim());
}

function withExperimentalNote(source, note = '') {
  if (!isExperimentalLiveSource(source)) return note;
  return `${note}; experimental opt-in only (remove from SCHOLAXIS_EXPERIMENTAL_LIVE_SOURCES for default routing, or request the source explicitly)`;
}

function withQuery(url, param, query) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${param}=${encodeURIComponent(query)}`;
}

function buildKciSearchUrls(query) {
  const base = sourceDetailUrl('kci', query);
  if (!base) return [];
  if (base.includes('{query}')) return [base.replaceAll('{query}', encodeURIComponent(query))];

  return unique([
    withQuery(base, 'searchKeyword', query),
    withQuery(base, 'keyword', query),
    withQuery(base, 'query', query),
    withQuery(base, 'searchText', query),
    withQuery(base, 'sereArticleSearchBean.searchKeyword', query)
  ]);
}

function pickQueryForGlobal(query) {
  const variants = expandQueryVariants(query);
  return variants.slice(-1)[0] || query;
}

const FAIR_QUERY_STOPWORDS = new Set([
  '전람회',
  '과학전람회',
  '전국과학전람회',
  '발명품',
  '학생발명품경진대회',
  '전국학생과학발명품경진대회',
  '경진대회',
  '대회'
]);

function buildKoreanTokenWindows(value = '') {
  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!/^[가-힣]{4,}$/.test(compact)) return [];
  const tokens = [];
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      tokens.push(compact.slice(index, index + size));
    }
  }
  return tokens;
}

function buildScienceGoQueryVariants(query = '') {
  const raw = String(query || '').trim();
  if (!raw) return [];

  const keywordTokens = normalizeKeywordBag(raw).filter((token) => !FAIR_QUERY_STOPWORDS.has(token));
  const semanticTerms = expandSemanticLexiconTerms(keywordTokens)
    .filter((token) => token.length >= 2 && !FAIR_QUERY_STOPWORDS.has(token));
  const compactWindows = keywordTokens.flatMap((token) => buildKoreanTokenWindows(token));

  return unique([
    ...keywordTokens,
    ...semanticTerms,
    ...compactWindows,
  ]).filter(Boolean);
}

function matchesScienceGoCandidateText(text = '', query = '') {
  if (!String(query || '').trim()) return true;
  const normalizedText = normalizeText(text);
  const variants = buildScienceGoQueryVariants(query);
  if (!variants.length) return matchesQueryText(text, query);
  return variants.some((variant) => normalizedText.includes(normalizeText(variant)) || matchesQueryText(text, variant));
}

function buildScienceGoListUrl(baseUrl, query = '', page = 1) {
  const url = new URL(baseUrl);
  if (query) url.searchParams.set('searchKrwd', query);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

function buildScienceGoDetailUrl(baseUrl, nttSn, searchTerm = '', page = 1) {
  const url = new URL(baseUrl.replace('moveBbsNttList.do', 'moveBbsNttDetail.do'));
  url.searchParams.set('nttSn', nttSn);
  if (page > 1) url.searchParams.set('page', String(page));
  if (searchTerm) url.searchParams.set('searchKrwd', searchTerm);
  return url.toString();
}

export function extractScienceGoDetailFromHtml(html = '') {
  const title = stripTags(textBetween(html, '<h3>', '</h3>'));
  const contentBlock = html.match(/<div class="write-contents"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const content = stripTags(contentBlock).replace(/\s+/g, ' ').trim();
  return {
    title,
    content,
    summary: summarizeDocument({ abstract: content }),
  };
}

export function extractScienceGoDocumentsFromHtml(source, html, query = '', limit = 20, options = {}) {
  const baseUrl =
    options.baseUrl ||
    (source === 'science_fair' ? appConfig.scienceFairUrl : appConfig.studentInventionFairUrl);
  const page = options.page || 1;
  const searchTerm = options.searchTerm || '';
  const rows = [...html.matchAll(/<tbody class="singlerow"[\s\S]*?onclick="fn_moveBbsNttDetail\('([^']+)'[^"]*"[\s\S]*?<\/tbody>/g)];
  const items = [];

  for (const match of rows) {
    const nttSn = match[1];
    const block = match[0];
    const tds = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((entry) => stripTags(entry[1])).filter(Boolean);
    if (tds.length < 4) continue;

    const year = safeYear(tds[1]);
    const category = tds[2] || '';
    const title = tds[3] || '';
    const award = tds[4] || '';
    const sourceLabel = source === 'science_fair' ? '전국과학전람회' : '전국학생과학발명품경진대회';
    const candidate = buildDocument({
      id: `${source}:${nttSn}`,
      source,
      sourceLabel,
      type: 'fair_entry',
      title,
      englishTitle: title,
      authors: [],
      organization: sourceLabel,
      year,
      abstract: '',
      summary: `${category} / ${award || '수상 정보 미상'} 항목입니다.`,
      keywords: normalizeKeywordBag(`${title} ${category} ${award} ${sourceLabel}`).slice(0, 8),
      highlights: [category, award].filter(Boolean),
      links: {
        detail: buildScienceGoDetailUrl(baseUrl, nttSn, searchTerm, page),
        original: buildScienceGoDetailUrl(baseUrl, nttSn, searchTerm, page)
      },
      rawRecord: { nttSn, tds, page, searchTerm }
    });

    if (isGuidanceOnlyFairDocument(candidate)) continue;
    const searchableText = [title, category, award, sourceLabel].filter(Boolean).join(' ');
    if (query && !matchesScienceGoCandidateText(searchableText, query)) continue;

    items.push(candidate);
    if (items.length >= limit) break;
  }

  return items;
}

async function enrichScienceGoDocument(document = {}) {
  if (!document?.links?.detail) return document;
  try {
    const html = await fetchText(document.links.detail, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
    const detail = extractScienceGoDetailFromHtml(html);
    const abstract = detail.content || document.abstract || '';
    return {
      ...document,
      title: detail.title || document.title,
      englishTitle: detail.title || document.englishTitle,
      abstract,
      summary: detail.summary || document.summary,
      keywords: normalizeKeywordBag([
        detail.title || document.title,
        abstract,
        document.organization,
        ...(document.highlights || []),
      ].filter(Boolean).join(' ')).slice(0, 8),
      rawRecord: {
        ...(document.rawRecord || {}),
        detailFetched: true,
      }
    };
  } catch {
    return document;
  }
}

export function extractPreprintDocumentsFromHtml(source, html = '', query = '', limit = 10, searchUrl = '') {
  const baseUrl =
    source === 'medrxiv'
      ? 'https://www.medrxiv.org'
      : 'https://www.biorxiv.org';
  const blocks = html
    .split(/<div[^>]+class="[^"]*highwire-cite[^"]*"[^>]*>/i)
    .slice(1)
    .map((block) => block.split(/<div[^>]+class="[^"]*highwire-cite-extras[^"]*"[^>]*>/i)[0]);
  const sourceLabel = source === 'medrxiv' ? 'medRxiv' : 'bioRxiv';
  const documents = [];

  for (const block of blocks) {
    const href = absoluteUrl(baseUrl, block.match(/<a[^>]+href="([^"]*\/content\/[^"]+)"[^>]*>/i)?.[1] || '');
    const title =
      stripTags(block.match(/<span[^>]+class="[^"]*highwire-cite-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]) ||
      stripTags(block.match(/<a[^>]+href="[^"]*\/content\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)?.[1]);
    if (!href || !title) continue;
    const authors = parseAuthorText(block.match(/<span[^>]+class="[^"]*highwire-cite-authors[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const abstract =
      stripTags(block.match(/<div[^>]+class="[^"]*(?:highwire-cite-snippet|highwire-cite-abstract)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const doi = block.match(/\b10\.1101\/[0-9A-Za-z./-]+/i)?.[0] || '';
    const metaText = stripTags(block);
    const searchableText = [title, abstract, authors.join(' '), metaText].filter(Boolean).join(' ');
    if (query && !matchesQueryText(searchableText, query)) continue;

    documents.push(
      buildDocument({
        id: `${source}:${doi || href}`,
        source,
        sourceLabel,
        type: 'paper',
        title,
        englishTitle: title,
        authors,
        organization: sourceLabel,
        year: safeYear(metaText),
        citations: 0,
        openAccess: true,
        language: 'en',
        abstract,
        summary: summarizeDocument({ abstract }),
        keywords: normalizeKeywordBag(`${query} ${title} ${abstract}`).slice(0, 8),
        sourceIds: { doi: doi || null },
        links: {
          detail: href,
          original: href || searchUrl,
          pdf: href ? `${href}.full.pdf` : null
        },
        rawRecord: {
          doi,
          href,
          metaText,
        }
      })
    );

    if (documents.length >= limit) break;
  }

  return documents;
}

export function extractPubMedDocumentsFromXml(xml = '', query = '', limit = 10) {
  const articles = parseXmlItems(xml, 'PubmedArticle');
  return articles
    .map((item) => {
      const pmid = xmlValue(item, 'PMID');
      const title = stripTags(textBetween(item, '<ArticleTitle>', '</ArticleTitle>'));
      if (!pmid || !title) return null;
      const abstractParts = [...item.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((match) => stripTags(match[1])).filter(Boolean);
      const abstract = abstractParts.join(' ');
      const authors = [
        ...item.matchAll(/<Author>([\s\S]*?)<\/Author>/g)
      ].map((match) => {
        const block = match[1];
        const collective = xmlValue(block, 'CollectiveName');
        if (collective) return collective;
        const foreName = xmlValue(block, 'ForeName');
        const lastName = xmlValue(block, 'LastName');
        return [foreName, lastName].filter(Boolean).join(' ').trim();
      }).filter(Boolean);
      const journal = xmlValue(item, 'Title') || xmlValue(item, 'ISOAbbreviation') || 'PubMed';
      const doi = [...item.matchAll(/<ArticleId[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/g)].map((match) => stripTags(match[1])).find(Boolean) || '';
      return buildDocument({
        id: `pubmed:${pmid}`,
        source: 'pubmed',
        sourceLabel: 'PubMed',
        type: 'paper',
        title,
        englishTitle: title,
        authors,
        organization: journal,
        year: safeYear(item),
        citations: 0,
        openAccess: false,
        language: 'en',
        abstract,
        summary: summarizeDocument({ abstract }),
        keywords: normalizeKeywordBag(`${query} ${title} ${abstract}`).slice(0, 8),
        sourceIds: {
          pubmed: pmid,
          doi: doi || null
        },
        links: {
          detail: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          original: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        },
        rawRecord: { pmid, doi }
      });
    })
    .filter(Boolean)
    .slice(0, limit);
}

export function extractCveDocumentsFromPayload(payload = {}, query = '', limit = 10) {
  return (payload.vulnerabilities || [])
    .map((entry) => entry.cve || null)
    .filter(Boolean)
    .map((cve) => {
      const description =
        (cve.descriptions || []).find((item) => item.lang === 'en')?.value ||
        (cve.descriptions || [])[0]?.value ||
        '';
      const severity =
        cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ||
        cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseSeverity ||
        cve.metrics?.cvssMetricV2?.[0]?.baseSeverity ||
        '';
      const references = (cve.references || []).map((item) => item.url).filter(Boolean);
      const highlights = [severity, ...(cve.weaknesses || []).flatMap((item) => (item.description || []).map((desc) => desc.value).filter(Boolean))].filter(Boolean);
      return buildDocument({
        id: `cve:${cve.id}`,
        source: 'cve',
        sourceLabel: 'CVE / NVD',
        type: 'report',
        title: cve.id,
        englishTitle: cve.id,
        authors: [],
        organization: 'NVD',
        year: safeYear(cve.published),
        citations: 0,
        openAccess: true,
        language: 'en',
        abstract: description,
        summary: summarizeDocument({ abstract: description }),
        keywords: normalizeKeywordBag(`${query} ${cve.id} ${description}`).slice(0, 8),
        highlights: highlights.slice(0, 4),
        sourceIds: { cve: cve.id },
        links: {
          detail: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          original: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          references: references[0] || null
        },
        rawRecord: {
          severity,
          published: cve.published,
          references,
        }
      });
    })
    .slice(0, limit);
}

export function extractKissDocumentsFromHtml(html = '', query = '', limit = 10, sourceUrl = appConfig.kissSearchUrl) {
  const documents = [];
  const seen = new Set();
  const matches = [...html.matchAll(/<a[^>]+href="([^"]*\/Detail(?:Oa)?\/Ar\?key=[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+href="[^"]*\/Detail(?:Oa)?\/Ar\?key=|$)/g)];

  for (const match of matches) {
    const detail = absoluteUrl('https://kiss.kstudy.com', match[1]);
    const key = detail.match(/key=([^&]+)/)?.[1] || detail;
    if (seen.has(key)) continue;
    seen.add(key);

    const title = stripTags(match[2]);
    const meta = stripTags(match[3]);
    if (!title || (query && !matchesQueryText(`${title} ${meta}`, query))) continue;

    documents.push(
      buildDocument({
        id: `kiss:${key}`,
        source: 'kiss',
        sourceLabel: 'KISS',
        type: /학위논문/.test(meta) ? 'thesis' : 'paper',
        title,
        englishTitle: title,
        authors: parseAuthorText(meta),
        organization: 'KISS',
        year: safeYear(meta),
        abstract: '',
        summary: `KISS 검색 결과에서 수집한 항목입니다.`,
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        links: {
          detail,
          original: detail,
          sourceApiUrl: sourceUrl
        },
        rawRecord: { meta }
      })
    );

    if (documents.length >= limit) break;
  }

  return documents;
}

export function extractNanetDocumentsFromHtml(html = '', query = '', limit = 10, sourceUrl = appConfig.nanetSearchUrl) {
  const documents = [];
  const seen = new Set();
  const matches = [
    ...html.matchAll(/<a[^>]+href="([^"]*(?:SearchDetailView\.do\?cn=[^"]+|\/detail\/[A-Z0-9]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+href="[^"]*(?:SearchDetailView\.do\?cn=|\/detail\/[A-Z0-9]+)|$)/g),
    ...html.matchAll(/<a[^>]+href="([^"]*\/detail\/[A-Z0-9]+[^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+href="[^"]*\/detail\/[A-Z0-9]+|$)/g)
  ];

  for (const match of matches) {
    const detail = absoluteUrl('https://dl.nanet.go.kr', match[1]);
    const cn = detail.match(/cn=([^&]+)/)?.[1] || detail.match(/\/detail\/([^/?#]+)/)?.[1] || detail;
    if (seen.has(cn)) continue;
    seen.add(cn);

    const title = stripTags(match[2]);
    const meta = stripTags(match[3]);
    if (!title || (query && !matchesQueryText(`${title} ${meta}`, query))) continue;

    documents.push(
      buildDocument({
        id: `nanet:${cn}`,
        source: 'nanet',
        sourceLabel: '국회도서관',
        type: /학위논문|박사|석사/.test(meta) ? 'thesis' : 'report',
        title,
        englishTitle: title,
        authors: parseAuthorText(meta),
        organization: '국회도서관',
        year: safeYear(meta),
        abstract: '',
        summary: `국회도서관 검색 결과에서 수집한 항목입니다.`,
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        links: {
          detail,
          original: detail,
          sourceApiUrl: sourceUrl
        },
        rawRecord: { meta }
      })
    );

    if (documents.length >= limit) break;
  }

  return documents;
}

export function extractBlackHatDocumentsFromHtml(html = '', query = '', limit = 10, sourceUrl = '') {
  const documents = [];
  const seen = new Set();
  const matches = [...html.matchAll(/<a[^>]+href="([^"]*\/briefings\/[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,2000}?)(?=<a[^>]+href="[^"]*\/briefings\/|$)/g)];

  for (const match of matches) {
    const detail = absoluteUrl(sourceUrl || 'https://www.blackhat.com', match[1]);
    const title = stripTags(match[2]);
    const meta = stripTags(match[3]);
    if (!title || seen.has(detail)) continue;
    if (query && !matchesQueryText(`${title} ${meta}`, query)) continue;
    seen.add(detail);

    documents.push(
      buildDocument({
        id: `blackhat:${detail}`,
        source: 'blackhat',
        sourceLabel: 'Black Hat Archive',
        type: 'report',
        title,
        englishTitle: title,
        authors: parseAuthorText(meta),
        organization: 'Black Hat',
        year: safeYear(meta) || safeYear(detail),
        abstract: truncateText(meta, 420),
        summary: summarizeDocument({ abstract: truncateText(meta, 420) }),
        keywords: normalizeKeywordBag(`${query} ${title} ${meta}`).slice(0, 8),
        openAccess: true,
        language: 'en',
        links: {
          detail,
          original: detail
        },
        rawRecord: { meta }
      })
    );

    if (documents.length >= limit) break;
  }

  return documents;
}

export function extractDefconDocumentsFromHtml(html = '', query = '', limit = 10, sourceUrl = '') {
  const documents = [];
  const seen = new Set();
  const matches = [...html.matchAll(/<a[^>]+href="([^"]*(?:\/node\/\d+|\/thread\/[^"]+))"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1500}?)(?=<a[^>]+href="[^"]*(?:\/node\/\d+|\/thread\/)|$)/g)];

  for (const match of matches) {
    const detail = absoluteUrl(sourceUrl || 'https://forum.defcon.org', match[1]);
    const title = stripTags(match[2]);
    const meta = stripTags(match[3]);
    if (!title || seen.has(detail)) continue;
    if (query && !matchesQueryText(`${title} ${meta}`, query)) continue;
    seen.add(detail);

    documents.push(
      buildDocument({
        id: `defcon:${detail}`,
        source: 'defcon',
        sourceLabel: 'DEF CON Archive',
        type: 'report',
        title,
        englishTitle: title,
        authors: parseAuthorText(meta),
        organization: 'DEF CON',
        year: safeYear(meta) || safeYear(detail),
        abstract: truncateText(meta, 420),
        summary: summarizeDocument({ abstract: truncateText(meta, 420) }),
        keywords: normalizeKeywordBag(`${query} ${title} ${meta}`).slice(0, 8),
        openAccess: true,
        language: 'en',
        links: {
          detail,
          original: detail
        },
        rawRecord: { meta }
      })
    );

    if (documents.length >= limit) break;
  }

  return documents;
}

async function searchPreprintServer(source, query, limit) {
  const url = buildPreprintSearchUrl(source, query, limit);
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  return extractPreprintDocumentsFromHtml(source, html, query, limit, url);
}

async function searchPubMed(query, limit) {
  const esearchUrl = `${appConfig.pubmedEutilsUrl}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${limit}&term=${encodeURIComponent(query)}`;
  const payload = await fetchJson(esearchUrl, { timeoutMs: 9000 });
  const ids = payload?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const efetchUrl = `${appConfig.pubmedEutilsUrl}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=${ids.join(',')}`;
  const xml = await fetchText(efetchUrl, { accept: 'application/xml', timeoutMs: 9000 });
  return extractPubMedDocumentsFromXml(xml, query, limit);
}

async function searchCve(query, limit) {
  const url = `${appConfig.nvdCveApiUrl}?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=${limit}`;
  const payload = await fetchJson(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  return extractCveDocumentsFromPayload(payload, query, limit);
}

async function searchKiss(query, limit) {
  const url = `${appConfig.kissSearchUrl}?field=0&isDetail=N&query=${encodeURIComponent(query)}`;
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  return extractKissDocumentsFromHtml(html, query, limit, url);
}

async function searchNanet(query, limit) {
  const url = `${appConfig.nanetSearchUrl}?query=${encodeURIComponent(query)}`;
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  return extractNanetDocumentsFromHtml(html, query, limit, url);
}

async function searchBlackHat(query, limit) {
  const matched = [];
  const seen = new Set();
  for (const url of appConfig.blackHatArchiveUrls || []) {
    const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
    const docs = extractBlackHatDocumentsFromHtml(html, query, limit, url);
    for (const document of docs) {
      if (seen.has(document.id)) continue;
      seen.add(document.id);
      matched.push(document);
      if (matched.length >= limit) return matched;
    }
  }
  return matched;
}

async function searchDefcon(query, limit) {
  const url = `${appConfig.defconSearchUrl}?query=${encodeURIComponent(query)}`;
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  return extractDefconDocumentsFromHtml(html, query, limit, url);
}

async function searchSemanticScholar(query, limit) {
  const queryVariant = pickQueryForGlobal(query);
  const url = `https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=${encodeURIComponent(queryVariant)}&limit=${limit}&fields=title,abstract,year,authors,citationCount,openAccessPdf,url,venue,publicationVenue,externalIds`;
  const headers = appConfig.semanticScholarApiKey ? { 'x-api-key': appConfig.semanticScholarApiKey } : {};
  const payload = await fetchJson(url, { headers, timeoutMs: 7000 });
  return (payload.data || []).map((item) =>
    buildDocument({
      id: `semantic_scholar:${item.paperId || item.externalIds?.DOI || item.title}`,
      source: 'semantic_scholar',
      sourceLabel: 'Semantic Scholar',
      type: 'paper',
      title: stripTags(item.title),
      englishTitle: stripTags(item.title),
      authors: (item.authors || []).map((author) => author.name).filter(Boolean),
      organization: stripTags(item.publicationVenue?.name || item.venue || ''),
      year: item.year || null,
      citations: item.citationCount || 0,
      openAccess: Boolean(item.openAccessPdf?.url),
      abstract: stripTags(item.abstract),
      summary: summarizeDocument({ abstract: item.abstract }),
      keywords: normalizeKeywordBag([query, queryVariant, item.title, item.abstract].join(' ')).slice(0, 8),
      sourceIds: {
        semanticScholar: item.paperId || null,
        doi: item.externalIds?.DOI || null
      },
      links: {
        detail: item.url || sourceDetailUrl('semantic_scholar', queryVariant),
        original: item.url || sourceDetailUrl('semantic_scholar', queryVariant),
        pdf: item.openAccessPdf?.url || null
      },
      rawRecord: item
    })
  );
}

function parseArxivEntries(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((entryMatch) => {
    const entry = entryMatch[1];
    const title = stripTags(textBetween(entry, '<title>', '</title>'));
    const abstract = stripTags(textBetween(entry, '<summary>', '</summary>'));
    const id = stripTags(textBetween(entry, '<id>', '</id>'));
    const published = stripTags(textBetween(entry, '<published>', '</published>'));
    const pdfLinkMatch = entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/i);
    const authors = [...entry.matchAll(/<author>\s*<name>(.*?)<\/name>\s*<\/author>/g)].map((match) => stripTags(match[1]));
    return { title, abstract, id, published, pdf: pdfLinkMatch?.[1] || null, authors };
  });
}

async function searchArxiv(query, limit) {
  const queryVariant = pickQueryForGlobal(query);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(queryVariant)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
  const xml = await fetchText(url, { accept: 'application/atom+xml', timeoutMs: 7000 });
  return parseArxivEntries(xml).map((item) =>
    buildDocument({
      id: `arxiv:${item.id}`,
      source: 'arxiv',
      sourceLabel: 'arXiv',
      type: 'paper',
      title: item.title,
      englishTitle: item.title,
      authors: item.authors,
      organization: 'arXiv',
      year: safeYear(item.published),
      citations: 0,
      openAccess: true,
      language: 'en',
      abstract: item.abstract,
      summary: summarizeDocument({ abstract: item.abstract }),
      keywords: normalizeKeywordBag([query, queryVariant, item.title, item.abstract].join(' ')).slice(0, 8),
      sourceIds: { arxiv: item.id },
      links: {
        detail: item.id,
        original: item.id,
        pdf: item.pdf
      },
      rawRecord: item
    })
  );
}

async function searchRiss(query, limit) {
  const url = `${appConfig.rissSearchUrl}?query=${encodeURIComponent(query)}`;
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  const catalogMatches = [...html.matchAll(/<div class="catalog">([\s\S]*?)<\/div>\s*<\/div>\s*(?:<!--|$)/g)];
  const typeMap = {
    '국내학술논문': 'paper',
    '해외학술논문': 'paper',
    '학위논문': 'thesis',
    '연구보고서': 'report'
  };
  const documents = [];

  for (const match of catalogMatches) {
    const block = match[1];
    const headingMatch = block.match(/<h3>(.*?)<span class="moreCnt">/s);
    const heading = stripTags(headingMatch?.[1] || '');
    const type = typeMap[heading];
    if (!type) continue;

    const itemMatches = [...block.matchAll(/<li>[\s\S]*?<p class="title"><a href="([^"]+DetailView\.do[^"]*)">([\s\S]*?)<\/a><\/p>[\s\S]*?<p class="etc">([\s\S]*?)<\/p>/g)];
    for (const item of itemMatches.slice(0, limit)) {
      const detailHref = item[1];
      const title = stripTags(item[2]);
      const etcText = stripTags(item[3]);
      const spans = [...item[3].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((entry) => stripTags(entry[1])).filter(Boolean);
      const author = spans[0] || '';
      const org = spans[1] || 'RISS';
      const venue = spans[3] || spans[2] || '';
      documents.push(
        buildDocument({
          id: `riss:${type}:${detailHref}`,
          source: 'riss',
          sourceLabel: 'RISS',
          type,
          title,
          englishTitle: title,
          authors: normalizeAuthors(author),
          organization: [org, venue].filter(Boolean).join(' · ') || 'RISS',
          year: safeYear(etcText),
          abstract: '',
          summary: `${heading} 검색 결과에서 수집한 항목입니다.`,
          keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
          links: {
            detail: detailHref.startsWith('http') ? detailHref : `https://www.riss.kr${detailHref}`,
            original: detailHref.startsWith('http') ? detailHref : `https://www.riss.kr${detailHref}`
          },
          rawRecord: { heading, detailHref, etcText }
        })
      )
    }
  }

  return documents.slice(0, limit);
}

async function searchScienceOn(query, limit) {
  const url = `${appConfig.scienceOnSearchUrl}?page=1&searchKeyword=${encodeURIComponent(query)}&prefixQuery=&collectionQuery=&showQuery=${encodeURIComponent(query)}&resultCount=${limit}&sortName=RANK&sortOrder=DESC`;
  const html = fetchTextWithPythonDecoding(url, { timeoutMs: 12000, userAgent: BROWSERISH_USER_AGENT });
  const rows = [];
  const matches = [...html.matchAll(/setSrchCookieDetail\('\d+','([\s\S]*?)',\s*'([^']+)'\);[\s\S]{0,200}?fncArticleDetail\('([^']+)'\);[\s\S]{0,1200}?<p class="info mgt5px">([\s\S]*?)<\/p>/g)];

  for (const match of matches.slice(0, limit * 2)) {
    const titleHtml = match[1];
    const cn = match[2];
    const cnDetail = match[3];
    const infoHtml = match[4];
    if (cn !== cnDetail) continue;
    const title = stripTags(titleHtml).replace(/^\s+|\s+$/g, '');
    if (!title) continue;
    const authorText = stripTags((infoHtml.split(/<br\s*\/?/i)[0] || infoHtml)).split(/\s{2,}|\n/)[0] || '';
    rows.push(
      buildDocument({
        id: `scienceon:${cn}`,
        source: 'scienceon',
        sourceLabel: 'ScienceON',
        type: 'paper',
        title,
        englishTitle: title,
        authors: normalizeAuthors(authorText),
        organization: 'ScienceON',
        year: safeYear(infoHtml),
        abstract: '',
        summary: 'ScienceON 검색 결과에서 수집한 항목입니다.',
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        sourceIds: { scienceon: cn },
        links: {
          detail: `https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=${cn}`,
          original: `https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=${cn}`
        },
        rawRecord: { cn, titleHtml, infoHtml }
      })
    );
  }

  return rows.slice(0, limit);
}


function buildKiprisDetailLink(query = '', rawId = '', title = '') {
  const base = 'https://www.kipris.or.kr/kportal/search/total_search.do';
  const params = new URLSearchParams();
  params.set('queryText', title || query || rawId || '');
  params.set('query', title || query || rawId || '');
  if (rawId) params.set('patentNumber', rawId);
  return `${base}?${params.toString()}`;
}

function parseXmlItems(xml, itemTag = 'item') {
  return [...xml.matchAll(new RegExp(`<${itemTag}>([\\s\\S]*?)<\\/${itemTag}>`, 'g'))].map((match) => match[1]);
}

function xmlValue(block, tag) {
  return stripTags(textBetween(block, `<${tag}>`, `</${tag}>`));
}

async function searchKiprisPublic(query, limit) {
  const pythonScript = [
    'import urllib.parse, urllib.request, http.cookiejar',
    'def decode_best(raw):',
    "    for enc in ('cp949','euc-kr','utf-8','latin1'):",
    '        try:',
    '            text = raw.decode(enc)',
    "            if any('\\uac00' <= ch <= '\\ud7a3' for ch in text) or enc in ('utf-8','latin1'):",
    '                return text',
    '        except Exception:',
    '            continue',
    "    return raw.decode('utf-8', 'replace')",
    'jar=http.cookiejar.CookieJar()',
    'opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))',
    `query=${JSON.stringify(query)}`,
    `limit=${Number(limit)}`,
    "base='https://www.kipris.or.kr/kportal/search/total_search.do'",
    "params={'queryText':query,'query':query,'expression':query,'pageNum':'1'}",
    "headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.kipris.or.kr/kportal/search/search_patent.do'}",
    'req=urllib.request.Request(base,data=urllib.parse.urlencode(params).encode(),headers=headers)',
    'opener.open(req, timeout=20).read()',
    "api='https://www.kipris.or.kr/kportal/resulta.do'",
    "payload={'next':'patentList','FROM':'SEARCH','searchInTransKorToEng':'N','searchInTransEngToKor':'N','row':str(limit),'queryText':query,'expression':query}",
    "req2=urllib.request.Request(api,data=urllib.parse.urlencode(payload).encode(),headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.kipris.or.kr/kportal/search/total_search.do'})",
    'raw = opener.open(req2, timeout=20).read()',
    'print(decode_best(raw))'
  ].join('\n');

  const { execFileSync } = await import('node:child_process');
  const xml = execFileSync('python3', ['-c', pythonScript], { encoding: 'utf8' });
  return parseXmlItems(xml, 'article')
    .map((item) => {
      const title = xmlValue(item, 'TTL') || xmlValue(item, 'TLV');
      const englishTitle = xmlValue(item, 'TLT') || xmlValue(item, 'TTL');
      const abstract = xmlValue(item, 'ABV') || '';
      const bestTitle = isUsableSearchText(title, query)
        ? title
        : isUsableSearchText(englishTitle, query)
          ? englishTitle
          : '';
      if (!bestTitle) return null;
      const safeAbstract = hasBrokenEncoding(abstract) || looksLikeNoise(abstract) ? '' : abstract;
      return buildDocument({
        id: `kipris:${xmlValue(item, 'VdkVgwKey') || xmlValue(item, 'GNV') || query}`,
        source: 'kipris',
        sourceLabel: 'KIPRIS',
        type: 'patent',
        title: bestTitle,
        englishTitle: isUsableSearchText(englishTitle, query) ? englishTitle : bestTitle,
        authors: normalizeAuthors(xmlValue(item, 'INV')),
        organization: xmlValue(item, 'APV'),
        year: safeYear(xmlValue(item, 'GDV') || xmlValue(item, 'ADV')),
        abstract: safeAbstract,
        summary: summarizeDocument({ abstract: safeAbstract, summary: bestTitle }),
        keywords: normalizeKeywordBag(`${query} ${bestTitle} ${englishTitle}`).slice(0, 8),
        openAccess: false,
        sourceIds: { kipris: xmlValue(item, 'VdkVgwKey') || xmlValue(item, 'GNV') || null },
        links: {
          detail: buildKiprisDetailLink(query, xmlValue(item, 'VdkVgwKey') || xmlValue(item, 'GNV') || '', bestTitle),
          original: buildKiprisDetailLink(query, xmlValue(item, 'VdkVgwKey') || xmlValue(item, 'GNV') || '', bestTitle),
          image: xmlValue(item, 'src') || null
        },
        rawRecord: item
      });
    })
    .filter(Boolean)
    .slice(0, limit);
}

async function searchKipris(query, limit) {
  if (appConfig.kiprisPlusSearchUrl && appConfig.kiprisPlusApiKey) {
    try {
      return await searchConfiguredXmlApi('kipris', query, limit);
    } catch {
      // fall through to public-site fallback
    }
  }
  return searchKiprisPublic(query, limit);
}

async function searchDbpia(query, limit) {
  const titleCleaner = (value = '') => stripTags(value.replace(/<!HS>|<!HE>/g, ''));

  if (appConfig.dbpiaApiKey) {
    const url = `http://api.dbpia.co.kr/v2/search/search.xml?key=${encodeURIComponent(appConfig.dbpiaApiKey)}&target=se&searchall=${encodeURIComponent(query)}&pagecount=${limit}&pagenumber=1`;
    const xml = await fetchText(url, { accept: 'application/xml', timeoutMs: 9000 });
    return parseXmlItems(xml).map((item) =>
      buildDocument({
        id: `dbpia:${xmlValue(item, 'link_url') || xmlValue(item, 'title')}`,
        source: 'dbpia',
        sourceLabel: 'DBpia',
        type: xmlValue(item, 'ctype') === 'article' ? 'paper' : 'report',
        title: xmlValue(item, 'title'),
        englishTitle: xmlValue(item, 'title'),
        authors: normalizeAuthors(
          item
            .replace(/<author[^>]*>/g, '<author-name>')
            .replace(/<\/author>/g, '</author-name>')
            .match(/<author-name>(.*?)<\/author-name>/g)?.join(', ') || ''
        ),
        organization: xmlValue(item, 'publisher'),
        year: safeYear(xmlValue(item, 'issue') || xmlValue(item, 'publication')),
        abstract: '',
        summary: 'DBpia OpenAPI 검색 결과입니다.',
        keywords: normalizeKeywordBag(`${query} ${xmlValue(item, 'title')}`).slice(0, 8),
        links: {
          detail: xmlValue(item, 'link_url'),
          original: xmlValue(item, 'link_url'),
          api: xmlValue(item, 'link_api')
        },
        rawRecord: item
      })
    );
  }

  const pageUrl = `https://www.dbpia.co.kr/search/topSearch?searchOption=all&query=${encodeURIComponent(query)}`;
  const html = await fetchText(pageUrl, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  const keyMatch = html.match(/const searchResultKey = '([^']+)'/);
  if (!keyMatch) return [];

  const body = {
    query,
    page: 1,
    pageSize: limit,
    subjectCodes: [],
    pbshYears: [],
    plctNames: [],
    dataTypes: [],
    publicationInfos: [],
    sort: 'RANK',
    collection: 'ALL',
    includeAr: false,
    collectionQuery: [],
    filter: [],
    prefix: [],
    realQuery: '',
    startDate: '1970.01.01',
    endDate: '',
    originText: false,
    subjectCategory: ''
  };

  const payload = await fetchJson('https://www.dbpia.co.kr/api/search/list', {
    timeoutMs: 9000,
    userAgent: BROWSERISH_USER_AGENT,
    headers: {
      'content-type': 'application/json',
      'x-jsp-key': keyMatch[1],
      referer: pageUrl,
      origin: 'https://www.dbpia.co.kr',
      'x-requested-with': 'XMLHttpRequest'
    },
    method: 'POST',
    body: JSON.stringify(body)
  });

  return (payload.list || []).map((item) =>
    buildDocument({
      id: `dbpia:${item.nodeId || item.publicationId || item.nodeTitle}`,
      source: 'dbpia',
      sourceLabel: 'DBpia',
      type: item.labels?.nodeType?.includes('학위') ? 'thesis' : item.abstractText ? 'paper' : 'report',
      title: titleCleaner(item.nodeTitle),
      englishTitle: titleCleaner(item.nodeTitle),
      authors: (item.authors || []).map((author) => titleCleaner(author.autrNm)).filter(Boolean),
      organization: titleCleaner(item.plctNm || item.iprdNm || ''),
      year: safeYear(item.publishYymm),
      abstract: titleCleaner(item.abstractText || ''),
      summary: summarizeDocument({ abstract: titleCleaner(item.abstractText || ''), summary: '' }),
      keywords: normalizeKeywordBag(`${query} ${item.nodeTitle} ${(item.searchKeywords || []).join(' ')}`).slice(0, 8),
      sourceIds: { dbpia: item.nodeId || null },
      openAccess: false,
      links: {
        detail: item.nodeId ? `https://www.dbpia.co.kr/journal/articleDetail?nodeId=${item.nodeId}` : pageUrl,
        original: item.nodeId ? `https://www.dbpia.co.kr/journal/articleDetail?nodeId=${item.nodeId}` : pageUrl,
        sourceApiUrl: 'https://www.dbpia.co.kr/api/search/list'
      },
      rawRecord: item
    })
  );
}

const NTIS_EXCLUDED_ROW_PATTERNS = [
  /검색결과가 없습니다/,
  /철자가 정확한지/,
  /다른 검색어로 검색해 보세요/,
  /같은 뜻의 다른 단어/,
  /선택한 조건에 대한/,
  /^ntis$/i,
  /^myntis$/i,
  /검색목록 다운로드/,
];

function isNtisCandidateTitle(text = '') {
  const value = stripTags(text).replace(/\s+/g, ' ').trim();
  if (value.length < 4 || value.length > 160) return false;
  if (NTIS_EXCLUDED_ROW_PATTERNS.some((pattern) => pattern.test(value))) return false;
  return true;
}

export function extractNtisDocumentsFromHtml(html = '', query = '', limit = 10, url = appConfig.ntisSearchUrl) {
  const anchorRows = [...html.matchAll(/<a[^>]+(?:href|onclick)[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => stripTags(match[1]))
    .filter((item) => isNtisCandidateTitle(item))
    .filter((item) => isUsableSearchText(item, query));
  const listRows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    .map((match) => stripTags(match[1]))
    .filter((item) => isNtisCandidateTitle(item))
    .filter((item) => isUsableSearchText(item, query));
  const rows = unique([...anchorRows, ...listRows]).slice(0, limit);

  return rows.map((title) =>
    buildDocument({
      id: `ntis:${title}`,
      source: 'ntis',
      sourceLabel: 'NTIS',
      type: 'report',
      title,
      englishTitle: title,
      authors: [],
      organization: 'NTIS',
      year: null,
      abstract: '',
      summary: 'NTIS 검색 결과에서 수집한 국가 R&D 과제/성과 후보입니다.',
      keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
      links: {
        detail: url,
        original: url
      },
      rawRecord: { title }
    })
  );
}

async function searchNtis(query, limit) {
  const url = `${appConfig.ntisSearchUrl}?searchWord=${encodeURIComponent(query)}&dbt=project&sort=RANK%2FDESC`;
  let html = '';
  try {
    html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  } catch {
    html = fetchTextWithPythonDecoding(url, { timeoutMs: 12000, userAgent: BROWSERISH_USER_AGENT });
  }
  return extractNtisDocumentsFromHtml(html, query, limit, url);
}

async function searchScienceGo(source, query, limit) {
  const baseUrl =
    source === 'science_fair'
      ? appConfig.scienceFairUrl
      : appConfig.studentInventionFairUrl;
  const searchTerms = query ? buildScienceGoQueryVariants(query).slice(0, 6) : [''];
  const matched = [];
  const seen = new Set();
  const maxPages = query ? 6 : 1;

  for (const searchTerm of searchTerms.length ? searchTerms : ['']) {
    for (let page = 1; page <= maxPages && matched.length < limit; page += 1) {
      const url = buildScienceGoListUrl(baseUrl, searchTerm, page);
      const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
      const docs = extractScienceGoDocumentsFromHtml(source, html, query, Math.max(limit * 2, 12), {
        baseUrl,
        page,
        searchTerm,
      });
      if (!docs.length && searchTerm) break;
      for (const doc of docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        matched.push(doc);
        if (matched.length >= limit) break;
      }
    }
    if (matched.length >= limit) break;
  }

  const enrichCount = Math.min(matched.length, Math.max(limit, 4));
  const enrichedHead = await Promise.all(matched.slice(0, enrichCount).map((document) => enrichScienceGoDocument(document)));
  const enrichedMap = new Map(enrichedHead.map((document) => [document.id, document]));
  return matched.map((document) => enrichedMap.get(document.id) || document).slice(0, limit);
}

export function extractRneReportDocumentsFromHtml(html, query = '') {
  const documents = [];
  const seen = new Set();
  const matches = [...html.matchAll(/<a[^>]+href="(http:\/\/www\.rne\.or\.kr\/gnuboard5\/rs_report\/\d+)"[^>]*>([\s\S]*?)<\/a>/g)];

  for (const match of matches) {
    const href = match[1];
    const title = stripTags(match[2]);
    if (!href || !title || title === '글쓰기') continue;
    const idMatch = href.match(/\/(\d+)$/);
    const reportId = idMatch?.[1];
    if (!reportId || seen.has(reportId)) continue;
    seen.add(reportId);

    const searchable = `${title}`.toLowerCase();
    if (query && !searchable.includes(String(query).toLowerCase()) && documents.length >= 12) continue;

    documents.push(
      buildDocument({
        id: `rne_report:${reportId}`,
        source: 'rne_report',
        sourceLabel: 'R&E 보고서',
        type: 'report',
        title,
        englishTitle: title,
        authors: [],
        organization: '과학영재 창의연구(R&E) 지원센터',
        year: safeYear(title),
        abstract: '',
        summary: '과학영재 창의연구(R&E) 지원센터 중간성과공유회 보고서 목록에서 수집한 연구 제목입니다.',
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        highlights: ['R&E', '중간성과공유회 보고서'],
        links: {
          detail: href,
          original: href
        },
        rawRecord: { href, title }
      })
    );
  }

  return documents;
}

async function searchRneReports(query, limit) {
  const baseUrl = appConfig.rneReportUrl.replace('/bbs/board.php?bo_table=rs_report', '/rs_report');
  const matched = [];
  const seen = new Set();
  const maxPages = 6;

  for (let page = 1; page <= maxPages && matched.length < limit; page += 1) {
    const url = page === 1 ? `${baseUrl}` : `${baseUrl}?page=${page}`;
    const html = await fetchText(url, { timeoutMs: 12000, userAgent: BROWSERISH_USER_AGENT });
    const docs = extractRneReportDocumentsFromHtml(html, query);
    for (const doc of docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const searchable = normalizeText([doc.title, ...(doc.keywords || [])].join(' '));
      const direct = !query || searchable.includes(normalizeText(query));
      if (direct || matched.length < limit) matched.push(doc);
      if (matched.length >= limit) break;
    }
  }

  return matched.slice(0, limit);
}

export function extractKciDocumentsFromHtml(html, query, sourceUrl) {
  const documents = [];
  const seen = new Set();

  const anchorMatches = [
    ...html.matchAll(/href=["']([^"']*(?:landing\/article\.kci\?arti_id=ART\d+|ci\/sereArticleSearch\/ciSereArtiView\.kci\?sereArticleSearchBean\.artiId=ART\d+))[^"']*["'][^>]*>(.*?)<\/a>/g),
    ...html.matchAll(/(https:\/\/www\.kci\.go\.kr\/kciportal\/(?:landing\/article\.kci\?arti_id=ART\d+|ci\/sereArticleSearch\/ciSereArtiView\.kci\?sereArticleSearchBean\.artiId=ART\d+))/g)
  ];

  for (const match of anchorMatches) {
    const href = match[1];
    if (!href) continue;
    const absolute = href.startsWith('http') ? href : `https://www.kci.go.kr${href.startsWith('/') ? '' : '/'}${href}`;
    const artiIdMatch = absolute.match(/arti_id=(ART\d+)|artiId=(ART\d+)/);
    const artiId = artiIdMatch?.[1] || artiIdMatch?.[2];
    if (!artiId || seen.has(artiId)) continue;
    seen.add(artiId);
    const title = stripTags(match[2] || artiId);
    documents.push(
      buildDocument({
        id: `kci:${artiId}`,
        source: 'kci',
        sourceLabel: 'KCI',
        type: 'paper',
        title,
        englishTitle: title,
        authors: [],
        organization: 'KCI',
        year: safeYear(html),
        abstract: '',
        summary: 'KCI 공개 검색/랜딩 결과에서 수집한 항목입니다.',
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        sourceIds: { kci: artiId },
        links: {
          detail: absolute,
          original: absolute,
          sourceApiUrl: sourceUrl
        },
        rawRecord: { artiId, absolute }
      })
    );
  }

  const citationMatches = [
    ...html.matchAll(/@article\{(ART\d+),[\s\S]{0,1200}?title=\{([^}]+)\}[\s\S]{0,300}?journal=\{([^}]+)\}[\s\S]{0,200}?year=\{(\d{4})\}[\s\S]{0,800}?(?:doi=\{([^}]+)\})?/g),
    ...html.matchAll(/TY\s*-\s*JOUR[\s\S]{0,1200}?TI\s*-\s*([^\n]+)[\s\S]{0,400}?JO\s*-\s*([^\n]+)[\s\S]{0,200}?PY\s*-\s*(\d{4})[\s\S]{0,400}?@article\{(ART\d+)/g)
  ];

  for (const match of citationMatches) {
    const artiId = match[1]?.startsWith('ART') ? match[1] : match[4];
    const title = match[2]?.startsWith('ART') ? match[1] : match[2] || match[1];
    const journal = match[3] || '';
    const year = match[4] && !match[4].startsWith('ART') ? match[4] : match[3];
    if (!artiId || seen.has(artiId)) continue;
    seen.add(artiId);
    documents.push(
      buildDocument({
        id: `kci:${artiId}`,
        source: 'kci',
        sourceLabel: 'KCI',
        type: 'paper',
        title: stripTags(title),
        englishTitle: stripTags(title),
        authors: [],
        organization: stripTags(journal),
        year: Number(safeYear(year)),
        abstract: '',
        summary: 'KCI citation/landing metadata에서 수집한 항목입니다.',
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        sourceIds: { kci: artiId },
        links: {
          detail: `https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=${artiId}`,
          original: `https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=${artiId}`,
          sourceApiUrl: sourceUrl
        },
        rawRecord: { artiId, block: match[0] }
      })
    );
  }

  return documents;
}

async function searchKci(query, limit) {
  const postUrl = 'https://www.kci.go.kr/kciportal/mobile/po/search/poTotalSearList.kci';
  const body = new URLSearchParams({
    'poSearchBean.searType': 'all',
    'poSearchBean.keyword': query,
    'poSearchBean.from': '#totalSearch',
    'poSearchBean.startPg': '1',
    'poSearchBean.docsCount': String(Math.max(limit, 10))
  }).toString();

  const html = await fetchText(postUrl, {
    timeoutMs: 9000,
    userAgent: BROWSERISH_USER_AGENT,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const blocks = [...html.matchAll(/<div class="search-con">([\s\S]*?)<\/div>\s*<div class="search-con">|<div class="search-con">([\s\S]*?)<\/form>/g)]
    .map((m) => m[1] || m[2])
    .filter(Boolean);
  const docs = [];

  for (const block of blocks) {
    const articleMatch = block.match(/ciSereArtiView\.kci\?sereArticleSearchBean\.artiId=(ART\d+)/);
    if (!articleMatch) continue;
    const artiId = articleMatch[1];
    const titleMatch = block.match(/class="subject">\s*([\s\S]*?)\s*<\/a>/);
    const subjectInfo = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((entry) => stripTags(entry[1])).filter(Boolean);
    const title = stripTags(titleMatch?.[1] || artiId);
    docs.push(
      buildDocument({
        id: `kci:${artiId}`,
        source: 'kci',
        sourceLabel: 'KCI',
        type: 'paper',
        title,
        englishTitle: title,
        authors: normalizeAuthors(subjectInfo[0] || ''),
        organization: [subjectInfo[1], subjectInfo[2]].filter(Boolean).join(' · ') || 'KCI',
        year: safeYear(subjectInfo.join(' ')),
        abstract: '',
        summary: 'KCI 모바일 검색 결과에서 수집한 항목입니다.',
        keywords: normalizeKeywordBag(`${query} ${title}`).slice(0, 8),
        sourceIds: { kci: artiId },
        links: {
          detail: `https://www.kci.go.kr/kciportal/mobile/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=${artiId}`,
          original: `https://www.kci.go.kr/kciportal/mobile/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=${artiId}`,
          sourceApiUrl: postUrl
        },
        rawRecord: { artiId, block }
      })
    );
  }

  return docs.slice(0, limit);
}

async function searchConfiguredXmlApi(source, query, limit) {
  if (source === 'kipris' && appConfig.kiprisPlusSearchUrl && appConfig.kiprisPlusApiKey) {
    const separator = appConfig.kiprisPlusSearchUrl.includes('?') ? '&' : '?';
    const url = `${appConfig.kiprisPlusSearchUrl}${separator}word=${encodeURIComponent(query)}&numOfRows=${limit}&ServiceKey=${encodeURIComponent(appConfig.kiprisPlusApiKey)}`;
    const xml = await fetchText(url, { accept: 'application/xml', timeoutMs: 9000 });
    return parseXmlItems(xml, 'item').map((item) =>
      buildDocument({
        id: `kipris:${xmlValue(item, 'applicationNumber') || xmlValue(item, 'inventionTitle') || query}`,
        source: 'kipris',
        sourceLabel: 'KIPRIS Plus',
        type: 'patent',
        title: xmlValue(item, 'inventionTitle') || xmlValue(item, 'title'),
        englishTitle: xmlValue(item, 'inventionTitle') || xmlValue(item, 'title'),
        authors: normalizeAuthors(xmlValue(item, 'applicantName')),
        organization: xmlValue(item, 'applicantName'),
        year: safeYear(xmlValue(item, 'applicationDate') || xmlValue(item, 'publicationDate')),
        abstract: xmlValue(item, 'astrtCont') || '',
        summary: 'KIPRIS Plus Open API 검색 결과입니다.',
        keywords: normalizeKeywordBag(`${query} ${xmlValue(item, 'inventionTitle')}`).slice(0, 8),
        links: {
          detail: buildKiprisDetailLink(query, xmlValue(item, 'applicationNumber') || '', xmlValue(item, 'inventionTitle') || ''),
          original: buildKiprisDetailLink(query, xmlValue(item, 'applicationNumber') || '', xmlValue(item, 'inventionTitle') || '')
        },
        rawRecord: item
      })
    );
  }
  return [];
}

const liveSourceRegistry = {
  semantic_scholar: {
    type: 'api',
    coverage: '글로벌 논문/인용',
    note: '공식 Academic Graph API',
    search: searchSemanticScholar
  },
  arxiv: {
    type: 'api',
    coverage: '글로벌 프리프린트',
    note: '공식 Atom API / OAI-PMH 가능',
    search: searchArxiv
  },
  biorxiv: {
    type: 'crawl',
    coverage: '생명과학 프리프린트',
    note: '공개 검색 결과 페이지 파싱',
    search: (query, limit) => searchPreprintServer('biorxiv', query, limit)
  },
  medrxiv: {
    type: 'crawl',
    coverage: '의학 프리프린트',
    note: '공개 검색 결과 페이지 파싱',
    search: (query, limit) => searchPreprintServer('medrxiv', query, limit)
  },
  pubmed: {
    type: 'api',
    coverage: '생명과학/의학 논문',
    note: 'NCBI E-utilities 검색 + 초록 조회',
    search: searchPubMed
  },
  riss: {
    type: 'crawl',
    coverage: '국내 논문/학위논문/보고서',
    note: '공식 통합검색 페이지 파싱',
    search: searchRiss
  },
  kci: {
    type: 'crawl',
    coverage: '국내 인용/논문',
    note: '공개 KCI 결과/랜딩 페이지를 자동 추론하며 KCI_SEARCH_URL 또는 {query} 템플릿으로 세밀 조정 가능',
    search: searchKci
  },
  scienceon: {
    type: 'crawl',
    coverage: '과학기술 논문',
    note: '공식 목록 페이지 파싱',
    search: searchScienceOn
  },
  dbpia: {
    type: 'api',
    coverage: '국내 학술논문/보고서',
    note: 'OpenAPI key preferred; public search fallback available',
    search: searchDbpia
  },
  kiss: {
    type: 'crawl',
    coverage: '국내 학술논문',
    note: '공개 검색 결과 페이지 파싱',
    search: searchKiss
  },
  nanet: {
    type: 'crawl',
    coverage: '국회도서관 소장자료/정책자료',
    note: '국회도서관 검색 결과 페이지 파싱',
    search: searchNanet
  },
  ntis: {
    type: 'crawl',
    coverage: '국가 R&D 과제/성과',
    note: '공식 검색 페이지 파싱',
    search: searchNtis
  },
  kipris: {
    type: 'api',
    coverage: '특허/실용신안',
    note: 'OpenAPI preferred; when unavailable or rate-limited, direct site-search fallback is used',
    search: searchKipris
  },
  cve: {
    type: 'api',
    coverage: '보안 취약점',
    note: 'NVD CVE 2.0 API',
    search: searchCve
  },
  blackhat: {
    type: 'crawl',
    coverage: '보안 컨퍼런스 발표 자료',
    note: 'Black Hat 브리핑 일정/아카이브 페이지 파싱',
    search: searchBlackHat
  },
  defcon: {
    type: 'crawl',
    coverage: '보안 컨퍼런스/아카이브',
    note: 'DEF CON 포럼 검색 결과 파싱',
    search: searchDefcon
  },
  science_fair: {
    type: 'crawl',
    coverage: '전국과학전람회',
    note: '공식 목록 페이지 파싱',
    search: (query, limit) => searchScienceGo('science_fair', query, limit)
  },
  student_invention_fair: {
    type: 'crawl',
    coverage: '전국학생과학발명품경진대회',
    note: '공식 목록 페이지 파싱',
    search: (query, limit) => searchScienceGo('student_invention_fair', query, limit)
  },
  rne_report: {
    type: 'crawl',
    coverage: '과학영재 창의연구(R&E) 보고서',
    note: '중간성과공유회 보고서 목록 페이지 파싱',
    search: searchRneReports
  }
};

export async function searchLiveSources(query, requestedSources = [], limitPerSource = appConfig.maxLiveResultsPerSource, options = {}) {
  const { forceRefresh = false, overrideEnable = false } = options;
  const explicitSourceRequest = requestedSources.length > 0;

  if (!appConfig.enableLiveSources && !overrideEnable) {
    return {
      documents: [],
      statuses: Object.entries(liveSourceRegistry).map(([source, meta]) =>
        buildSourceStatus(source, {
          status: 'disabled',
          latency: 'n/a',
          coverage: meta.coverage,
          note: withExperimentalNote(source, `${meta.note}; SCHOLAXIS_ENABLE_LIVE_SOURCES=false`),
          detailUrl: sourceDetailUrl(source, query)
        })
      )
    };
  }

  const selected = (requestedSources.length ? requestedSources : Object.keys(liveSourceRegistry)).filter(
    (source) => liveSourceRegistry[source]
  );
  const runnable = selected.filter((source) => explicitSourceRequest || !isExperimentalLiveSource(source));
  const gated = selected.filter((source) => !runnable.includes(source));

  const settled = await Promise.all(
    runnable.map(async (source) => {
      const meta = liveSourceRegistry[source];
      try {
        const cached = forceRefresh ? null : getCachedSourceResult(source, query, limitPerSource);
        if (cached) {
          return {
            source,
            documents: cached.documents,
            status: { ...cached.status, note: `${cached.status.note}; cache-hit` }
          };
        }
        const documents = await meta.search(query, limitPerSource, source);
        const result = {
          source,
          documents,
          status: buildSourceStatus(source, {
            status: documents.length ? 'online' : 'limited',
            latency: meta.type === 'api' ? 'fast' : 'moderate',
            coverage: meta.coverage,
            note: withExperimentalNote(source, meta.note),
            detailUrl: sourceDetailUrl(source, query)
          })
        };
        setCachedSourceResult(source, query, limitPerSource, result);
        return result;
      } catch (error) {
        return {
          source,
          documents: [],
          status: buildSourceStatus(source, {
            status: 'error',
            latency: 'unknown',
            coverage: meta.coverage,
            note: withExperimentalNote(source, `${meta.note}; ${error.message}`),
            detailUrl: sourceDetailUrl(source, query)
          })
        };
      }
    })
  );

  return {
    documents: settled.flatMap((item) => item.documents),
    statuses: [
      ...settled.map((item) => item.status),
      ...gated.map((source) =>
        buildSourceStatus(source, {
          status: 'disabled',
          latency: 'n/a',
          coverage: liveSourceRegistry[source]?.coverage || '',
          note: withExperimentalNote(source, liveSourceRegistry[source]?.note || 'experimental source'),
          detailUrl: sourceDetailUrl(source, query)
        })
      )
    ]
  };
}

export function sourceRegistrySummary(query = '') {
  return Object.entries(liveSourceRegistry).map(([source, meta]) => ({
    source,
    detailUrl: sourceDetailUrl(source, query),
    type: meta.type,
    coverage: meta.coverage,
    note: withExperimentalNote(source, meta.note),
    liveEnabled: appConfig.enableLiveSources,
    experimental: isExperimentalLiveSource(source),
    autoRoutedByDefault: !isExperimentalLiveSource(source)
  }));
}

export function getSourceRuntimeDiagnostics() {
  return {
    cache: getSourceCacheDiagnostics(),
    experimentalSources: [...experimentalLiveSourceSet],
    quota: {
      kiprisPolicy: 'Use KIPRIS Plus API when configured; fall back to direct site-search when API is unavailable or rate-limited.',
      dbpiaPolicy: 'Use DBpia OpenAPI when configured; otherwise use public search fallback.'
    }
  };
}

export { clearSourceCache };
