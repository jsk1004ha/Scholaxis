import {
  analyzeSimilarity,
  analyzeSimilarityAsync,
  cancelAnalysisJob,
  clearCache,
  fetchAdminOps,
  fetchAdminSummary,
  fetchAnalysisJob,
  fetchLibrary,
  fetchMe,
  fetchPaper,
  fetchPaperAsync,
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

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

function setText(selector, value) {
  const node = qs(selector);
  if (node) {
    node.classList.remove('loading-copy');
    node.classList.remove('loading-copy--title');
    node.textContent = value;
  }
}

function setLink(anchor, href) {
  if (!anchor) return;
  if (href) {
    anchor.href = href;
    anchor.removeAttribute('aria-disabled');
    return;
  }
  anchor.href = '#';
  anchor.setAttribute('aria-disabled', 'true');
}

function detailHealthTone(status = '') {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'critical';
}

function detailHealthLabel(status = '') {
  if (status === 'healthy') return '정상';
  if (status === 'degraded') return '부분 제한';
  return '제한';
}

function findDetailSection(paper, key) {
  return (paper?.detailHealth?.sections || []).find((section) => section.key === key) || null;
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

function formatDateLabel(value = '') {
  if (!value) return '최근 업데이트 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
}

function formatConfidenceLabel(value = '') {
  const label = String(value || '').trim().toLowerCase();
  if (!label || label === 'unknown') return '확인 중';
  if (label === 'high') return '높음';
  if (label === 'medium') return '보통';
  if (label === 'low') return '낮음';
  return value;
}

function getInitials(value = '') {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'S';
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function createEmptyPanel({ title, description, actionHref = '', actionLabel = '' } = {}) {
  return `
    <div class="empty-panel">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ''}
      ${description ? `<p class="muted-copy">${escapeHtml(description)}</p>` : ''}
      ${actionHref && actionLabel ? `<a class="button button--ghost" href="${actionHref}">${escapeHtml(actionLabel)}</a>` : ''}
    </div>
  `;
}

function createAccountCard(user, options = {}) {
  if (!user) {
    return createEmptyPanel({
      title: options.title || '로그인이 필요합니다.',
      description:
        options.description ||
        '로그인 후 저장한 문헌과 추천 자료를 확인할 수 있습니다.',
      actionHref: options.actionHref || './auth.html',
      actionLabel: options.actionLabel || '로그인',
    });
  }

  const pills = [
    user.email,
    options.isAdmin ? '관리자 접근 가능' : '일반 사용자',
    options.extraPill || '',
  ].filter(Boolean);

  return `
    <div class="account-summary account-card">
      <div class="account-identity">
        <div class="account-avatar">${escapeHtml(getInitials(user.displayName || user.email || 'S'))}</div>
        <div class="account-title">
          <strong>${escapeHtml(user.displayName || user.email || '사용자')}</strong>
          <span>${escapeHtml(user.email || '이메일 정보 없음')}</span>
        </div>
      </div>
      <div class="account-pill-row">
        ${pills.map((pill) => `<span class="account-pill${pill.includes('관리자') ? ' account-pill--accent' : ''}">${escapeHtml(pill)}</span>`).join('')}
      </div>
      ${options.description ? `<p class="muted-copy">${escapeHtml(options.description)}</p>` : ''}
    </div>
  `;
}

function createLibraryItemCard(item = {}) {
  const title = item.note || item.canonicalId || '저장된 문헌';
  const tags = (item.highlights || []).filter(Boolean);
  const shareLabel = item.shareToken ? `공유 토큰 · ${item.shareToken}` : '공유 비활성';
  return `
    <article class="panel-surface saved-item">
      <div>
        <strong class="saved-item__title">${escapeHtml(title)}</strong>
        <span class="saved-item__meta">${escapeHtml(item.canonicalId || '문헌 ID 없음')} · ${escapeHtml(formatDateLabel(item.updatedAt || item.createdAt))}</span>
      </div>
      <p class="saved-item__desc">${escapeHtml(item.note || '저장된 문헌 메모가 아직 없습니다.')}</p>
      ${
        tags.length
          ? `<div class="saved-item__tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
          : ''
      }
      <div class="saved-item__footer">
        <span class="account-pill">${escapeHtml(shareLabel)}</span>
        <div class="action-row">
          <a class="button button--ghost" href="./detail.html?id=${encodeURIComponent(item.canonicalId || '')}">상세 열기</a>
          <button class="button button--ghost" data-remove-library="${escapeHtml(item.canonicalId || '')}">삭제</button>
        </div>
      </div>
    </article>
  `;
}

function createSavedSearchCard(item = {}) {
  const alerts = item.alertEnabled ? `알림 · ${item.alertFrequency}` : '알림 꺼짐';
  return `
    <article class="panel-surface saved-item">
      <div>
        <strong class="saved-item__title">${escapeHtml(item.label || item.queryText || '저장된 검색')}</strong>
        <span class="saved-item__meta">${escapeHtml(formatDateLabel(item.createdAt))}</span>
      </div>
      <p class="saved-item__desc">${escapeHtml(item.queryText || '검색어 없음')}</p>
      <div class="saved-item__footer">
        <span class="account-pill">${escapeHtml(alerts)}</span>
        <div class="action-row">
          <a class="button button--ghost" href="./results.html?q=${encodeURIComponent(item.queryText || '')}">다시 검색</a>
          <button class="button button--ghost" data-remove-search="${escapeHtml(item.id || '')}">삭제</button>
        </div>
      </div>
    </article>
  `;
}

function createRecommendationCard(item = {}) {
  const targetId = item.id || item.canonicalId || '';
  return `
    <article class="panel-surface saved-item">
      <div>
        <strong class="saved-item__title">${escapeHtml(item.title || '추천 문헌')}</strong>
        <span class="saved-item__meta">${escapeHtml(item.source || 'Scholaxis')} · 추천 점수 ${escapeHtml(item.recommendationScore ?? '-')}</span>
      </div>
      <p class="saved-item__desc">${escapeHtml((item.explanation || []).join(' · ') || item.summary || '추천 근거를 정리하는 중입니다.')}</p>
      <div class="saved-item__footer">
        <div class="saved-item__tags">
          ${(item.tags || item.keywords || []).slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        ${targetId ? `<a class="button button--ghost" href="./detail.html?id=${encodeURIComponent(targetId)}">상세 보기</a>` : ''}
      </div>
    </article>
  `;
}

function setCountLabel(selector, count, suffix = '건') {
  const node = qs(selector);
  if (node) node.textContent = `${count}${suffix}`;
}

function setHidden(node, hidden) {
  if (!node) return;
  node.hidden = hidden;
}

function setAuthPageMode(form, mode) {
  if (!form) return;
  const modeInput = qs('input[name="mode"]', form);
  const displayNameField = qs('[data-auth-display-name]', form);
  const submitButton = qs('[data-auth-submit]', form);
  if (modeInput) modeInput.value = mode;
  if (displayNameField) displayNameField.hidden = mode !== 'register';
  if (submitButton) submitButton.textContent = mode === 'register' ? '회원가입' : '로그인';
  qsa('[data-auth-tab]').forEach((button) => {
    const active = button.dataset.authTab === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function buildSearchParams(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (typeof value === 'string' && value.trim()) params.append(key, value.trim());
  }
  return params;
}

function initChoiceGroups(scope = document) {
  qsa('[data-choice-group]', scope).forEach((group) => {
    const hidden = qs('input[type="hidden"]', group);
    const buttons = qsa('[data-choice-value]', group);
    if (!hidden || !buttons.length) return;

    const sync = (value) => {
      hidden.value = value;
      buttons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.choiceValue === value);
      });
    };

    sync(hidden.value || buttons[0]?.dataset.choiceValue || '');

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        sync(button.dataset.choiceValue || '');
      });
    });
  });
}

function initSegmentedControls(form) {
  qsa('[data-segmented-control]', form).forEach((group) => {
    const field = group.dataset.segmentedControl;
    const hidden = qs(`input[name="${field}"]`, form);
    if (!hidden) return;
    qsa('.segment-chip', group).forEach((button) => {
      button.addEventListener('click', () => {
        hidden.value = button.dataset.value || '';
        qsa('.segment-chip', group).forEach((candidate) => {
          candidate.classList.toggle('is-active', candidate === button);
        });
      });
    });
  });
}

function formatCount(value = 0) {
  return new Intl.NumberFormat('ko-KR').format(Number(value || 0));
}

function initialsFromName(name = '') {
  const source = String(name || '').trim();
  if (!source) return 'SC';
  return Array.from(source).slice(0, 2).join('').toUpperCase();
}

function sanitizeRedirectTarget(value = '') {
  const page = String(value || '').trim().replace(/[^a-z]/gi, '').toLowerCase();
  if (page === 'admin') return './admin.html';
  if (page === 'results') return './results.html';
  if (page === 'similarity') return './similarity.html';
  return './library.html';
}

function setLibraryMetrics({ libraryCount = 0, searchCount = 0, feedCount = 0, sessionLabel = '비로그인' } = {}) {
  setText('[data-library-count]', formatCount(libraryCount));
  setText('[data-library-search-count]', formatCount(searchCount));
  setText('[data-saved-search-count]', `${formatCount(searchCount)}건`);
  setText('[data-library-feed-count]', formatCount(feedCount));
  setText('[data-recommendation-count]', `${formatCount(feedCount)}건`);
  setText('[data-library-session-badge]', sessionLabel);
  setText('[data-library-auth-pill]', sessionLabel);
}

function renderAccountSummary(user = null) {
  if (!user) {
    return `
      <div class="empty-panel">
        <strong>로그인이 필요합니다.</strong>
        <p>로그인 후 저장 문헌과 추천을 확인할 수 있습니다.</p>
      </div>
    `;
  }
  return `
    <div class="account-identity">
      <div class="account-avatar">${escapeHtml(initialsFromName(user.displayName || user.email || 'SC'))}</div>
      <div class="account-title">
        <strong>${escapeHtml(user.displayName || '이름 없음')}</strong>
        <span>${escapeHtml(user.email || '')}</span>
      </div>
    </div>
    <div class="account-pill-row">
      <span class="account-pill account-pill--accent">${user.isAdmin ? '관리자 계정' : '일반 계정'}</span>
      <span class="account-pill">세션 활성</span>
      <span class="account-pill">${user.email?.includes('@') ? '이메일 인증형 로그인' : '로컬 계정'}</span>
    </div>
  `;
}

function setFormDisabled(form, disabled) {
  if (!form) return;
  qsa('input, select, textarea, button', form).forEach((field) => {
    field.disabled = disabled;
  });
}

function createSkeletonLines(count, variant = 'medium') {
  return Array.from({ length: count }, (_, index) => {
    const size =
      index === 0 && variant === 'card'
        ? 'skeleton-line--title'
        : index === count - 1
          ? 'skeleton-line--short'
          : variant === 'tiny'
            ? 'skeleton-line--tiny'
            : 'skeleton-line--medium';
    return `<span class="skeleton-line ${size}"></span>`;
  }).join('');
}

function createResultSkeletonCard() {
  return `
    <article class="result-card">
      <div class="result-card__meta">
        <span class="skeleton-pill"></span>
        <span class="skeleton-line skeleton-line--tiny"></span>
        <span class="skeleton-line skeleton-line--tiny"></span>
      </div>
      <div class="skeleton-stack">
        ${createSkeletonLines(1, 'card')}
        ${createSkeletonLines(3)}
      </div>
      <div class="result-card__footer">
        <div class="skeleton-stack">${createSkeletonLines(2, 'tiny')}</div>
        <div class="skeleton-stack">${createSkeletonLines(2, 'tiny')}</div>
      </div>
      <div class="action-row">
        <span class="skeleton-pill"></span>
        <span class="skeleton-pill"></span>
      </div>
    </article>
  `;
}

function createSectionSkeleton(count = 3) {
  return Array.from({ length: count }, () => `<div class="panel-surface skeleton-stack">${createSkeletonLines(3)}</div>`).join('');
}

function createConstellationLoaderPanel(label = '불러오는 중입니다.') {
  return `
    <div class="loader-panel">
      <div class="constellation-loader" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p class="muted-copy">${escapeHtml(label)}</p>
    </div>
  `;
}

function setLiveStatus(node, message, tone = 'loading') {
  if (!node) return;
  node.textContent = message;
  node.className = `live-status live-status--${tone}`;
}

function setButtonBusy(button, busy, busyLabel = '처리 중...') {
  if (!button) return;
  if (!button.dataset.label) {
    button.dataset.label = button.textContent || '';
  }
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.textContent = busy ? busyLabel : button.dataset.label;
}

function cycleStatusMessages(node, messages, intervalMs = 1400, tone = 'loading') {
  if (!node || !messages?.length) {
    return () => {};
  }
  let index = 0;
  setLiveStatus(node, messages[index], tone);
  const timer = window.setInterval(() => {
    index = (index + 1) % messages.length;
    setLiveStatus(node, messages[index], tone);
  }, intervalMs);
  return () => window.clearInterval(timer);
}

function progressFromJob(job = null) {
  if (!job) return { percent: 8, label: '작업을 준비하는 중입니다.', tone: 'loading', animated: true };
  if (job.status === 'queued') return { percent: Math.max(10, Math.min(24, Number(job.progress || 16))), label: job.stageLabel || '작업이 대기열에 있습니다.', tone: 'loading', animated: true };
  if (job.status === 'running') return { percent: Math.max(24, Math.min(92, Number(job.progress || 55))), label: job.stageLabel || '작업을 계산하고 있습니다.', tone: 'loading', animated: true };
  if (job.status === 'completed') return { percent: 100, label: '작업이 완료되었습니다.', tone: 'success', animated: false };
  if (job.status === 'cancelled') return { percent: 100, label: '작업이 취소되었습니다.', tone: 'warning', animated: false };
  return { percent: 100, label: '작업이 실패했습니다.', tone: 'critical', animated: false };
}

function setAnalysisProgress({ bar, labelNode, statusNode, cancelButton, job }) {
  const progress = progressFromJob(job);
  if (bar) {
    bar.style.width = `${progress.percent}%`;
    bar.classList.toggle('analysis-progress__bar--animated', progress.animated);
  }
  if (labelNode) labelNode.textContent = progress.label;
  if (statusNode && job) setLiveStatus(statusNode, progress.label, progress.tone);
  if (cancelButton) {
    cancelButton.hidden = !job || !['queued', 'running'].includes(job.status);
  }
}

function renderResultsLoadingState(resultsRoot) {
  if (!resultsRoot) return;
  resultsRoot.innerHTML = Array.from({ length: 3 }, () => createResultSkeletonCard()).join('');
}

function renderSourceListLoading(sourceRoot) {
  if (!sourceRoot) return;
  sourceRoot.innerHTML = Array.from({ length: 4 }, () => `<li><span class="skeleton-line skeleton-line--medium"></span></li>`).join('');
}

function renderEmptyState(resultsRoot, queryText = '') {
  if (!resultsRoot) return;
  const suggestions = [queryText, '국내 우선 AI 반도체', 'KCI 교육 AI', '배터리 안전성']
    .filter(Boolean)
    .slice(0, 4);
  resultsRoot.innerHTML = `
    <article class="card empty-state">
      <div>
        <span class="section-eyebrow">No results yet</span>
        <h3>검색 결과가 없습니다</h3>
        <p>검색어를 바꾸거나 범위를 넓혀 다시 시도해 보세요.</p>
      </div>
      <div class="empty-state__suggestions">
        ${suggestions.map((query) => `<a class="chip" href="./results.html?q=${encodeURIComponent(query)}">${escapeHtml(query)}</a>`).join('')}
      </div>
      <div class="empty-state__actions">
        <a class="button button--primary" href="./index.html">홈으로 돌아가기</a>
        <a class="button button--ghost" href="./similarity.html">유사도 분석으로 이동</a>
      </div>
    </article>
  `;
}

function createPaperCard(paper) {
  const article = document.createElement('article');
  article.className = 'result-card';
  const detailHref = `./detail.html?id=${encodeURIComponent(paper.id)}`;
  const similarityHref = `./similarity.html?paperId=${encodeURIComponent(paper.id)}`;
  const sourceHref = paper.originalUrl || paper.sourceUrl || '#';
  article.innerHTML = `
    <div class="result-card__meta">
      <span class="pill pill--muted">${paper.badge}</span>
      <span>${paper.source}</span>
      <span>${paper.sourceType ?? ''}</span>
      <span>${paper.year}</span>
      <span>${paper.region}</span>
    </div>
    <h3><a href="${detailHref}">${paper.title}</a></h3>
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
    <div class="action-row" style="margin-top: 0.75rem">
      <a class="button button--ghost" href="${detailHref}">상세 보기</a>
      <a class="button button--ghost" href="${similarityHref}">유사도 분석</a>
      ${sourceHref !== '#' ? `<a class="button button--ghost" href="${sourceHref}" target="_blank" rel="noreferrer noopener">원문 링크</a>` : ''}
    </div>
  `;
  return article;
}

function navigateToResults(form) {
  const params = buildSearchParams(form);
  window.location.href = `./results.html?${params.toString()}`;
}

function renderSourceList(searchPayload, sourceRoot) {
  if (!sourceRoot) return;
  const sources = searchPayload.sourceStatus?.map((item) => item.source) ?? searchPayload.filters?.sources ?? [];
  sourceRoot.innerHTML = sources.length
    ? sources.map((source) => `<li>${source}</li>`).join('')
    : '<li>활성화된 소스가 아직 없습니다.</li>';
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
    renderEmptyState(resultsRoot, searchPayload.query);
    return;
  }

  (searchPayload.items ?? []).forEach((paper) => {
    resultsRoot.appendChild(createPaperCard(paper));
  });
}

function initHomePage() {
  const form = qs('[data-search-form]');
  if (!form) return;
  initChoiceGroups(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    navigateToResults(form);
  });

  qsa('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = qs('textarea[name="q"], input[name="q"]', form);
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
  const sourceRoot = qs('[data-source-list]');

  const params = new URLSearchParams(window.location.search);
  const query = {
    q: params.get('q') || 'AI 반도체 설계 자동화',
    region: params.get('region') || 'all',
    sourceType: params.get('sourceType') || 'all',
    sort: params.get('sort') || 'relevance',
    live: params.get('live') || '',
    autoLive: params.get('autoLive') || '',
  };
  renderResultsLoadingState(resultsRoot);
  renderSourceListLoading(sourceRoot);
  setLiveStatus(progressRoot, '검색을 불러오는 중입니다.', 'loading');

  const searchPayload = await fetchSearchStream(query, {
    onSummary(payload) {
      setText('[data-query-label]', payload.query || query.q);
      setLiveStatus(progressRoot, payload.summary || '검색을 시작했습니다.', 'loading');
    },
    onProgress(payload) {
      setLiveStatus(progressRoot, payload.message || '검색을 진행 중입니다.', 'loading');
      if (payload.sourceStatus) renderSourceList(payload, sourceRoot);
    },
    onResults(payload) {
      renderSearchPayload(payload, resultsRoot);
      setLiveStatus(progressRoot, '검색 결과를 불러왔습니다.', 'success');
    },
    onDone(payload) {
      renderSearchPayload(payload, resultsRoot);
      setLiveStatus(progressRoot, `${payload.total}개 결과를 찾았습니다.`, 'success');
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

function primeDetailLoadingState() {
  const detailStatus = qs('[data-detail-status]');
  const networkRoot = qs('[data-network-root]');
  const referenceRoot = qs('[data-reference-results]');
  const citationRoot = qs('[data-citation-results]');
  const relatedRoot = qs('[data-related-results]');
  const recommendationsRoot = qs('[data-detail-recommendations]');
  const healthSectionsRoot = qs('[data-detail-health-sections]');
  const comparisonMatrixRoot = qs('[data-comparison-matrix]');
  const graphPathsRoot = qs('[data-graph-paths]');
  const sourceStatusRoot = qs('[data-source-status]');
  const alternateSourcesRoot = qs('[data-alternate-sources]');
  const tagsRoot = qs('[data-detail-tags]');
  const suggestedQueriesRoot = qs('[data-suggested-queries]');

  setLiveStatus(detailStatus, '상세 분석을 준비하는 중입니다.', 'loading');
  if (networkRoot) networkRoot.innerHTML = `<div class="panel-surface skeleton-stack">${createSkeletonLines(4)}</div>`;
  if (referenceRoot) referenceRoot.innerHTML = createSectionSkeleton(2);
  if (citationRoot) citationRoot.innerHTML = createSectionSkeleton(2);
  if (relatedRoot) relatedRoot.innerHTML = createSectionSkeleton(2);
  if (recommendationsRoot) recommendationsRoot.innerHTML = createSectionSkeleton(2);
  if (healthSectionsRoot) healthSectionsRoot.innerHTML = createSectionSkeleton(2);
  if (comparisonMatrixRoot) comparisonMatrixRoot.innerHTML = `<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>`;
  if (graphPathsRoot) graphPathsRoot.innerHTML = `<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>`;
  if (sourceStatusRoot) sourceStatusRoot.innerHTML = `<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>`;
  if (alternateSourcesRoot) alternateSourcesRoot.innerHTML = `<li><span class="skeleton-line skeleton-line--medium"></span></li>`;
  if (tagsRoot) tagsRoot.innerHTML = '<span class="skeleton-pill"></span><span class="skeleton-pill"></span>';
  if (suggestedQueriesRoot) suggestedQueriesRoot.innerHTML = '<span class="skeleton-pill"></span><span class="skeleton-pill"></span><span class="skeleton-pill"></span>';
}

async function initDetailPage() {
  const root = qs('[data-detail-root]');
  if (!root) return;
  primeDetailLoadingState();
  const detailStatus = qs('[data-detail-status]');
  const detailProgressBar = qs('[data-detail-progress-bar]');
  const detailProgressLabel = qs('[data-detail-progress-label]');
  const detailCancelButton = qs('[data-detail-cancel]');

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    setLiveStatus(detailStatus, '문서를 찾을 수 없습니다.', 'critical');
    setText('[data-detail-title]', '문서가 선택되지 않았습니다.');
    setText('[data-detail-subtitle]', '검색 결과에서 문서를 선택한 뒤 다시 열어 주세요.');
    setText('[data-detail-authors]', 'detail-id-missing');
    setText('[data-detail-abstract]', '상세 정보를 보려면 검색 결과에서 문서를 선택해 주세요.');
    setText('[data-detail-insight]', '선택된 문서가 없습니다.');
    setText('[data-detail-source]', '문서 선택 필요');
    setText('[data-detail-badge]', 'No document');
    setText('[data-detail-health-summary]', '문서 정보가 없어 상태를 표시할 수 없습니다.');
    return;
  }
  let paper;
  let currentDetailJobId = '';
  let detailCancelled = false;
  detailCancelButton?.addEventListener('click', async () => {
    if (!currentDetailJobId) return;
    detailCancelled = true;
    await cancelAnalysisJob(currentDetailJobId).catch(() => null);
    setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job: { status: 'cancelled', progress: 100 } });
  });
  const stopDetailStatusCycle = cycleStatusMessages(
    detailStatus,
    ['상세 분석을 준비하고 있습니다.', '문서 정보와 추천 자료를 불러오고 있습니다.', '연결 정보를 정리하고 있습니다.'],
    1400,
    'loading',
  );
  try {
    paper = await fetchPaperAsync(id, {
      intervalMs: 500,
      timeoutMs: 45000,
      isCancelled: () => detailCancelled,
      onAccepted: (job) => {
        currentDetailJobId = job.id;
        setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job });
      },
      onProgress: (job) => {
        setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job });
      },
    });
    stopDetailStatusCycle();
    setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job: { status: 'completed', progress: 100 } });
  } catch (error) {
    stopDetailStatusCycle();
    if (String(error?.message || '').startsWith('analysis-job-cancelled:')) {
      setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job: { status: 'cancelled', progress: 100 } });
      setText('[data-detail-title]', '상세 분석이 취소되었습니다.');
      setText('[data-detail-subtitle]', '다시 열면 분석을 다시 시작합니다.');
      setText('[data-detail-authors]', currentDetailJobId || 'detail-analysis-cancelled');
      return;
    }
    setAnalysisProgress({ bar: detailProgressBar, labelNode: detailProgressLabel, statusNode: detailStatus, cancelButton: detailCancelButton, job: { status: 'failed', progress: 100 } });
    setLiveStatus(detailStatus, '상세 데이터를 불러오지 못했습니다.', 'critical');
    setText('[data-detail-title]', '상세 문서를 불러오지 못했습니다.');
    setText('[data-detail-subtitle]', '잠시 후 다시 시도해 주세요.');
    setText('[data-detail-authors]', '일시적인 오류');
    setText('[data-detail-abstract]', '상세 정보를 불러오는 동안 오류가 발생했습니다.');
    setText('[data-detail-insight]', '다시 시도해 주세요.');
    setText('[data-detail-source]', `문서 ID · ${id}`);
    setText('[data-detail-badge]', '오류');
    setText('[data-detail-novelty]', '일부 정보를 불러오지 못했습니다.');
    setText('[data-detail-source-links]', '잠시 후 다시 시도해 주세요.');
    setText('[data-detail-health-summary]', '일부 정보를 불러오지 못했습니다.');
    return;
  }

  setText('[data-detail-title]', paper.title);
  setText('[data-detail-subtitle]', paper.subtitle || paper.novelty || '');
  setText('[data-detail-authors]', `${formatAuthors(paper.authors)} — ${paper.affiliation || paper.source || ''}`);
  setText('[data-detail-abstract]', paper.abstract || paper.summary || '초록 정보가 아직 없습니다.');
  setText('[data-detail-insight]', paper.explanation?.summary || paper.insight || '핵심 인사이트를 계산 중입니다.');
  setText('[data-detail-source]', [paper.source, paper.year].filter(Boolean).join(' · '));
  setText('[data-detail-badge]', paper.badge || paper.source || 'Scholaxis');
  setText('[data-metric-citations]', String(paper.metrics?.citations ?? '-'));
  setText('[data-metric-references]', String(paper.metrics?.references ?? '-'));
  setText('[data-metric-impact]', String(paper.metrics?.impact ?? paper.metrics?.insightScore ?? '-'));
  setText('[data-metric-velocity]', String(paper.metrics?.velocity ?? paper.metrics?.freshness ?? '-'));
  setText('[data-detail-novelty]', paper.novelty || paper.summary || '기여 요약이 아직 없습니다.');
  setText(
    '[data-detail-health-summary]',
    paper.detailHealth
      ? `${detailHealthLabel(paper.detailHealth.status)} · 완성도 ${paper.detailHealth.score}% · ${paper.detailHealth.summary}`
      : '상세 상태를 계산하지 못했습니다.',
  );
  setLiveStatus(
    detailStatus,
    paper.detailHealth?.status === 'degraded'
      ? '부분 제한이 있지만 핵심 상세 데이터를 불러왔습니다.'
      : '상세 분석이 준비되었습니다.',
    paper.detailHealth?.status === 'degraded' ? 'warning' : 'success',
  );

  const tagsRoot = qs('[data-detail-tags]');
  if (tagsRoot) {
    tagsRoot.innerHTML = (paper.tags ?? []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  }

  const metadataRoot = qs('[data-detail-metadata]');
  if (metadataRoot) {
    metadataRoot.innerHTML = (paper.detailHealth?.metadata || []).length
      ? paper.detailHealth.metadata
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.label)}</strong> · ${escapeHtml(item.value || '미확보')}${item.status === 'missing' ? ' · 확인 필요' : ''}</li>`,
          )
          .join('')
      : '<li>메타데이터 스냅샷을 아직 계산하지 못했습니다.</li>';
  }

  const linkHealthRoot = qs('[data-detail-link-health]');
  if (linkHealthRoot) {
    linkHealthRoot.textContent = paper.detailHealth?.linkSummary || '원문/상세 링크 상태를 계산하지 못했습니다.';
  }

  const sourceLink = qs('[data-source-link]');
  const originalLink = qs('[data-detail-original-link]');
  const detailLink = qs('[data-detail-detail-link]');
  for (const link of [sourceLink, originalLink]) {
    setLink(link, paper.originalUrl || paper.sourceUrl || '');
  }
  setLink(detailLink, paper.sourceUrl || paper.originalUrl || '');

  const networkRoot = qs('[data-network-root]');
  if (networkRoot) {
    networkRoot.innerHTML = renderNetwork([
      { x: 50, y: 50, label: '현재 문헌', meta: paper.badge || paper.source || 'Scholaxis', tone: 'primary' },
      { x: 22, y: 24, label: '선행 참고', meta: `${paper.references?.length || 0}건`, tone: 'secondary' },
      { x: 78, y: 24, label: '후속 인용', meta: `${paper.citations?.length || 0}건`, tone: 'accent' },
      { x: 25, y: 78, label: '추천 비교', meta: `${paper.recommendations?.length || 0}건`, tone: 'muted' },
      { x: 78, y: 78, label: '원문 링크', meta: paper.source || 'source', tone: 'secondary' },
    ]);
  }

  const graphSectionSummaryRoot = qs('[data-graph-section-summary]');
  if (graphSectionSummaryRoot) {
    graphSectionSummaryRoot.textContent =
      findDetailSection(paper, 'graph')?.summary || '그래프 기반 확장 상태를 계산하지 못했습니다.';
  }

  const referenceRoot = qs('[data-reference-results]');
  if (referenceRoot) {
    referenceRoot.innerHTML = '';
    (paper.references || []).forEach((item) => referenceRoot.appendChild(createPaperCard(item)));
    if (!paper.references?.length) referenceRoot.innerHTML = '<p class="muted-copy">선행 참고문헌을 아직 찾지 못했습니다.</p>';
  }

  const citationRoot = qs('[data-citation-results]');
  if (citationRoot) {
    citationRoot.innerHTML = '';
    (paper.citations || []).forEach((item) => citationRoot.appendChild(createPaperCard(item)));
    if (!paper.citations?.length) citationRoot.innerHTML = '<p class="muted-copy">후속 인용 자료를 아직 찾지 못했습니다.</p>';
  }

  const relatedRoot = qs('[data-related-results]');
  if (relatedRoot) {
    relatedRoot.innerHTML = '';
    (paper.related || []).forEach((relatedPaper) => relatedRoot.appendChild(createPaperCard(relatedPaper)));
    if (!paper.related?.length) relatedRoot.innerHTML = '<p class="muted-copy">연결 자료가 아직 충분하지 않습니다.</p>';
  }

  const relatedSummaryRoot = qs('[data-detail-related-summary]');
  if (relatedSummaryRoot) {
    relatedSummaryRoot.textContent =
      findDetailSection(paper, 'related')?.summary || '함께 읽을 자료 상태를 계산하지 못했습니다.';
  }

  const explanationSummaryRoot = qs('[data-detail-explanation-summary]');
  if (explanationSummaryRoot) {
    explanationSummaryRoot.textContent =
      paper.graphNarrative?.summary ||
      paper.explanation?.summary ||
      '그래프 기반 설명이 아직 부족합니다.';
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
    if (!paper.recommendations?.length) recommendationsRoot.innerHTML = '<p class="muted-copy">추천 비교 문헌이 아직 부족합니다.</p>';
  }

  const recommendationSummaryRoot = qs('[data-detail-recommendations-summary]');
  if (recommendationSummaryRoot) {
    recommendationSummaryRoot.textContent =
      findDetailSection(paper, 'recommendations')?.summary || '추천/비교 상태를 계산하지 못했습니다.';
  }

  const graphPathsRoot = qs('[data-graph-paths]');
  if (graphPathsRoot) {
    graphPathsRoot.innerHTML = (paper.graphPaths || []).length
      ? paper.graphPaths
          .map((path) => `<li>${escapeHtml(path.summary || '')}${path.relation ? ` · ${escapeHtml(path.relation)}` : ''}${path.hop ? ` · ${escapeHtml(path.hop)} hop` : ''}</li>`)
          .join('')
      : '<li>그래프 경로 정보가 아직 부족합니다.</li>';
  }

  const comparisonMatrixRoot = qs('[data-comparison-matrix]');
  if (comparisonMatrixRoot) {
    comparisonMatrixRoot.innerHTML = (paper.comparisonMatrix || []).length
      ? paper.comparisonMatrix
          .map(
            (row) =>
              `<li><strong>${escapeHtml(row.lane)}</strong> · <a href="./detail.html?id=${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a>${row.comparison?.length ? ` — ${escapeHtml(row.comparison.join(' / '))}` : ''}</li>`,
          )
          .join('')
      : '<li>직접 비교 메모가 아직 부족합니다.</li>';
  }

  const suggestedQueriesRoot = qs('[data-suggested-queries]');
  if (suggestedQueriesRoot) {
    suggestedQueriesRoot.innerHTML = (paper.suggestedQueries || []).length
      ? paper.suggestedQueries
          .map((query) => `<a class="chip" href="./results.html?q=${encodeURIComponent(query)}">${escapeHtml(query)}</a>`)
          .join('')
      : '<span class="muted-copy">추천 질의가 아직 없습니다.</span>';
  }

  const sourceStatusRoot = qs('[data-source-status]');
  if (sourceStatusRoot) {
    sourceStatusRoot.innerHTML = (paper.sourceStatus || []).length
      ? paper.sourceStatus
          .map((item) => `<li>${escapeHtml(item.source)} · ${escapeHtml(item.status)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}${item.detailUrl ? ` · <a href="${escapeHtml(item.detailUrl)}" target="_blank" rel="noreferrer noopener">source</a>` : ''}</li>`)
          .join('')
      : '<li>출처 상태 정보가 아직 없습니다.</li>';
  }

  const sourceLinksSummaryRoot = qs('[data-detail-source-links]');
  if (sourceLinksSummaryRoot) {
    const summary = [
      paper.originalUrl ? `원문 ${paper.originalUrl}` : null,
      paper.sourceUrl && paper.sourceUrl !== paper.originalUrl ? `상세 ${paper.sourceUrl}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    sourceLinksSummaryRoot.textContent = summary || '연결 가능한 원문/상세 링크가 아직 없습니다.';
  }

  const healthWarningsRoot = qs('[data-detail-health-warnings]');
  if (healthWarningsRoot) {
    healthWarningsRoot.innerHTML = (paper.detailHealth?.warnings || []).length
      ? paper.detailHealth.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
      : '<li>현재 확인된 제한 구간이 없습니다.</li>';
  }

  const healthSectionsRoot = qs('[data-detail-health-sections]');
  if (healthSectionsRoot) {
    healthSectionsRoot.innerHTML = (paper.detailHealth?.sections || []).length
      ? paper.detailHealth.sections
          .map(
            (section) => `
              <div class="alert-card alert-card--${detailHealthTone(section.status)}">
                <strong>${escapeHtml(section.title)} · ${escapeHtml(detailHealthLabel(section.status))}</strong>
                <p>${escapeHtml(section.summary)} (${escapeHtml(section.count)}/${escapeHtml(section.total)})</p>
              </div>
            `,
          )
          .join('')
      : '<p class="muted-copy">구간별 상태를 계산하지 못했습니다.</p>';
  }

  const alternateSourcesRoot = qs('[data-alternate-sources]');
  if (alternateSourcesRoot) {
    alternateSourcesRoot.innerHTML = (paper.alternateSources || []).length
      ? paper.alternateSources
          .map((source) => `<li>${escapeHtml(source)}${paper.source === source ? ' · 대표 출처' : ''}</li>`)
          .join('')
      : '<li>추가 연결 출처가 아직 없습니다.</li>';
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
  const confidenceSummary = qs('[data-confidence-summary]');
  const confidenceReasons = qs('[data-confidence-reasons]');
  const confidenceWarnings = qs('[data-confidence-warnings]');
  const compared = qs('[data-compared-paper]');
  const recommendations = qs('[data-recommendations]');
  const priorStudiesSummary = qs('[data-prior-studies-summary]');
  const priorStudies = qs('[data-prior-studies]');
  const fileName = qs('[data-upload-name]');
  const extractionSummary = qs('[data-extraction-summary]');
  const topMatches = qs('[data-top-matches]');
  const submitButton = qs('button[type="submit"]', form);
  const scoreRing = score?.closest('.score-ring');
  const similarityStatus = qs('[data-similarity-status]');
  const similarityProgressBar = qs('[data-similarity-progress-bar]');
  const similarityProgressLabel = qs('[data-similarity-progress-label]');
  const similarityCancelButton = qs('[data-similarity-cancel]');
  const flowHint = qs('[data-similarity-flow-hint]');
  let currentSimilarityJobId = '';
  let similarityCancelled = false;

  const primeSimilarityLoadingState = (message = '비교 문헌을 찾고 있습니다.') => {
    if (score) score.textContent = '분석 중';
    scoreRing?.classList.add('is-loading');
    setLiveStatus(similarityStatus, message, 'loading');
    if (context) context.innerHTML = createSkeletonLines(3);
    if (novelty) novelty.innerHTML = createSkeletonLines(3);
    if (structure) structure.innerHTML = createSkeletonLines(3);
    if (differentiation) differentiation.innerHTML = createSkeletonLines(3);
    if (differentiators) differentiators.innerHTML = '<span class="skeleton-pill"></span><span class="skeleton-pill"></span>';
    if (sectionComparisons) sectionComparisons.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (semanticDiff) semanticDiff.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (recommendations) recommendations.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (priorStudies) priorStudies.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (priorStudiesSummary) priorStudiesSummary.textContent = '참고문헌과 관련 문헌을 정리하고 있습니다.';
    if (topMatches) topMatches.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (extractionSummary) extractionSummary.textContent = message;
    if (flowHint) {
      flowHint.textContent = '문서를 올리면 순서대로 분석합니다.';
    }
  };

  primeSimilarityLoadingState('문서를 올리면 분석을 시작합니다.');
  setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job: null });

  similarityCancelButton?.addEventListener('click', async () => {
    if (!currentSimilarityJobId) return;
    similarityCancelled = true;
    await cancelAnalysisJob(currentSimilarityJobId).catch(() => null);
    setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job: { status: 'cancelled', progress: 100 } });
    setButtonBusy(submitButton, false);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    currentSimilarityJobId = '';
    similarityCancelled = false;
    setButtonBusy(submitButton, true, '유사도 분석 중...');
    primeSimilarityLoadingState('문서를 분석하고 있습니다.');
    const stopStatusCycle = cycleStatusMessages(
      similarityStatus,
      ['문서를 업로드하고 있습니다.', '텍스트를 정리하고 있습니다.', '비교 문헌을 찾고 있습니다.', '결과를 정리하고 있습니다.'],
      1300,
      'loading',
    );
    let result;
    try {
      result = await analyzeSimilarityAsync(formData, {
        intervalMs: 500,
        timeoutMs: 180000,
        isCancelled: () => similarityCancelled,
        onAccepted: (job) => {
          currentSimilarityJobId = job.id;
          setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job });
        },
        onProgress: (job) => {
          setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job });
        },
      });
    } catch (error) {
      stopStatusCycle();
      if (String(error?.message || '').startsWith('analysis-job-cancelled:')) {
        setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job: { status: 'cancelled', progress: 100 } });
        if (extractionSummary) extractionSummary.textContent = '유사도 분석 작업이 취소되었습니다.';
        if (flowHint) flowHint.textContent = '다시 실행하면 새 분석이 시작됩니다.';
        scoreRing?.classList.remove('is-loading');
        setButtonBusy(submitButton, false);
        return;
      }
      if (extractionSummary) {
        extractionSummary.textContent = `유사도 분석 요청이 실패했습니다: ${error.message || 'similarity-request-failed'}`;
      }
      if (flowHint) {
        flowHint.textContent = '분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      }
      setLiveStatus(similarityStatus, '유사도 분석 요청이 실패했습니다.', 'critical');
      scoreRing?.classList.remove('is-loading');
      setButtonBusy(submitButton, false);
      return;
    }
    stopStatusCycle();
    setAnalysisProgress({ bar: similarityProgressBar, labelNode: similarityProgressLabel, statusNode: similarityStatus, cancelButton: similarityCancelButton, job: { status: 'completed', progress: 100 } });
    scoreRing?.classList.remove('is-loading');
    if (score) score.textContent = `${result.similarityScore}%`;
    if (context) context.textContent = result.sharedContext;
    if (novelty) novelty.textContent = result.novelty;
    if (structure) structure.textContent = result.structure || '섹션 비교 결과가 없습니다.';
    if (differentiation) {
      differentiation.textContent =
        [result.sameTopicStatement || result.topicVerdict, result.differentiation]
          .filter(Boolean)
          .join(' ') || '차별성 분석 결과가 없습니다.';
    }
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
    if (risk) {
      risk.textContent = [
        result.risk,
        result.topicVerdict,
        result.confidence ? `신뢰도 ${formatConfidenceLabel(result.confidence.label)} ${result.confidence.score || 0}%` : '',
        result.relationship ? `관계: ${result.relationship}` : ''
      ].filter(Boolean).join(' · ');
    }
    if (confidenceSummary) {
      const coverage = result.confidence?.structureCoverage;
      confidenceSummary.textContent = result.confidence
        ? [
            `분석 신뢰도 ${formatConfidenceLabel(result.confidence.label)} ${result.confidence.score || 0}%`,
            coverage ? `입력 섹션 ${coverage.inputSections || 0}개 / 직접 대응 ${coverage.matchedSections || 0}개` : '',
            result.extraction?.degraded ? '일부 텍스트는 정확도가 낮을 수 있습니다.' : '',
          ].filter(Boolean).join(' · ')
        : '신뢰도를 아직 계산하지 못했습니다.';
    }
    if (confidenceReasons) {
      confidenceReasons.innerHTML = (result.confidence?.reasons ?? []).length
        ? result.confidence.reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>신뢰도 근거가 없습니다.</li>';
    }
    if (confidenceWarnings) {
      const warnings = [
        ...(result.confidence?.warnings ?? []),
        ...(result.extraction?.degraded ? ['텍스트 추출 품질이 낮아 결과를 함께 확인해 주세요.'] : []),
      ];
      confidenceWarnings.innerHTML = warnings.length
        ? warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>현재 확인된 제한 사항이 없습니다.</li>';
    }
    if (context && result.sameTopicStatement) {
      context.textContent = `${result.sameTopicStatement} ${result.sharedContext || ''}`.trim();
    }
    if (compared) {
      if (result.comparedPaperId) {
        const href = `./detail.html?id=${encodeURIComponent(result.comparedPaperId)}`;
        compared.innerHTML = `<a href="${href}">${result.comparedPaperId}</a>`;
      } else {
        compared.textContent = '직접 대응 문헌 없음';
      }
    }
    if (recommendations) {
      recommendations.innerHTML = (result.recommendations ?? []).map((item) => `<li>${item}</li>`).join('');
    }
    if (priorStudiesSummary) {
      const meta = result.priorStudiesMeta || {};
      priorStudiesSummary.textContent = [
        meta.referenceDerivedCount ? `PDF 참고문헌 ${meta.referenceDerivedCount}건 우선` : '',
        meta.catalogCount ? `발견 문헌 ${meta.catalogCount}건 병행` : '',
      ].filter(Boolean).join(' · ') || '추출된 참고문헌이 없으면 발견 문헌만 표시합니다.';
    }
    if (priorStudies) {
      priorStudies.innerHTML = (result.priorStudies ?? []).length
        ? result.priorStudies
            .map((item) => {
              const detailHref = item.id ? `./detail.html?id=${encodeURIComponent(item.id)}` : '';
              const externalHref = item.originalUrl || item.detailUrl || '';
              return `
                <li>
                  <strong>${escapeHtml(item.title)}</strong>
                  <div>${escapeHtml(item.source || '')}${item.year ? ` · ${escapeHtml(item.year)}` : ''}${item.sourceType === 'reference' ? ' · 참고문헌 직접추출' : ' · 발견 문헌'}</div>
                  <div class="muted-copy">${escapeHtml(item.reason || '')}</div>
                  ${item.rawCitation ? `<div class="muted-copy">${escapeHtml(item.rawCitation)}</div>` : ''}
                  <div class="action-row">
                    ${detailHref ? `<a class="button button--ghost" href="${detailHref}">상세 보기</a>` : ''}
                    ${externalHref ? `<a class="button button--ghost" href="${externalHref}" target="_blank" rel="noreferrer noopener">원문 링크</a>` : ''}
                  </div>
                </li>
              `;
            })
            .join('')
        : '<li>선행연구 후보를 아직 추출하지 못했습니다.</li>';
    }
    if (extractionSummary) {
      extractionSummary.textContent = result.extraction
        ? `${result.extraction.method || 'text'} · ${result.extraction.extractedCharacters || 0}자 추출 · 추출 신뢰도 ${formatConfidenceLabel(result.extraction.confidenceLabel)} ${result.extraction.confidence || 0}%${result.extraction.structured ? ' · 구조 유지' : ''}${result.extraction.degraded ? ' · 일부 제한' : ''}${result.extraction.warnings?.length ? ` · 경고: ${result.extraction.warnings.join(', ')}` : ''}${result.confidence ? ` · 분석 신뢰도 ${formatConfidenceLabel(result.confidence.label)} ${result.confidence.score || 0}%` : ''}`
        : '직접 입력 텍스트 또는 업로드 문서를 기준으로 분석했습니다.';
    }
    if (topMatches) {
      topMatches.innerHTML = (result.topMatches ?? []).length
        ? result.topMatches
            .map((item) => {
              const detailHref = item.id ? `./detail.html?id=${encodeURIComponent(item.id)}` : '';
              const externalHref = item.originalUrl || item.detailUrl || '';
              return `
                <li>
                  <strong>${escapeHtml(item.title)}</strong>
                  <div>${escapeHtml(item.source || '')} · ${escapeHtml(item.relationship || '')} · ${escapeHtml(item.score)}%</div>
                  <div class="muted-copy">의미 ${escapeHtml(item.denseScore)} · 키워드 ${escapeHtml(item.sparseScore)}</div>
                  <div class="action-row">
                    ${detailHref ? `<a class="button button--ghost" href="${detailHref}">상세 보기</a>` : ''}
                    ${externalHref ? `<a class="button button--ghost" href="${externalHref}" target="_blank" rel="noreferrer noopener">원문 링크</a>` : ''}
                  </div>
                </li>
              `;
            })
            .join('')
        : '<li>상위 비교 문헌이 없습니다.</li>';
    }
    if (fileName) fileName.textContent = result.reportName || result.title || '업로드된 파일 없음';
    setLiveStatus(
      similarityStatus,
      result.extraction?.degraded ? '분석이 끝났지만 일부 내용은 정확도가 낮을 수 있습니다.' : '유사도 분석이 완료되었습니다.',
      result.extraction?.degraded ? 'warning' : 'success',
    );
    if (flowHint) {
      flowHint.textContent = result.extraction?.degraded
        ? '추출 품질이 낮아 결과를 함께 확인해 주세요.'
        : '핵심 공통점과 차별점을 바로 확인할 수 있습니다.';
    }
    setButtonBusy(submitButton, false);
  });

  const linkedPaperId = new URLSearchParams(window.location.search).get('paperId');
  if (linkedPaperId && compared) {
    compared.innerHTML = `<a href="./detail.html?id=${encodeURIComponent(linkedPaperId)}">${linkedPaperId}</a>`;
  }

  if (linkedPaperId) {
    try {
      const linkedPaper = await fetchPaperAsync(linkedPaperId, {
        intervalMs: 500,
        timeoutMs: 45000,
      });
      const titleInput = qs('input[name="title"]', form);
      const textInput = qs('textarea[name="text"]', form);
      if (titleInput && !titleInput.value.trim()) {
        titleInput.value = linkedPaper.title || linkedPaperId;
      }
      if (textInput && !textInput.value.trim()) {
        textInput.value = [linkedPaper.abstract, linkedPaper.novelty, ...(linkedPaper.highlights || [])]
          .filter(Boolean)
          .join('\n\n');
      }
      if (extractionSummary) {
        extractionSummary.textContent = '상세 문서의 초록/기여 요약을 미리 불러왔습니다. 업로드 파일 없이도 비교를 시작할 수 있습니다.';
      }
      setLiveStatus(similarityStatus, '연결 문헌을 기준으로 비교 준비가 완료되었습니다.', 'success');
      if (flowHint) {
        flowHint.textContent = '현재 연결된 문헌의 초록/기여 요약을 바탕으로 바로 비교를 시작할 수 있습니다.';
      }
      if (fileName && fileName.textContent === '업로드된 파일 없음') {
        fileName.textContent = linkedPaper.title || linkedPaperId;
      }
    } catch (error) {
      if (extractionSummary) {
        extractionSummary.textContent = `연결 문서를 미리 불러오지 못했습니다: ${error.message || linkedPaperId}`;
      }
      setLiveStatus(similarityStatus, '연결 문헌을 불러오지 못했습니다.', 'warning');
    }
  }

  const input = qs('input[type="file"]', form);
  if (input && fileName) {
    input.addEventListener('change', () => {
      fileName.textContent = input.files?.[0]?.name || '업로드된 파일 없음';
    });
  }
}

function guessPaperType(canonicalId = '') {
  const value = String(canonicalId || '').toLowerCase();
  if (value.includes('patent')) return '특허';
  if (value.includes('report') || value.includes('ntis') || value.includes('rne')) return '보고서';
  return '논문';
}

function renderEmptyPanel(title, description, actionLabel = '', actionHref = '') {
  return `
    <div class="empty-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
      ${actionLabel && actionHref ? `<div class="action-row"><a class="button button--ghost" href="${actionHref}">${escapeHtml(actionLabel)}</a></div>` : ''}
    </div>
  `;
}

function renderLibraryItemCard(item = {}) {
  const detailHref = item.canonicalId ? `./detail.html?id=${encodeURIComponent(item.canonicalId)}` : '';
  const shareHref = item.shareToken ? `./api/library/shared/${encodeURIComponent(item.shareToken)}` : '';
  const originalHref = item.originalUrl || item.detailUrl || '';
  const sourceType = item.sourceType || guessPaperType(item.canonicalId);
  return `
    <article class="saved-card">
      <div class="saved-card__header">
        <div>
          <div class="saved-card__meta">
            <span class="pill pill--muted">${escapeHtml(sourceType)}</span>
            ${item.source ? `<span class="pill pill--muted">${escapeHtml(item.source)}</span>` : ''}
            ${item.year ? `<span class="pill pill--muted">${escapeHtml(item.year)}</span>` : ''}
          </div>
          <strong>${escapeHtml(item.title || item.note || item.canonicalId || '저장 문헌')}</strong>
        </div>
        ${item.shareToken ? `<span class="token-pill">${escapeHtml(item.shareToken)}</span>` : ''}
      </div>
      <div class="saved-card__body">
        <p class="muted-copy">${escapeHtml(item.summary || item.note || '저장한 문헌 요약이 아직 없습니다.')}</p>
        <div class="saved-card__meta">
          <span class="pill pill--muted">${escapeHtml(item.canonicalId || '식별자 없음')}</span>
          ${item.organization ? `<span class="pill pill--muted">${escapeHtml(item.organization)}</span>` : ''}
        </div>
        <div class="tag-row">${(item.highlights || []).slice(0, 6).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">하이라이트 없음</span>'}</div>
      </div>
      <div class="saved-card__actions">
        <div class="action-row">
          ${detailHref ? `<a class="button button--ghost" href="${detailHref}">상세 보기</a>` : ''}
          ${originalHref ? `<a class="button button--ghost" href="${originalHref}" target="_blank" rel="noreferrer noopener">원문 링크</a>` : ''}
          ${shareHref ? `<a class="button button--ghost" href="${shareHref}" target="_blank" rel="noreferrer noopener">공유 보기</a>` : ''}
        </div>
        <button class="button button--ghost" data-remove-library="${escapeHtml(item.canonicalId || '')}">삭제</button>
      </div>
    </article>
  `;
}

function renderSavedSearchCard(item = {}) {
  const href = `./results.html?q=${encodeURIComponent(item.queryText || '')}`;
  return `
    <article class="search-card">
      <strong>${escapeHtml(item.label || '저장된 검색')}</strong>
      <p class="muted-copy">${escapeHtml(item.queryText || '질의 없음')}</p>
      <div class="saved-card__meta">
        <span class="pill pill--muted">${item.alertEnabled ? `알림 ${escapeHtml(item.alertFrequency || 'daily')}` : '알림 꺼짐'}</span>
        ${item.lastResultCount ? `<span class="pill pill--muted">최근 ${escapeHtml(item.lastResultCount)}건</span>` : ''}
      </div>
      <div class="saved-card__actions">
        <a class="button button--ghost" href="${href}">검색 다시 열기</a>
        <button class="button button--ghost" data-remove-search="${escapeHtml(item.id || '')}">삭제</button>
      </div>
    </article>
  `;
}

function renderRecommendationCard(item = {}) {
  const detailHref = item.id ? `./detail.html?id=${encodeURIComponent(item.id)}` : '';
  const originalHref = item.originalUrl || item.detailUrl || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return `
    <article class="recommendation-card">
      <div class="saved-card__header">
        <div class="saved-card__meta">
          <span class="pill pill--muted">추천 점수 ${escapeHtml(item.recommendationScore ?? '-')}</span>
          ${item.source ? `<span class="pill pill--muted">${escapeHtml(item.source)}</span>` : ''}
        </div>
      </div>
      <strong>${escapeHtml(item.title || '추천 문헌')}</strong>
      <p class="muted-copy">${escapeHtml((item.explanation || []).join(' · ') || item.summary || '개인화 추천 근거를 준비 중입니다.')}</p>
      <div class="tag-row">${tags.slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="saved-card__actions">
        <div class="action-row">
          ${detailHref ? `<a class="button button--ghost" href="${detailHref}">상세 보기</a>` : ''}
          ${originalHref ? `<a class="button button--ghost" href="${originalHref}" target="_blank" rel="noreferrer noopener">원문 링크</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderGuestAccountPanel() {
  return `
    <div class="account-card panel-surface account-summary">
      ${renderAccountSummary(null)}
      <div class="action-row">
        <a class="button button--primary" href="./auth.html?redirect=library">로그인</a>
      </div>
    </div>
  `;
}

function renderSignedInAccountPanel(user = null) {
  return `
    <div class="account-card panel-surface account-summary">
      ${renderAccountSummary(user)}
      <p class="muted-copy">저장 자료와 추천을 관리할 수 있습니다.</p>
    </div>
  `;
}

function renderProfileForm(profile = {}) {
  return `
    <label>
      <span class="label">표시 이름</span>
        <input class="input" name="displayName" value="${escapeHtml(profile.displayName || '')}" placeholder="연구자 이름" />
    </label>
    <label>
      <span class="label">기본 지역</span>
        <select class="input" name="defaultRegion">
          <option value="all" ${profile.defaultRegion === 'all' ? 'selected' : ''}>전체</option>
          <option value="domestic" ${profile.defaultRegion === 'domestic' ? 'selected' : ''}>국내</option>
          <option value="global" ${profile.defaultRegion === 'global' ? 'selected' : ''}>해외</option>
        </select>
    </label>
    <label>
      <span class="label">관심 분야</span>
        <input class="input" name="researchInterests" value="${escapeHtml((profile.researchInterests || []).join(', '))}" placeholder="예: 배터리 AI, 추천 시스템, OCR" />
    </label>
    <label>
      <span class="label">선호 소스</span>
        <input class="input" name="preferredSources" value="${escapeHtml((profile.preferredSources || []).join(', '))}" placeholder="예: kci, dbpia, semantic_scholar" />
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

function renderSessionSummary(user = null) {
  if (!user) {
    return `
      <div class="session-card__user">
        <div class="session-card__identity">
          <strong>로그인이 필요합니다</strong>
          <span>저장 문헌, 저장 검색, 추천 피드를 보려면 계정이 필요합니다.</span>
        </div>
      </div>
      <div class="badge-row">
        <span class="pill pill--muted">guest</span>
        <span class="pill pill--muted">세션 없음</span>
      </div>
    `;
  }

  return `
    <div class="session-card__user">
      <div class="session-card__identity">
        <strong>${escapeHtml(user.displayName || '사용자')}</strong>
        <span>${escapeHtml(user.email || '')}</span>
      </div>
      <div class="badge-row">
        <span class="pill pill--muted">${user.isAdmin ? 'admin' : 'member'}</span>
        <span class="pill pill--muted">세션 활성</span>
      </div>
    </div>
    <p class="muted-copy">저장 자료와 추천을 확인할 수 있습니다.</p>
  `;
}

async function initAdminPage() {
  const summary = qs('[data-admin-summary]');
  const alertsRoot = qs('[data-admin-alerts]');
  const metricsRoot = qs('[data-admin-metrics]');
  const requestsRoot = qs('[data-admin-requests]');
  const similarityRoot = qs('[data-admin-similarity]');
  const startupRoot = qs('[data-admin-startup]');
  if (!summary || !alertsRoot || !metricsRoot || !requestsRoot || !similarityRoot || !startupRoot) return;

  const me = await fetchMe().catch(() => ({ user: null }));
  if (!me.user?.isAdmin) {
    summary.textContent = '관리자 계정만 운영 대시보드를 볼 수 있습니다.';
    alertsRoot.innerHTML = '<article class="alert-card alert-card--critical"><strong>접근 제한</strong><p>관리자 권한이 필요합니다.</p></article>';
    metricsRoot.innerHTML = renderEmptyPanel('관리자 전용 화면입니다.', '권한이 있는 계정으로 로그인한 뒤 다시 열어 주세요.');
    startupRoot.innerHTML = renderEmptyPanel('런타임 정보를 볼 수 없습니다.', '관리자 세션이 확인되면 런타임 상태를 표시합니다.');
    similarityRoot.innerHTML = renderEmptyPanel('유사도 실행 기록을 볼 수 없습니다.', '관리자 권한이 필요합니다.');
    requestsRoot.innerHTML = '<tr><td colspan="5">관리자 권한이 필요합니다.</td></tr>';
    return;
  }

  summary.textContent = '운영 요약을 불러오는 중입니다…';
  alertsRoot.innerHTML = createConstellationLoaderPanel('운영 경보를 정리하는 중입니다.');
  metricsRoot.innerHTML = createConstellationLoaderPanel('스토리지/활동 메트릭을 불러오는 중입니다.');
  startupRoot.innerHTML = createConstellationLoaderPanel('부팅/런타임 상태를 정리하는 중입니다.');
  similarityRoot.innerHTML = createConstellationLoaderPanel('최근 유사도 실행 기록을 정리하는 중입니다.');
  requestsRoot.innerHTML = '<tr><td colspan="5"><span class="skeleton-line skeleton-line--medium"></span></td></tr>';

  const renderSummary = async () => {
    const [summaryPayload, opsPayload] = await Promise.all([fetchAdminSummary(), fetchAdminOps()]);
    const alerts = Array.isArray(opsPayload.alerts) ? opsPayload.alerts : [];
    const recentRequests = Array.isArray(opsPayload.recentRequests) ? opsPayload.recentRequests : [];
    const similarityRuns = Array.isArray(opsPayload.recentSimilarityRuns) ? opsPayload.recentSimilarityRuns : [];
    const analysisRuntime = opsPayload.runtime?.analysis || {};
    const storage = opsPayload.storage || {};
    const startup = opsPayload.startup || {};

    summary.textContent = JSON.stringify(summaryPayload, null, 2);

    startupRoot.innerHTML = `
      <div class="stat-card"><span>Host</span><strong>${escapeHtml(startup.host || '-')}</strong></div>
      <div class="stat-card"><span>Port</span><strong>${escapeHtml(startup.port || '-')}</strong></div>
      <div class="stat-card"><span>Live Sources</span><strong>${startup.liveSourcesEnabled ? 'ON' : 'OFF'}</strong></div>
      <div class="stat-card"><span>Source Timeout</span><strong>${escapeHtml(startup.sourceTimeoutMs || '-')}ms</strong></div>
      <div class="stat-card"><span>Analysis Pool</span><strong>${escapeHtml(analysisRuntime.poolSize || 0)}</strong></div>
      <div class="stat-card"><span>Busy Workers</span><strong>${escapeHtml(analysisRuntime.busyWorkers || 0)}</strong></div>
      <div class="stat-card"><span>Queued Analysis</span><strong>${escapeHtml(analysisRuntime.queueDepth ?? analysisRuntime.queuedTasks ?? 0)}</strong></div>
      <div class="stat-card"><span>Analysis Overload</span><strong>${analysisRuntime.overloaded ? 'ACTIVE' : 'NORMAL'}</strong></div>
      <div class="stat-card"><span>Async Jobs</span><strong>${escapeHtml(analysisRuntime.asyncJobs?.running || 0)}</strong></div>
    `;

    metricsRoot.innerHTML = Object.entries(storage)
      .filter(([key]) => key !== 'ready' && key !== 'dbPath')
      .map(([key, value]) => `
        <div class="stat-card">
          <span>${escapeHtml(key)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `)
      .join('') || renderEmptyPanel('스토리지 메트릭이 없습니다.', '아직 수집된 메트릭이 없습니다.');

    alertsRoot.innerHTML = alerts.length
      ? alerts
          .map((alert) => `
            <article class="alert-card alert-card--${escapeHtml(alert.level)}">
              <strong>${escapeHtml(alert.title)}</strong>
              <p>${escapeHtml(alert.detail)}</p>
            </article>
          `)
          .join('')
      : renderEmptyPanel('현재 활성 경보가 없습니다.', '현재 진단 기준으로 즉시 대응이 필요한 운영 경보는 없습니다.');

    requestsRoot.innerHTML = recentRequests.length
      ? recentRequests
          .map((entry) => `
            <tr>
              <td>${escapeHtml(entry.method)}</td>
              <td>${escapeHtml(entry.path)}</td>
              <td>${escapeHtml(entry.status)}</td>
              <td>${Math.round(Number(entry.durationMs || 0))}ms</td>
              <td>${escapeHtml(entry.createdAt)}</td>
            </tr>
          `)
      .join('')
      : '<tr><td colspan="5">최근 요청 없음</td></tr>';

    similarityRoot.innerHTML = similarityRuns.length
      ? similarityRuns
          .map((entry) => `
            <div class="timeline-item">
              <strong>${escapeHtml(entry.title || '유사도 실행')}</strong>
              <p>${escapeHtml(entry.riskLevel || 'unknown')} · score ${escapeHtml(entry.score ?? '-')} · ${escapeHtml(entry.extractionMethod || 'n/a')}</p>
              <span>${escapeHtml(entry.createdAt || '')}</span>
            </div>
          `)
          .join('')
      : renderEmptyPanel('유사도 실행 이력이 없습니다.', '최근 실행된 비교 작업이 없으면 여기에 빈 상태로 표시됩니다.');
  };

  await renderSummary();

  qs('[data-refresh-cache]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '캐시를 비우는 중...');
    await clearCache({}).catch(() => null);
    await renderSummary();
    setButtonBusy(button, false);
  });
}

async function initLibraryPage() {
  const authState = qs('[data-auth-state]');
  const logoutButton = qs('[data-auth-logout]');
  const statsRoot = qs('[data-library-stats]');
  const libraryRoot = qs('[data-library-items]');
  const searchesRoot = qs('[data-saved-searches]');
  const recommendationRoot = qs('[data-recommendation-feed]');
  const saveSearchForm = qs('[data-save-search-form]');
  const profileForm = qs('[data-profile-form]');
  if (!authState || !logoutButton || !statsRoot || !libraryRoot || !searchesRoot || !recommendationRoot || !saveSearchForm || !profileForm) return;

  const setLoadingState = () => {
    authState.innerHTML = createConstellationLoaderPanel('세션 상태를 확인하는 중입니다.');
    libraryRoot.innerHTML = createConstellationLoaderPanel('저장한 문헌을 정리하는 중입니다.');
    searchesRoot.innerHTML = createConstellationLoaderPanel('저장 검색을 불러오는 중입니다.');
    recommendationRoot.innerHTML = createConstellationLoaderPanel('개인화 추천을 정리하는 중입니다.');
    statsRoot.innerHTML = `
      <div class="summary-tile"><span>저장 문헌</span><strong>--</strong></div>
      <div class="summary-tile"><span>저장 검색</span><strong>--</strong></div>
      <div class="summary-tile"><span>추천 피드</span><strong>--</strong></div>
    `;
  };

  const refresh = async () => {
    setLoadingState();
    const me = await fetchMe().catch(() => ({ user: null }));

    if (!me.user) {
      logoutButton.hidden = true;
      saveSearchForm.hidden = true;
      authState.innerHTML = renderSessionSummary(null);
      profileForm.innerHTML = renderEmptyPanel('프로필 편집이 잠겨 있습니다.', '로그인 후 선호도/프로필을 편집할 수 있습니다.');
      libraryRoot.innerHTML = renderEmptyPanel('아직 저장한 문헌이 없습니다.', '로그인 후 저장한 문헌을 다시 열 수 있습니다.');
      searchesRoot.innerHTML = renderEmptyPanel('저장 검색이 없습니다.', '로그인 후 반복 검색을 저장하고 다시 열 수 있습니다.');
      recommendationRoot.innerHTML = renderEmptyPanel('개인화 추천이 없습니다.', '로그인 후 관심사와 저장 문헌을 바탕으로 추천 피드를 구성합니다.');
      statsRoot.innerHTML = `
        <div class="summary-tile"><span>저장 문헌</span><strong>0건</strong></div>
        <div class="summary-tile"><span>저장 검색</span><strong>0건</strong></div>
        <div class="summary-tile"><span>추천 피드</span><strong>0건</strong></div>
      `;
      return;
    }

    logoutButton.hidden = false;
    saveSearchForm.hidden = false;
    authState.innerHTML = renderSessionSummary(me.user);

    const [profilePayload, libraryPayload, searchesPayload, feedPayload] = await Promise.all([
      fetchProfile().catch(() => ({ profile: null })),
      fetchLibrary().catch(() => ({ items: [] })),
      fetchSavedSearches().catch(() => ({ searches: [] })),
      fetchRecommendationFeed(6).catch(() => ({ items: [] })),
    ]);

    const profile = profilePayload.profile || {
      displayName: me.user.displayName || '',
      researchInterests: [],
      preferredSources: [],
      defaultRegion: 'all',
      alertOptIn: false,
      crossLanguageOptIn: false,
    };
    profileForm.innerHTML = renderProfileForm(profile);

    const libraryItems = Array.isArray(libraryPayload.items) ? libraryPayload.items : [];
    const savedSearches = Array.isArray(searchesPayload.searches) ? searchesPayload.searches : [];
    const recommendations = Array.isArray(feedPayload.items) ? feedPayload.items : [];

    libraryRoot.innerHTML = libraryItems.length
      ? libraryItems.map(renderLibraryItemCard).join('')
      : renderEmptyPanel('아직 저장한 문헌이 없습니다.', '검색 결과나 상세 분석에서 문헌을 저장하면 여기에 모입니다.', '탐색 시작', './results.html');
    searchesRoot.innerHTML = savedSearches.length
      ? savedSearches.map(renderSavedSearchCard).join('')
      : renderEmptyPanel('저장된 검색이 없습니다.', '반복적으로 확인하는 질의를 저장해 두면 빠르게 다시 열 수 있습니다.');
    recommendationRoot.innerHTML = recommendations.length
      ? recommendations.map(renderRecommendationCard).join('')
      : renderEmptyPanel('개인화 추천이 아직 없습니다.', '프로필과 저장 문헌이 쌓이면 추천 피드가 더 풍부해집니다.');
    statsRoot.innerHTML = `
      <div class="summary-tile"><span>저장 문헌</span><strong>${formatCount(libraryItems.length)}건</strong></div>
      <div class="summary-tile"><span>저장 검색</span><strong>${formatCount(savedSearches.length)}건</strong></div>
      <div class="summary-tile"><span>추천 피드</span><strong>${formatCount(recommendations.length)}건</strong></div>
    `;
  };

  logoutButton.addEventListener('click', async () => {
    await logout().catch(() => null);
    await refresh();
  });

  saveSearchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(saveSearchForm);
    await saveSearchRequest({
      label: formData.get('label'),
      queryText: formData.get('queryText'),
      alertEnabled: formData.get('alertEnabled') === 'on',
      alertFrequency: formData.get('alertFrequency') || 'daily',
      filters: {},
    }).catch(() => null);
    saveSearchForm.reset();
    await refresh();
  });

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(profileForm);
    await saveProfile({
      displayName: formData.get('displayName'),
      researchInterests: String(formData.get('researchInterests') || ''),
      preferredSources: String(formData.get('preferredSources') || ''),
      defaultRegion: formData.get('defaultRegion'),
      alertOptIn: formData.get('alertOptIn') === 'on',
      crossLanguageOptIn: formData.get('crossLanguageOptIn') === 'on',
    }).catch(() => null);
    await refresh();
  });

  document.addEventListener('click', async (event) => {
    const libraryButton = event.target.closest('[data-remove-library]');
    if (libraryButton?.dataset.removeLibrary) {
      await removeLibraryItem(libraryButton.dataset.removeLibrary).catch(() => null);
      await refresh();
      return;
    }

    const searchButton = event.target.closest('[data-remove-search]');
    if (searchButton?.dataset.removeSearch) {
      await removeSavedSearch(searchButton.dataset.removeSearch).catch(() => null);
      await refresh();
    }
  });

  await refresh();
}

async function initAuthPage() {
  const form = qs('[data-auth-page-form]');
  const sessionSummaryRoot = qs('[data-auth-session-summary]');
  const sessionCardRoot = qs('[data-auth-session-card]');
  const displayNameRow = qs('[data-auth-display-name]');
  const feedbackRoot = qs('[data-auth-feedback]');
  const submitButton = qs('[data-auth-submit]');
  const logoutButton = qs('[data-auth-page-logout]');
  if (!form || !sessionSummaryRoot || !sessionCardRoot || !displayNameRow || !feedbackRoot || !submitButton || !logoutButton) return;

  const modeInput = qs('input[name="mode"]', form);
  const redirectTarget = sanitizeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'));

  function applyAuthMode(mode = 'login') {
    if (modeInput) modeInput.value = mode;
    displayNameRow.hidden = mode !== 'register';
    submitButton.textContent = mode === 'register' ? '회원가입' : '로그인';
    qsa('[data-auth-tab]').forEach((button) => {
      const active = button.dataset.authTab === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  async function refreshSession() {
    const me = await fetchMe().catch(() => ({ user: null }));
    if (!me.user) {
      sessionSummaryRoot.textContent = '로그인 후 라이브러리를 이용할 수 있습니다.';
      sessionCardRoot.innerHTML = renderEmptyPanel('로그인이 필요합니다.', '로그인 또는 회원가입 후 계속하세요.');
      logoutButton.hidden = true;
      feedbackRoot.textContent = '로그인 후 라이브러리와 추천을 이용할 수 있습니다.';
      return;
    }

    sessionSummaryRoot.textContent = `${me.user.displayName || me.user.email}님으로 로그인되어 있습니다.`;
    sessionCardRoot.innerHTML = `
      <div class="account-card panel-surface account-summary">
        ${renderAccountSummary(me.user)}
        <div class="action-row">
          <a class="button button--primary" href="${me.user.isAdmin ? './admin.html' : './library.html'}">${me.user.isAdmin ? '관리 화면 열기' : '라이브러리 열기'}</a>
          <a class="button button--ghost" href="./results.html">탐색 이어가기</a>
        </div>
      </div>
    `;
    logoutButton.hidden = false;
    feedbackRoot.textContent = '이미 로그인되어 있습니다.';
  }

  qsa('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => applyAuthMode(button.dataset.authTab || 'login'));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      email: formData.get('email'),
      password: formData.get('password'),
      displayName: formData.get('displayName'),
    };
    const mode = formData.get('mode') === 'register' ? 'register' : 'login';
    setButtonBusy(submitButton, true, mode === 'register' ? '회원가입 중...' : '로그인 중...');
    try {
      if (mode === 'register') await register(payload);
      else await login(payload);
      feedbackRoot.textContent = mode === 'register' ? '회원가입이 완료되었습니다. 라이브러리로 이동합니다…' : '로그인되었습니다. 라이브러리로 이동합니다…';
      await refreshSession();
      window.setTimeout(() => {
        window.location.href = redirectTarget;
      }, 450);
    } catch (error) {
      feedbackRoot.textContent = error?.message || '인증 중 오류가 발생했습니다.';
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  logoutButton.addEventListener('click', async () => {
    await logout().catch(() => null);
    await refreshSession();
  });

  applyAuthMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
  await refreshSession();
}

const page = document.body.dataset.page;
if (page === 'home') initHomePage();
if (page === 'results') initResultsPage();
if (page === 'detail') initDetailPage();
if (page === 'similarity') initSimilarityPage();
if (page === 'admin') initAdminPage();
if (page === 'library') initLibraryPage();
if (page === 'auth') initAuthPage();
