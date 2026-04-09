import { appConfig } from './config.mjs';
import {
  buildDocument,
  buildSourceStatus,
  expandQueryVariants,
  extractListItems,
  fetchJson,
  fetchText,
  hasBrokenEncoding,
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
import { unique } from './vector-service.mjs';
import { execFileSync } from 'node:child_process';
import { clearSourceCache, getCachedSourceResult, getSourceCacheDiagnostics, setCachedSourceResult } from './source-cache.mjs';

const BROWSERISH_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';


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
    case 'rne_report':
      return appConfig.rneReportUrl;
    default:
      return '';
  }
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

async function searchNtis(query, limit) {
  const url = `${appConfig.ntisSearchUrl}?searchWord=${encodeURIComponent(query)}&dbt=project&sort=RANK%2FDESC`;
  const html = await fetchText(url, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
  const anchorRows = [...html.matchAll(/<a[^>]+(?:href|onclick)[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => stripTags(match[1]))
    .filter((item) => item.length >= 4 && item.length <= 160)
    .filter((item) => !item.includes('검색 결과'))
    .filter((item) => isUsableSearchText(item, query));
  const listRows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    .map((match) => stripTags(match[1]))
    .filter((item) => item.length >= 4 && item.length <= 160)
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

async function searchScienceGo(source, query, limit) {
  const baseUrl =
    source === 'science_fair'
      ? appConfig.scienceFairUrl
      : appConfig.studentInventionFairUrl;
  const html = await fetchText(baseUrl, { timeoutMs: 9000, userAgent: BROWSERISH_USER_AGENT });
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
    const candidateText = `${title} ${category} ${award}`.toLowerCase();
    if (query && !candidateText.includes(query.toLowerCase()) && items.length >= limit) continue;
    items.push(
      buildDocument({
        id: `${source}:${nttSn}`,
        source,
        sourceLabel: source === 'science_fair' ? '전국과학전람회' : '전국학생과학발명품경진대회',
        type: 'fair_entry',
        title,
        englishTitle: title,
        authors: [],
        organization: source === 'science_fair' ? '전국과학전람회' : '전국학생과학발명품경진대회',
        year,
        abstract: '',
        summary: `${category} / ${award || '수상 정보 미상'} 항목입니다.`,
        keywords: normalizeKeywordBag(`${query} ${title} ${category} ${award}`).slice(0, 8),
        highlights: [category, award].filter(Boolean),
        links: {
          detail: `${baseUrl.replace('moveBbsNttList.do', 'moveBbsNttDetail.do')}?nttSn=${nttSn}`,
          original: `${baseUrl.replace('moveBbsNttList.do', 'moveBbsNttDetail.do')}?nttSn=${nttSn}`
        },
        rawRecord: { nttSn, tds }
      })
    );
  }

  return items.slice(0, limit);
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

  if (!appConfig.enableLiveSources && !overrideEnable) {
    return {
      documents: [],
      statuses: Object.entries(liveSourceRegistry).map(([source, meta]) =>
        buildSourceStatus(source, {
          status: 'disabled',
          latency: 'n/a',
          coverage: meta.coverage,
          note: `${meta.note}; SCHOLAXIS_ENABLE_LIVE_SOURCES=false`,
          detailUrl: sourceDetailUrl(source, query)
        })
      )
    };
  }

  const selected = (requestedSources.length ? requestedSources : Object.keys(liveSourceRegistry)).filter(
    (source) => liveSourceRegistry[source]
  );

  const settled = await Promise.all(
    selected.map(async (source) => {
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
            note: meta.note,
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
            note: `${meta.note}; ${error.message}`,
            detailUrl: sourceDetailUrl(source, query)
          })
        };
      }
    })
  );

  return {
    documents: settled.flatMap((item) => item.documents),
    statuses: settled.map((item) => item.status)
  };
}

export function sourceRegistrySummary(query = '') {
  return Object.entries(liveSourceRegistry).map(([source, meta]) => ({
    source,
    detailUrl: sourceDetailUrl(source, query),
    type: meta.type,
    coverage: meta.coverage,
    note: meta.note,
    liveEnabled: appConfig.enableLiveSources
  }));
}

export function getSourceRuntimeDiagnostics() {
  return {
    cache: getSourceCacheDiagnostics(),
    quota: {
      kiprisPolicy: 'Use KIPRIS Plus API when configured; fall back to direct site-search when API is unavailable or rate-limited.',
      dbpiaPolicy: 'Use DBpia OpenAPI when configured; otherwise use public search fallback.'
    }
  };
}

export { clearSourceCache };
