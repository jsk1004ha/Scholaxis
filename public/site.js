import {
  analyzeSimilarity,
  clearCache,
  fetchAdminOps,
  fetchAdminSummary,
  fetchLibrary,
  fetchMe,
  fetchPaper,
  fetchProfile,
  fetchRecommendationFeed,
  fetchSavedSearches,
  fetchSearchStream,
  login,
  logout,
  register,
  removeLibraryItem,
  removeSavedSearch,
  saveLibraryItem,
  saveProfile,
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function renderSourceList(searchPayload, sourceRoot) {
  if (!sourceRoot) return;
  sourceRoot.innerHTML = (searchPayload.sourceStatus?.map((item) => item.source) ?? searchPayload.filters?.sources ?? mockSources)
    .map((source) => `<li>${source}</li>`)
    .join('');
}

function renderSearchPayload(searchPayload, resultsRoot) {
  setText('[data-query-label]', searchPayload.query);
  setText('[data-results-summary]', searchPayload.summary);
  setText('[data-results-count]', `${searchPayload.total}개 결과`);

  const relatedRoot = qs('[data-related-queries]');
  if (relatedRoot) {
    relatedRoot.innerHTML = (searchPayload.relatedQueries ?? [])
      .map((query) => `<a class="chip" href="./results.html?q=${encodeURIComponent(query)}">${query}</a>`)
      .join('');
  }

  renderSourceList(searchPayload, qs('[data-source-list]'));

  resultsRoot.innerHTML = '';
  if (searchPayload.error) {
    resultsRoot.innerHTML = `<article class="card"><h3>검색 오류</h3><p>${escapeHtml(searchPayload.summary)}</p></article>`;
    return;
  }

  if (!(searchPayload.items ?? []).length) {
    resultsRoot.innerHTML = '<article class="card"><h3>검색 결과 없음</h3><p>다른 키워드나 필터로 다시 시도해 보세요.</p></article>';
    return;
  }

  (searchPayload.items ?? mockPapers).forEach((paper) => {
    resultsRoot.appendChild(createPaperCard(paper));
  });
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
  const progressRoot = qs('[data-search-progress]');

  const params = new URLSearchParams(window.location.search);
  const query = {
    q: params.get('q') || 'AI 반도체 설계 자동화',
    region: params.get('region') || 'all',
    sourceType: params.get('sourceType') || 'all',
    sort: params.get('sort') || 'relevance',
    live: params.get('live') || '',
    autoLive: params.get('autoLive') || '',
  };
  resultsRoot.innerHTML = '<article class="card"><h3>검색 준비 중</h3><p>로컬 인덱스와 라이브 소스를 순차적으로 조회하고 있습니다.</p></article>';
  if (progressRoot) progressRoot.textContent = '검색 스트리밍 연결 중…';

  const searchPayload = await fetchSearchStream(query, {
    onSummary(payload) {
      setText('[data-query-label]', payload.query || query.q);
      if (progressRoot) progressRoot.textContent = payload.summary || '검색을 시작했습니다.';
    },
    onProgress(payload) {
      if (progressRoot) progressRoot.textContent = payload.message || '검색을 진행 중입니다.';
      if (payload.sourceStatus) renderSourceList(payload, qs('[data-source-list]'));
    },
    onResults(payload) {
      renderSearchPayload(payload, resultsRoot);
      if (progressRoot) progressRoot.textContent = '결과 초안을 렌더링했습니다.';
    },
    onDone(payload) {
      renderSearchPayload(payload, resultsRoot);
      if (progressRoot) progressRoot.textContent = `스트리밍 완료 · ${payload.total}개 결과`;
    },
  });
  renderSearchPayload(searchPayload, resultsRoot);

  const form = qs('[data-inline-search]');
  if (!form) return;

  const input = qs('input[name="q"]', form);
  if (input) input.value = searchPayload.query;
  const regionSelect = qs('select[name="region"]', form);
  if (regionSelect) regionSelect.value = params.get('region') || 'all';
  const typeSelect = qs('select[name="sourceType"]', form);
  if (typeSelect) typeSelect.value = params.get('sourceType') || 'all';

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

  const explanationSummaryRoot = qs('[data-detail-explanation-summary]');
  if (explanationSummaryRoot) {
    explanationSummaryRoot.textContent = paper.explanation?.summary || '그래프 기반 설명이 아직 부족합니다.';
  }

  const explanationPointsRoot = qs('[data-detail-explanation-points]');
  if (explanationPointsRoot) {
    explanationPointsRoot.innerHTML = (paper.explanation?.whyItMatters || []).length
      ? paper.explanation.whyItMatters.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
      : '<li>추가 인용/추천 데이터가 쌓이면 더 풍부한 설명을 제공합니다.</li>';
  }

  const recommendationsRoot = qs('[data-detail-recommendations]');
  if (recommendationsRoot) {
    recommendationsRoot.innerHTML = '';
    (paper.recommendations || []).forEach((candidate) => {
      recommendationsRoot.appendChild(createPaperCard(candidate));
    });
  }

  const similarityLink = qs('[data-similarity-link]');
  if (similarityLink) {
    similarityLink.href = `./similarity.html?paperId=${encodeURIComponent(paper.id)}`;
  }

  qs('[data-save-library]')?.addEventListener('click', async () => {
    const me = await fetchMe().catch(() => ({ user: null }));
    if (!me.user) {
      window.alert('로그인 후 라이브러리에 저장할 수 있습니다.');
      return;
    }
    await saveLibraryItem({
      canonicalId: paper.id,
      note: `${paper.title} 저장`,
      highlights: (paper.tags || []).slice(0, 4),
      share: true,
    });
    window.alert('라이브러리에 저장했습니다.');
  });
}

async function initSimilarityPage() {
  const form = qs('[data-upload-form]');
  if (!form) return;

  const score = qs('[data-score]');
  const context = qs('[data-shared-context]');
  const novelty = qs('[data-novelty]');
  const structure = qs('[data-structure]');
  const differentiation = qs('[data-differentiation]');
  const differentiators = qs('[data-differentiators]');
  const sectionComparisons = qs('[data-section-comparisons]');
  const semanticDiff = qs('[data-semantic-diff]');
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
    if (structure) structure.textContent = result.structure || '섹션 비교 결과가 없습니다.';
    if (differentiation) differentiation.textContent = result.differentiation || '차별성 분석 결과가 없습니다.';
    if (differentiators) {
      differentiators.innerHTML = (result.differentiators ?? []).length
        ? result.differentiators.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('')
        : '<span class="muted-copy">고유 키워드 없음</span>';
    }
    if (sectionComparisons) {
      sectionComparisons.innerHTML = (result.sectionComparisons ?? []).length
        ? result.sectionComparisons
            .map(
              (item) =>
                `<li>${escapeHtml(item.inputSection)} → ${escapeHtml(item.matchedSection)} · ${escapeHtml(item.divergence)} (${escapeHtml(item.overlapScore)}%)</li>`,
            )
            .join('')
        : '<li>섹션 비교 결과가 없습니다.</li>';
    }
    if (semanticDiff) {
      semanticDiff.innerHTML = (result.semanticDiff?.insights ?? []).length
        ? result.semanticDiff.insights
            .map(
              (item) =>
                `<li><strong>${escapeHtml(item.section)}</strong>: ${escapeHtml(item.summary)}</li>`,
            )
            .join('')
        : `<li>${escapeHtml(result.semanticDiff?.summary || '의미적 차이 분석 결과가 없습니다.')}</li>`;
    }
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
  const alertsRoot = qs('[data-admin-alerts]');
  const metricsRoot = qs('[data-admin-metrics]');
  const requestsRoot = qs('[data-admin-requests]');
  const similarityRoot = qs('[data-admin-similarity]');
  const startupRoot = qs('[data-admin-startup]');
  if (!summary || !alertsRoot || !metricsRoot || !requestsRoot || !similarityRoot || !startupRoot) return;

  const renderSummary = async () => {
    const [summaryPayload, opsPayload] = await Promise.all([fetchAdminSummary(), fetchAdminOps()]);
    summary.textContent = JSON.stringify(summaryPayload, null, 2);

    startupRoot.innerHTML = `
      <div class="stat-card"><span>Host</span><strong>${escapeHtml(opsPayload.startup.host)}</strong></div>
      <div class="stat-card"><span>Port</span><strong>${escapeHtml(opsPayload.startup.port)}</strong></div>
      <div class="stat-card"><span>Live Sources</span><strong>${opsPayload.startup.liveSourcesEnabled ? 'ON' : 'OFF'}</strong></div>
      <div class="stat-card"><span>Source Timeout</span><strong>${escapeHtml(opsPayload.startup.sourceTimeoutMs)}ms</strong></div>
    `;

    metricsRoot.innerHTML = Object.entries(opsPayload.storage)
      .filter(([key]) => key !== 'ready' && key !== 'dbPath')
      .map(
        ([key, value]) => `
          <div class="stat-card">
            <span>${escapeHtml(key)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `,
      )
      .join('');

    alertsRoot.innerHTML = opsPayload.alerts
      .map(
        (alert) => `
          <article class="alert-card alert-card--${escapeHtml(alert.level)}">
            <strong>${escapeHtml(alert.title)}</strong>
            <p>${escapeHtml(alert.detail)}</p>
          </article>
        `,
      )
      .join('');

    requestsRoot.innerHTML =
      opsPayload.recentRequests
        .map(
          (entry) => `
            <tr>
              <td>${escapeHtml(entry.method)}</td>
              <td>${escapeHtml(entry.path)}</td>
              <td>${escapeHtml(entry.status)}</td>
              <td>${Math.round(Number(entry.durationMs || 0))}ms</td>
              <td>${escapeHtml(entry.createdAt)}</td>
            </tr>
          `,
        )
        .join('') || '<tr><td colspan="5">최근 요청 없음</td></tr>';

    similarityRoot.innerHTML =
      opsPayload.recentSimilarityRuns
        .map(
          (entry) => `
            <div class="timeline-item">
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.riskLevel || 'unknown')} · score ${escapeHtml(entry.score)} · ${escapeHtml(entry.extractionMethod || 'n/a')}</p>
              <span>${escapeHtml(entry.createdAt)}</span>
            </div>
          `,
        )
        .join('') || '<p class="muted-copy">유사도 실행 이력이 없습니다.</p>';
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
  const recommendationRoot = qs('[data-recommendation-feed]');
  const saveSearchForm = qs('[data-save-search-form]');
  const profileForm = qs('[data-profile-form]');

  const refresh = async () => {
    const me = await fetchMe().catch(() => ({ user: null }));
    if (authState) authState.textContent = JSON.stringify(me, null, 2);

    if (!me.user) {
      if (libraryRoot) libraryRoot.innerHTML = '<p>로그인 후 확인 가능</p>';
      if (searchesRoot) searchesRoot.innerHTML = '<p>로그인 후 확인 가능</p>';
      if (recommendationRoot) recommendationRoot.innerHTML = '<p>로그인 후 개인화 추천 확인 가능</p>';
      if (profileForm) profileForm.innerHTML = '<p class="muted-copy">로그인 후 선호도/프로필을 편집할 수 있습니다.</p>';
      return;
    }

    const profilePayload = await fetchProfile().catch(() => ({ profile: null }));
    const profile = profilePayload.profile || {
      displayName: me.user.displayName || '',
      researchInterests: [],
      preferredSources: [],
      defaultRegion: 'all',
      alertOptIn: false,
      crossLanguageOptIn: false,
    };

    if (profileForm) {
      profileForm.innerHTML = `
        <label>
          표시 이름
          <input class="input" name="displayName" value="${escapeHtml(profile.displayName || '')}" placeholder="연구자 이름" />
        </label>
        <label>
          관심 분야
          <input class="input" name="researchInterests" value="${escapeHtml((profile.researchInterests || []).join(', '))}" placeholder="예: 배터리 AI, 추천 시스템, OCR" />
        </label>
        <label>
          선호 소스
          <input class="input" name="preferredSources" value="${escapeHtml((profile.preferredSources || []).join(', '))}" placeholder="예: kci, dbpia, semantic_scholar" />
        </label>
        <label>
          기본 지역
          <select class="input" name="defaultRegion">
            <option value="all" ${profile.defaultRegion === 'all' ? 'selected' : ''}>전체</option>
            <option value="domestic" ${profile.defaultRegion === 'domestic' ? 'selected' : ''}>국내</option>
            <option value="global" ${profile.defaultRegion === 'global' ? 'selected' : ''}>해외</option>
          </select>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="alertOptIn" ${profile.alertOptIn ? 'checked' : ''} />
          운영 알림 수신
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="crossLanguageOptIn" ${profile.crossLanguageOptIn ? 'checked' : ''} />
          다국어 교차 검색 기반 추천 허용
        </label>
        <div class="action-row">
          <button class="button button--primary" type="submit">프로필 저장</button>
        </div>
      `;
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
                <p class="muted-copy">${(item.highlights || []).length ? `하이라이트: ${item.highlights.join(', ')}` : '하이라이트 없음'}</p>
                <p class="muted-copy">${item.shareToken ? `공유 토큰: ${item.shareToken}` : '공유 비활성'}</p>
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
                <p class="muted-copy">${item.alertEnabled ? `알림 주기: ${item.alertFrequency}` : '알림 꺼짐'}</p>
                <button class="button button--ghost" data-remove-search="${item.id}">삭제</button>
              </div>
            `,
          )
          .join('') || '<p>저장 검색 없음</p>';
    }

    const feed = await fetchRecommendationFeed(6).catch(() => ({ items: [] }));
    if (recommendationRoot) {
      recommendationRoot.innerHTML =
        (feed.items || [])
          .map(
            (item) => `
              <div class="card">
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml((item.explanation || []).join(' · ') || item.summary || '')}</p>
                <span class="muted-copy">추천 점수 ${escapeHtml(item.recommendationScore)}</span>
              </div>
            `,
          )
          .join('') || '<p>개인화 추천이 아직 없습니다.</p>';
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
      alertEnabled: formData.get('alertEnabled') === 'on',
      alertFrequency: formData.get('alertFrequency') || 'daily',
      filters: {},
    });
    await refresh();
  });

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(profileForm);
    await saveProfile({
      displayName: formData.get('displayName'),
      researchInterests: String(formData.get('researchInterests') || ''),
      preferredSources: String(formData.get('preferredSources') || ''),
      defaultRegion: formData.get('defaultRegion'),
      alertOptIn: formData.get('alertOptIn') === 'on',
      crossLanguageOptIn: formData.get('crossLanguageOptIn') === 'on',
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
