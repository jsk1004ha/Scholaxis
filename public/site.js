import {
  analyzeSimilarity,
  clearCache,
  fetchAdminSummary,
  fetchLibrary,
  fetchMe,
  fetchPaper,
  fetchSavedSearches,
  fetchSearch,
  login,
  logout,
  register,
  removeLibraryItem,
  removeSavedSearch,
  saveSearchRequest,
} from './api.js';
import { mockPapers, mockSources } from './mock-data.js';

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

function setText(selector, value) {
  const node = qs(selector);
  if (node) node.textContent = value;
}

function formatAuthors(authors = []) {
  return authors.join(' · ');
}

function buildSearchParams(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (typeof value === 'string' && value.trim()) params.append(key, value.trim());
  }
  return params;
}

function createPaperCard(paper) {
  const article = document.createElement('article');
  article.className = 'result-card';
  article.innerHTML = `
    <div class="result-card__meta">
      <span class="pill pill--muted">${paper.badge}</span>
      <span>${paper.source}</span>
      <span>${paper.year}</span>
      <span>${paper.region}</span>
    </div>
    <h3><a href="./detail.html?id=${encodeURIComponent(paper.id)}">${paper.title}</a></h3>
    <p class="result-card__subtitle">${paper.subtitle ?? ''}</p>
    <p>${paper.summary}</p>
    <div class="result-card__footer">
      <div>
        <strong>저자</strong>
        <span>${formatAuthors(paper.authors)}</span>
      </div>
      <div>
        <strong>핵심 인사이트</strong>
        <span>${paper.insight}</span>
      </div>
    </div>
    <div class="tag-row">${(paper.tags ?? []).map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
  `;
  return article;
}

function navigateToResults(form) {
  const params = buildSearchParams(form);
  window.location.href = `./results.html?${params.toString()}`;
}

function initHomePage() {
  const form = qs('[data-search-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    navigateToResults(form);
  });

  qsa('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = qs('textarea[name="q"]', form);
      if (!input) return;
      input.value = button.dataset.suggestion || '';
      navigateToResults(form);
    });
  });
}

async function initResultsPage() {
  const resultsRoot = qs('[data-results-root]');
  if (!resultsRoot) return;

  const params = new URLSearchParams(window.location.search);
  const searchPayload = await fetchSearch({
    q: params.get('q') || 'AI 반도체 설계 자동화',
    region: params.get('region') || '국내,해외',
    sourceType: params.get('sourceType') || '논문,특허,보고서',
  });

  setText('[data-query-label]', searchPayload.query);
  setText('[data-results-summary]', searchPayload.summary);
  setText('[data-results-count]', `${searchPayload.total}개 결과`);

  const relatedRoot = qs('[data-related-queries]');
  if (relatedRoot) {
    relatedRoot.innerHTML = (searchPayload.relatedQueries ?? [])
      .map((query) => `<a class="chip" href="./results.html?q=${encodeURIComponent(query)}">${query}</a>`)
      .join('');
  }

  const sourceRoot = qs('[data-source-list]');
  if (sourceRoot) {
    sourceRoot.innerHTML = (searchPayload.filters?.sources ?? mockSources)
      .map((source) => `<li>${source}</li>`)
      .join('');
  }

  resultsRoot.innerHTML = '';
  (searchPayload.items ?? mockPapers).forEach((paper) => {
    resultsRoot.appendChild(createPaperCard(paper));
  });

  const form = qs('[data-inline-search]');
  if (!form) return;

  const input = qs('input[name="q"]', form);
  if (input) input.value = searchPayload.query;
  const regionSelect = qs('select[name="region"]', form);
  if (regionSelect) regionSelect.value = params.get('region') || '국내,해외';
  const typeSelect = qs('select[name="sourceType"]', form);
  if (typeSelect) typeSelect.value = params.get('sourceType') || '논문,특허,보고서';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    navigateToResults(form);
  });
}

function renderNetwork(nodes) {
  return nodes
    .map(
      (node) => `
        <div class="network-node network-node--${node.tone}" style="left:${node.x}%;top:${node.y}%">
          <strong>${node.label}</strong>
          <span>${node.meta}</span>
        </div>
      `,
    )
    .join('');
}

async function initDetailPage() {
  const root = qs('[data-detail-root]');
  if (!root) return;

  const id = new URLSearchParams(window.location.search).get('id') || mockPapers[0].id;
  const paper = await fetchPaper(id);

  setText('[data-detail-title]', paper.title);
  setText('[data-detail-subtitle]', paper.subtitle);
  setText('[data-detail-authors]', `${formatAuthors(paper.authors)} — ${paper.affiliation}`);
  setText('[data-detail-abstract]', paper.abstract);
  setText('[data-detail-insight]', paper.insight);
  setText('[data-detail-source]', `${paper.source} · ${paper.year}`);
  setText('[data-detail-badge]', paper.badge);
  setText('[data-metric-citations]', String(paper.metrics?.citations ?? '-'));
  setText('[data-metric-references]', String(paper.metrics?.references ?? '-'));
  setText('[data-metric-impact]', String(paper.metrics?.impact ?? '-'));
  setText('[data-metric-velocity]', String(paper.metrics?.velocity ?? '-'));

  const tagsRoot = qs('[data-detail-tags]');
  if (tagsRoot) {
    tagsRoot.innerHTML = (paper.tags ?? []).map((tag) => `<span class="tag">${tag}</span>`).join('');
  }

  const networkRoot = qs('[data-network-root]');
  if (networkRoot) {
    networkRoot.innerHTML = renderNetwork([
      { x: 50, y: 50, label: '현재 논문', meta: paper.badge, tone: 'primary' },
      { x: 20, y: 24, label: '선행 연구', meta: 'Semantic Scholar', tone: 'secondary' },
      { x: 76, y: 26, label: '국내 과제', meta: 'NTIS', tone: 'accent' },
      { x: 25, y: 76, label: '특허 노드', meta: 'KIPRIS', tone: 'muted' },
      { x: 78, y: 74, label: '후속 아이디어', meta: '학생발명전', tone: 'secondary' },
    ]);
  }

  const relatedRoot = qs('[data-related-results]');
  if (relatedRoot) {
    relatedRoot.innerHTML = '';
    (paper.related ?? []).forEach((relatedId) => {
      const relatedPaper = mockPapers.find((candidate) => candidate.id === relatedId);
      if (relatedPaper) relatedRoot.appendChild(createPaperCard(relatedPaper));
    });
  }

  const similarityLink = qs('[data-similarity-link]');
  if (similarityLink) {
    similarityLink.href = `./similarity.html?paperId=${encodeURIComponent(paper.id)}`;
  }
}

async function initSimilarityPage() {
  const form = qs('[data-upload-form]');
  if (!form) return;

  const score = qs('[data-score]');
  const context = qs('[data-shared-context]');
  const novelty = qs('[data-novelty]');
  const risk = qs('[data-risk]');
  const compared = qs('[data-compared-paper]');
  const recommendations = qs('[data-recommendations]');
  const fileName = qs('[data-upload-name]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const result = await analyzeSimilarity(formData);
    if (score) score.textContent = `${result.similarityScore}%`;
    if (context) context.textContent = result.sharedContext;
    if (novelty) novelty.textContent = result.novelty;
    if (risk) risk.textContent = result.risk;
    if (compared) {
      const href = `./detail.html?id=${encodeURIComponent(result.comparedPaperId)}`;
      compared.innerHTML = `<a href="${href}">${result.comparedPaperId}</a>`;
    }
    if (recommendations) {
      recommendations.innerHTML = (result.recommendations ?? []).map((item) => `<li>${item}</li>`).join('');
    }
    if (fileName) fileName.textContent = result.reportName;
  });

  const linkedPaperId = new URLSearchParams(window.location.search).get('paperId');
  if (linkedPaperId && compared) {
    compared.innerHTML = `<a href="./detail.html?id=${encodeURIComponent(linkedPaperId)}">${linkedPaperId}</a>`;
  }

  const input = qs('input[type="file"]', form);
  if (input && fileName) {
    input.addEventListener('change', () => {
      fileName.textContent = input.files?.[0]?.name || '업로드된 파일 없음';
    });
  }
}

const page = document.body.dataset.page;
if (page === 'home') initHomePage();
if (page === 'results') initResultsPage();
if (page === 'detail') initDetailPage();
if (page === 'similarity') initSimilarityPage();

async function initAdminPage() {
  const summary = qs('[data-admin-summary]');
  if (!summary) return;

  const renderSummary = async () => {
    const payload = await fetchAdminSummary();
    summary.textContent = JSON.stringify(payload, null, 2);
  };

  await renderSummary();

  qs('[data-refresh-cache]')?.addEventListener('click', async () => {
    await clearCache({});
    await renderSummary();
  });
}

async function initLibraryPage() {
  const authForm = qs('[data-auth-form]');
  if (!authForm) return;

  const authState = qs('[data-auth-state]');
  const libraryRoot = qs('[data-library-items]');
  const searchesRoot = qs('[data-saved-searches]');
  const saveSearchForm = qs('[data-save-search-form]');

  const refresh = async () => {
    const me = await fetchMe().catch(() => ({ user: null }));
    if (authState) authState.textContent = JSON.stringify(me, null, 2);

    if (!me.user) {
      if (libraryRoot) libraryRoot.innerHTML = '<p>로그인 후 확인 가능</p>';
      if (searchesRoot) searchesRoot.innerHTML = '<p>로그인 후 확인 가능</p>';
      return;
    }

    const library = await fetchLibrary().catch(() => ({ items: [] }));
    if (libraryRoot) {
      libraryRoot.innerHTML =
        (library.items || [])
          .map(
            (item) => `
              <div class="card">
                <strong>${item.canonicalId}</strong>
                <p>${item.note || ''}</p>
                <button class="button button--ghost" data-remove-library="${item.canonicalId}">삭제</button>
              </div>
            `,
          )
          .join('') || '<p>저장 항목 없음</p>';
    }

    const searches = await fetchSavedSearches().catch(() => ({ searches: [] }));
    if (searchesRoot) {
      searchesRoot.innerHTML =
        (searches.searches || [])
          .map(
            (item) => `
              <div class="card">
                <strong>${item.label}</strong>
                <p>${item.queryText}</p>
                <button class="button button--ghost" data-remove-search="${item.id}">삭제</button>
              </div>
            `,
          )
          .join('') || '<p>저장 검색 없음</p>';
    }
  };

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(authForm);
    const payload = {
      email: formData.get('email'),
      password: formData.get('password'),
      displayName: formData.get('displayName'),
    };
    const action = event.submitter?.dataset.authAction || 'login';
    if (action === 'register') await register(payload);
    else await login(payload);
    await refresh();
  });

  qs('[data-auth-action="logout"]', authForm)?.addEventListener('click', async () => {
    await logout();
    await refresh();
  });

  saveSearchForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(saveSearchForm);
    await saveSearchRequest({
      label: formData.get('label'),
      queryText: formData.get('queryText'),
      filters: {},
    });
    await refresh();
  });

  document.addEventListener('click', async (event) => {
    const libraryButton = event.target.closest('[data-remove-library]');
    if (libraryButton) {
      await removeLibraryItem(libraryButton.dataset.removeLibrary);
      await refresh();
    }

    const searchButton = event.target.closest('[data-remove-search]');
    if (searchButton) {
      await removeSavedSearch(searchButton.dataset.removeSearch);
      await refresh();
    }
  });

  await refresh();
}

if (page === 'admin') initAdminPage();
if (page === 'library') initLibraryPage();
