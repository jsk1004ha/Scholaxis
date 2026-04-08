const app = document.querySelector('#app');

const state = {
  route: { view: 'home' },
  trends: [],
  search: {
    query: '',
    filters: { region: 'all', sourceType: 'all', sort: 'relevance' },
    summary: '',
    total: 0,
    results: []
  },
  detail: null,
  similarity: null,
  loading: false,
  error: ''
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function badge(label, tone = 'default') {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function resultCard(item) {
  const typeLabel = item.type === 'paper' ? '논문' : item.type === 'patent' ? '특허' : '보고서';
  const regionLabel = item.region === 'domestic' ? '국내' : '해외';

  return `
    <article class="result-card">
      <div class="result-meta-row">
        <div class="badge-row">
          ${badge(typeLabel, 'primary')}
          ${badge(regionLabel, 'muted')}
          ${item.openAccess ? badge('Open Access', 'success') : ''}
        </div>
        <span class="score-pill">적합도 ${escapeHtml(item.score)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="result-subtitle">${escapeHtml(item.organization)} · ${escapeHtml(item.source)} · ${escapeHtml(item.year)}</p>
      <p class="result-summary">${escapeHtml(item.summary)}</p>
      <div class="keyword-row">
        ${item.keywords.slice(0, 4).map((keyword) => `<span class="keyword-chip">#${escapeHtml(keyword)}</span>`).join('')}
      </div>
      <div class="result-actions">
        <div class="tiny-metrics">
          <span>인용 ${escapeHtml(item.citations)}</span>
          <span>순위 ${escapeHtml(item.rank)}</span>
        </div>
        <button class="link-button" data-action="open-detail" data-id="${escapeHtml(item.id)}">상세 보기</button>
      </div>
    </article>
  `;
}

function relatedCard(item) {
  return `
    <button class="related-card" data-action="open-detail" data-id="${escapeHtml(item.id)}">
      <div class="related-top">
        <span>${escapeHtml(item.source)}</span>
        <span>${escapeHtml(item.year)}</span>
      </div>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.summary)}</p>
    </button>
  `;
}

function matchCard(match) {
  const typeLabel = match.type === 'paper' ? '논문' : match.type === 'patent' ? '특허' : '보고서';
  return `
    <article class="match-card">
      <div class="match-header">
        <div>
          ${badge(typeLabel, 'primary')}
          ${badge(match.source, 'muted')}
        </div>
        <span class="score-pill score-pill-strong">${escapeHtml(match.score)}%</span>
      </div>
      <h4>${escapeHtml(match.title)}</h4>
      <p>${escapeHtml(match.reason)}</p>
      <div class="keyword-row">
        ${match.sharedKeywords.map((keyword) => `<span class="keyword-chip">${escapeHtml(keyword)}</span>`).join('')}
      </div>
      <div class="result-actions">
        <div class="tiny-metrics">
          <span>Dense ${escapeHtml(match.denseScore ?? 0)}</span>
          <span>Sparse ${escapeHtml(match.sparseScore ?? 0)}</span>
        </div>
        ${match.id ? `<button class="link-button" data-action="open-detail" data-id="${escapeHtml(match.id)}">상세 보기</button>` : ''}
      </div>
    </article>
  `;
}

function layout(content, active = 'home') {
  return `
    <header class="topbar">
      <div class="brand" data-action="go-home">Scholaxis</div>
      <nav class="nav-links">
        <button class="nav-link ${active === 'home' ? 'active' : ''}" data-action="go-home">탐색</button>
        <button class="nav-link ${active === 'search' ? 'active' : ''}" data-action="open-search">검색 결과</button>
        <button class="nav-link ${active === 'detail' ? 'active' : ''}" data-action="open-detail-from-state">상세 분석</button>
        <button class="nav-link ${active === 'similarity' ? 'active' : ''}" data-action="open-similarity">유사도 리포트</button>
      </nav>
      <div class="topbar-actions">
        <span class="lang-pill">KR-first</span>
        <button class="icon-button" aria-label="계정">연구팀</button>
      </div>
    </header>
    <main class="page-shell ${active === 'home' ? 'home-shell' : ''}">
      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
      ${content}
    </main>
  `;
}

function homeView() {
  return layout(
    `
      <section class="hero-card">
        <div class="hero-copy">
          <p class="eyebrow">AI-Driven Academic Intelligence</p>
          <h1>국내외 연구를 한 번에 탐색하는 한국어 중심 연구 큐레이터</h1>
          <p class="hero-description">
            논문, 특허, 정책 보고서를 통합 검색하고, 상세 문헌 맥락과 유사도 분석까지 단일 화면에서 이어지는
            풀스택 데모입니다.
          </p>
          <form id="hero-search-form" class="hero-search-panel">
            <label class="search-label" for="hero-query">무엇을 탐구하고 싶으신가요?</label>
            <textarea id="hero-query" name="query" rows="3" placeholder="예: 배터리 안전성 진단을 위한 멀티모달 AI 연구"></textarea>
            <div class="hero-search-actions">
              <div class="toggle-group">
                <label><input type="radio" name="region" value="all" checked /> 전체</label>
                <label><input type="radio" name="region" value="domestic" /> 국내</label>
                <label><input type="radio" name="region" value="global" /> 해외</label>
              </div>
              <div class="toggle-group">
                <label><input type="radio" name="sourceType" value="all" checked /> 전체</label>
                <label><input type="radio" name="sourceType" value="paper" /> 논문</label>
                <label><input type="radio" name="sourceType" value="patent" /> 특허</label>
                <label><input type="radio" name="sourceType" value="report" /> 보고서</label>
              </div>
              <button type="submit" class="primary-button">탐구 시작</button>
            </div>
          </form>
        </div>
      </section>
      <section class="trend-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">Intelligent Trends</p>
            <h2>빠르게 시작할 수 있는 탐색 주제</h2>
          </div>
          <button class="secondary-button" data-action="open-similarity">유사도 분석으로 이동</button>
        </div>
        <div class="trend-list">
          ${state.trends
            .map((topic) => `<button class="trend-chip" data-action="search-trend" data-query="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`)
            .join('')}
        </div>
      </section>
    `,
    'home'
  );
}

function searchView() {
  return layout(
    `
      <section class="page-hero gradient-hero">
        <div>
          <p class="eyebrow">Integrated Search</p>
          <h1>${escapeHtml(state.search.query || '통합 탐색')}</h1>
          <p>${escapeHtml(state.search.summary)}</p>
        </div>
        <form id="search-inline-form" class="inline-search-form">
          <input type="text" name="query" value="${escapeHtml(state.search.query)}" placeholder="키워드 또는 자연어 질문" />
          <button type="submit" class="primary-button">다시 검색</button>
        </form>
      </section>
      <section class="content-grid">
        <aside class="side-panel">
          <h2>고급 필터</h2>
          <form id="filters-form" class="filter-form">
            <label>
              지역
              <select name="region">
                <option value="all" ${state.search.filters.region === 'all' ? 'selected' : ''}>전체</option>
                <option value="domestic" ${state.search.filters.region === 'domestic' ? 'selected' : ''}>국내</option>
                <option value="global" ${state.search.filters.region === 'global' ? 'selected' : ''}>해외</option>
              </select>
            </label>
            <label>
              자료 유형
              <select name="sourceType">
                <option value="all" ${state.search.filters.sourceType === 'all' ? 'selected' : ''}>전체</option>
                <option value="paper" ${state.search.filters.sourceType === 'paper' ? 'selected' : ''}>논문</option>
                <option value="patent" ${state.search.filters.sourceType === 'patent' ? 'selected' : ''}>특허</option>
                <option value="report" ${state.search.filters.sourceType === 'report' ? 'selected' : ''}>보고서</option>
              </select>
            </label>
            <label>
              정렬
              <select name="sort">
                <option value="relevance" ${state.search.filters.sort === 'relevance' ? 'selected' : ''}>관련도</option>
                <option value="latest" ${state.search.filters.sort === 'latest' ? 'selected' : ''}>최신순</option>
                <option value="citation" ${state.search.filters.sort === 'citation' ? 'selected' : ''}>인용순</option>
              </select>
            </label>
            <button type="submit" class="primary-button">필터 적용</button>
          </form>
        </aside>
        <section class="result-panel">
          <div class="section-header">
            <div>
              <p class="eyebrow">Search Intelligence</p>
              <h2>결과 ${escapeHtml(state.search.total)}건</h2>
            </div>
            <button class="secondary-button" data-action="open-similarity">유사도 분석</button>
          </div>
          <div class="result-list">
            ${state.search.results.length ? state.search.results.map(resultCard).join('') : '<div class="empty-card">조건에 맞는 자료가 없습니다.</div>'}
          </div>
        </section>
      </section>
    `,
    'search'
  );
}

function detailView() {
  const detail = state.detail;
  if (!detail) {
    return layout('<div class="empty-card">선택된 자료가 없습니다.</div>', 'detail');
  }

  return layout(
    `
      <section class="page-hero detail-hero">
        <div>
          <div class="badge-row">
            ${badge(detail.type === 'paper' ? '논문' : detail.type === 'patent' ? '특허' : '보고서', 'primary')}
            ${detail.openAccess ? badge('Open Access', 'success') : ''}
            ${badge(detail.source, 'muted')}
          </div>
          <h1>${escapeHtml(detail.title)}</h1>
          <p class="detail-subtitle">${escapeHtml(detail.organization)} · ${escapeHtml(detail.authors.join(', '))}</p>
        </div>
        <div class="metric-grid">
          <div><span>인용</span><strong>${escapeHtml(detail.metrics.citations)}</strong></div>
          <div><span>참고문헌</span><strong>${escapeHtml(detail.metrics.references)}</strong></div>
          <div><span>인사이트</span><strong>${escapeHtml(detail.metrics.insightScore)}</strong></div>
          <div><span>상태</span><strong>${escapeHtml(detail.metrics.freshness)}</strong></div>
        </div>
      </section>
      <section class="content-grid detail-grid">
        <div class="detail-main">
          <article class="detail-card">
            <div class="section-header compact">
              <div>
                <p class="eyebrow">Abstract</p>
                <h2>연구 요약</h2>
              </div>
              <button class="secondary-button" data-action="prefill-similarity">이 문서로 유사도 분석</button>
            </div>
            <p class="body-copy">${escapeHtml(detail.abstract)}</p>
            <div class="split-grid">
              <div>
                <h3>핵심 기여</h3>
                <p>${escapeHtml(detail.novelty)}</p>
              </div>
              <div>
                <h3>주요 방법론</h3>
                <ul class="bullet-list">
                  ${detail.methods.map((method) => `<li>${escapeHtml(method)}</li>`).join('')}
                </ul>
              </div>
            </div>
            <div class="result-actions" style="margin-top:1rem">
              ${detail.originalUrl ? `<a class="secondary-button" href="${escapeHtml(detail.originalUrl)}" target="_blank" rel="noreferrer noopener">원문 열기</a>` : ''}
              ${detail.sourceUrl ? `<a class="secondary-button" href="${escapeHtml(detail.sourceUrl)}" target="_blank" rel="noreferrer noopener">출처 상세 열기</a>` : ''}
            </div>
          </article>
          <article class="detail-card">
            <div class="section-header compact">
              <div>
                <p class="eyebrow">Related Intelligence</p>
                <h2>연결 자료</h2>
              </div>
            </div>
            <div class="related-list">
              ${detail.related.map(relatedCard).join('')}
            </div>
          </article>
          <article class="detail-card">
            <div class="section-header compact">
              <div>
                <p class="eyebrow">Citation & Expansion</p>
                <h2>인용·참고·추천 확장</h2>
              </div>
            </div>
            <div class="split-grid">
              <div>
                <h3>후속 인용</h3>
                <div class="related-list">${detail.citations?.length ? detail.citations.map(relatedCard).join('') : '<div class="empty-card">후속 인용 자료가 아직 충분하지 않습니다.</div>'}</div>
              </div>
              <div>
                <h3>선행 참고</h3>
                <div class="related-list">${detail.references?.length ? detail.references.map(relatedCard).join('') : '<div class="empty-card">선행 참고 자료가 아직 충분하지 않습니다.</div>'}</div>
              </div>
            </div>
            <div style="margin-top:1rem">
              <h3>추천 경로</h3>
              <div class="related-list">${detail.recommendations?.length ? detail.recommendations.map(relatedCard).join('') : '<div class="empty-card">추천 후보가 아직 충분하지 않습니다.</div>'}</div>
            </div>
          </article>
        </div>
        <aside class="detail-side">
          <div class="detail-card">
            <p class="eyebrow">Keywords</p>
            <div class="keyword-row">${detail.keywords.map((keyword) => `<span class="keyword-chip">#${escapeHtml(keyword)}</span>`).join('')}</div>
          </div>
          <div class="detail-card">
            <p class="eyebrow">Highlights</p>
            <ul class="bullet-list">
              ${detail.highlights.map((highlight) => `<li>${escapeHtml(highlight)}</li>`).join('')}
            </ul>
          </div>
          <div class="detail-card">
            <p class="eyebrow">Source grounding</p>
            <p class="body-copy">${escapeHtml(detail.explanation?.summary || '이 문서는 실제 출처 레코드에 연결된 상세 자료입니다.')}</p>
            <ul class="bullet-list">
              ${(detail.explanation?.whyItMatters || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
          <div class="detail-card">
            <p class="eyebrow">그래프 경로</p>
            <ul class="bullet-list">
              ${(detail.graphPaths || []).length
                ? detail.graphPaths.map((path) => `<li>${escapeHtml(path.summary)}</li>`).join('')
                : '<li>그래프 경로 정보가 아직 부족합니다.</li>'}
            </ul>
          </div>
          <div class="detail-card">
            <p class="eyebrow">출처 상태 / 대체 소스</p>
            <div class="keyword-row">
              ${(detail.alternateSources || []).map((source) => `<span class="keyword-chip">${escapeHtml(source)}</span>`).join('')}
            </div>
            <ul class="bullet-list">
              ${(detail.sourceStatus || []).length
                ? detail.sourceStatus.map((item) => `<li>${escapeHtml(item.source)} · ${escapeHtml(item.status)} · ${escapeHtml(item.note || '')}</li>`).join('')
                : '<li>출처 상태 정보가 아직 없습니다.</li>'}
            </ul>
          </div>
        </aside>
      </section>
    `,
    'detail'
  );
}

function similarityView() {
  return layout(
    `
      <section class="page-hero similarity-hero">
        <div>
          <p class="eyebrow">Similarity Report</p>
          <h1>유사 자료 분석 리포트</h1>
          <p>보고서 업로드 대신 초록/본문 일부를 붙여 넣으면 유사 주제, 중복 위험, 차별화 포인트를 빠르게 확인할 수 있습니다.</p>
        </div>
      </section>
      <section class="content-grid similarity-grid">
        <div class="similarity-main">
          <form id="similarity-form" class="detail-card similarity-form">
            <label>
              문서 제목
              <input type="text" name="title" placeholder="예: 배터리 진단 AI 연구 초안" value="${escapeHtml(state.similarity?.title || '')}" />
            </label>
            <label>
              파일 업로드
              <input type="file" name="report" accept=".pdf,.docx,.hwpx,.hwp,.txt,.md" />
            </label>
            <label>
              분석할 텍스트
              <textarea name="text" rows="10" placeholder="초록이나 주요 본문을 붙여 넣으세요.">${escapeHtml(state.similarity?.draftText || '')}</textarea>
            </label>
            <button type="submit" class="primary-button">유사도 분석 실행</button>
          </form>
          <section class="detail-card">
            <div class="section-header compact">
              <div>
                <p class="eyebrow">Top Matches</p>
                <h2>${state.similarity?.report ? `위험도 ${escapeHtml(state.similarity.report.riskLevel)}` : '분석 대기 중'}</h2>
              </div>
              ${state.similarity?.report ? `<span class="score-pill score-pill-strong">${escapeHtml(state.similarity.report.score)}%</span>` : ''}
            </div>
            ${state.similarity?.report?.sameTopicStatement ? `<p class="body-copy">${escapeHtml(state.similarity.report.sameTopicStatement)}</p>` : ''}
            ${state.similarity?.report?.extraction ? `<p class="body-copy">추출: ${escapeHtml(state.similarity.report.extraction.method)} · ${escapeHtml(state.similarity.report.extraction.extractedCharacters)}자${state.similarity.report.extraction.warnings?.length ? ` · 경고 ${escapeHtml(state.similarity.report.extraction.warnings.join(', '))}` : ''}</p>` : ''}
            ${state.similarity?.report ? `<div class="match-list">${state.similarity.report.topMatches.map(matchCard).join('')}</div>` : '<div class="empty-card">텍스트를 입력하면 상위 유사 자료를 분석합니다.</div>'}
          </section>
        </div>
        <aside class="detail-side">
          <div class="detail-card">
            <p class="eyebrow">공통 테마</p>
            <div class="keyword-row">
              ${state.similarity?.report?.sharedThemes?.length ? state.similarity.report.sharedThemes.map((theme) => `<span class="keyword-chip">${escapeHtml(theme)}</span>`).join('') : '<span class="body-copy">분석 결과가 여기에 표시됩니다.</span>'}
            </div>
          </div>
          <div class="detail-card">
            <p class="eyebrow">차별화 포인트</p>
            <ul class="bullet-list">
              ${state.similarity?.report?.noveltySignals?.length ? state.similarity.report.noveltySignals.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>입력 텍스트를 기반으로 생성됩니다.</li>'}
            </ul>
          </div>
          <div class="detail-card">
            <p class="eyebrow">섹션 구조 비교</p>
            <ul class="bullet-list">
              ${state.similarity?.report?.sectionComparisons?.length
                ? state.similarity.report.sectionComparisons
                    .map(
                      (item) =>
                        `<li>${escapeHtml(item.inputSection)} → ${escapeHtml(item.matchedSection)} · ${escapeHtml(item.divergence)} (${escapeHtml(item.overlapScore)}%)</li>`,
                    )
                    .join('')
                : '<li>섹션 기반 비교가 여기에 표시됩니다.</li>'}
            </ul>
          </div>
          <div class="detail-card">
            <p class="eyebrow">차별성 분석 요약</p>
            <p class="body-copy">${state.similarity?.report?.differentiationAnalysis?.summary ? escapeHtml(state.similarity.report.differentiationAnalysis.summary) : '고유 키워드/방법 차이 분석이 여기에 표시됩니다.'}</p>
            <div class="keyword-row">
              ${state.similarity?.report?.differentiationAnalysis?.uniqueTerms?.length
                ? state.similarity.report.differentiationAnalysis.uniqueTerms
                    .map((item) => `<span class="keyword-chip">${escapeHtml(item)}</span>`)
                    .join('')
                : '<span class="body-copy">고유 키워드 대기 중</span>'}
            </div>
          </div>
          <div class="detail-card">
            <p class="eyebrow">권장 액션</p>
            <ul class="bullet-list">
              ${state.similarity?.report?.recommendations?.length ? state.similarity.report.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>초록 첫 문단과 기여 요약을 붙여 넣어 보세요.</li>'}
            </ul>
          </div>
        </aside>
      </section>
    `,
    'similarity'
  );
}

function render() {
  let html = homeView();
  if (state.route.view === 'search') html = searchView();
  if (state.route.view === 'detail') html = detailView();
  if (state.route.view === 'similarity') html = similarityView();
  app.innerHTML = html;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '요청 처리 중 오류가 발생했습니다.');
  return payload;
}

async function loadHome() {
  state.route = { view: 'home' };
  state.error = '';
  if (!state.trends.length) {
    const payload = await fetchJson('/api/trends');
    state.trends = payload.topics;
  }
}

async function loadSearch(query, filters = {}) {
  state.loading = true;
  state.error = '';
  const mergedFilters = { ...state.search.filters, ...filters };
  const params = new URLSearchParams({ q: query, ...mergedFilters });
  const payload = await fetchJson(`/api/search?${params.toString()}`);
  state.route = { view: 'search' };
  state.search = {
    query: payload.query,
    filters: payload.filters,
    summary: payload.summary,
    total: payload.total,
    results: payload.results
  };
  state.loading = false;
}

async function loadDetail(id) {
  state.error = '';
  const payload = await fetchJson(`/api/papers/${id}`);
  state.route = { view: 'detail', id };
  state.detail = payload;
}

function openSimilarity(draftText = '', title = '') {
  state.route = { view: 'similarity' };
  state.similarity = {
    title,
    draftText,
    report: state.similarity?.report || null
  };
}

async function submitSimilarity(title, text) {
  state.error = '';
  const payload = await fetchJson('/api/similarity/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, text })
  });
  state.route = { view: 'similarity' };
  state.similarity = { title, draftText: text, report: payload };
}

async function submitSimilarityForm(form) {
  const formData = new FormData(form);
  const reportFile = formData.get('report');
  const hasFile = reportFile && typeof reportFile === 'object' && reportFile.size > 0;

  let payload;
  if (hasFile) {
    const response = await fetch('/api/similarity/analyze', {
      method: 'POST',
      body: formData
    });
    payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '유사도 분석 중 오류가 발생했습니다.');
  } else {
    payload = await fetchJson('/api/similarity/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: String(formData.get('title') || '업로드 문서'),
        text: String(formData.get('text') || '')
      })
    });
  }

  state.route = { view: 'similarity' };
  state.similarity = {
    title: String(formData.get('title') || '업로드 문서'),
    draftText: String(formData.get('text') || ''),
    report: payload
  };
}

function setHash(hash) {
  if (window.location.hash === hash) {
    syncRoute();
    return;
  }
  window.location.hash = hash;
}

async function syncRoute() {
  try {
    const hash = window.location.hash || '#/';
    const route = hash.replace(/^#/, '');
    const [path, queryString] = route.split('?');
    const params = new URLSearchParams(queryString || '');

    if (path === '/' || path === '') {
      await loadHome();
      render();
      return;
    }

    if (path === '/search') {
      await loadSearch(params.get('q') || '', {
        region: params.get('region') || 'all',
        sourceType: params.get('sourceType') || 'all',
        sort: params.get('sort') || 'relevance'
      });
      render();
      return;
    }

    if (path.startsWith('/paper/')) {
      await loadDetail(path.split('/')[2]);
      render();
      return;
    }

    if (path === '/similarity') {
      openSimilarity(state.similarity?.draftText || '', state.similarity?.title || '');
      render();
      return;
    }

    await loadHome();
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

app.addEventListener('submit', async (event) => {
  try {
    if (event.target.id === 'hero-search-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const params = new URLSearchParams({
        q: String(form.get('query') || ''),
        region: String(form.get('region') || 'all'),
        sourceType: String(form.get('sourceType') || 'all'),
        sort: 'relevance'
      });
      setHash(`#/search?${params.toString()}`);
    }

    if (event.target.id === 'search-inline-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const params = new URLSearchParams({
        q: String(form.get('query') || ''),
        region: state.search.filters.region,
        sourceType: state.search.filters.sourceType,
        sort: state.search.filters.sort
      });
      setHash(`#/search?${params.toString()}`);
    }

    if (event.target.id === 'filters-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const params = new URLSearchParams({
        q: state.search.query,
        region: String(form.get('region') || 'all'),
        sourceType: String(form.get('sourceType') || 'all'),
        sort: String(form.get('sort') || 'relevance')
      });
      setHash(`#/search?${params.toString()}`);
    }

    if (event.target.id === 'similarity-form') {
      event.preventDefault();
      await submitSimilarityForm(event.target);
      render();
    }
  } catch (error) {
    state.error = error.message;
    render();
  }
});

app.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;

  const { action, id, query } = actionTarget.dataset;

  if (action === 'go-home') setHash('#/');
  if (action === 'open-search') {
    const params = new URLSearchParams({ q: state.search.query || 'AI research', ...state.search.filters });
    setHash(`#/search?${params.toString()}`);
  }
  if (action === 'open-detail' && id) setHash(`#/paper/${id}`);
  if (action === 'open-detail-from-state' && state.detail?.id) setHash(`#/paper/${state.detail.id}`);
  if (action === 'open-similarity') setHash('#/similarity');
  if (action === 'prefill-similarity' && state.detail) {
    state.similarity = {
      title: `${state.detail.title} 비교 검토`,
      draftText: state.detail.abstract,
      report: null
    };
    setHash('#/similarity');
  }
  if (action === 'search-trend' && query) {
    const params = new URLSearchParams({ q: query, region: 'all', sourceType: 'all', sort: 'relevance' });
    setHash(`#/search?${params.toString()}`);
  }
});

window.addEventListener('hashchange', syncRoute);
window.addEventListener('DOMContentLoaded', syncRoute);
