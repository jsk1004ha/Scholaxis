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

function buildSearchParams(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (typeof value === 'string' && value.trim()) params.append(key, value.trim());
  }
  return params;
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
        <h3>검색 결과가 충분하지 않습니다</h3>
        <p>질의를 조금 더 넓히거나 국내/해외 범위를 바꾸면 더 많은 source-grounded 후보를 볼 수 있습니다.</p>
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
  setLiveStatus(progressRoot, '검색 스트리밍 연결 중…', 'loading');

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
      setLiveStatus(progressRoot, '결과 초안을 렌더링했습니다.', 'success');
    },
    onDone(payload) {
      renderSearchPayload(payload, resultsRoot);
      setLiveStatus(progressRoot, `스트리밍 완료 · ${payload.total}개 결과`, 'success');
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

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    setLiveStatus(detailStatus, '문서 ID가 없어 상세 분석을 시작할 수 없습니다.', 'critical');
    setText('[data-detail-title]', '상세 문서가 선택되지 않았습니다.');
    setText('[data-detail-subtitle]', '검색 결과에서 문서를 선택한 뒤 다시 열어 주세요.');
    setText('[data-detail-authors]', 'detail-id-missing');
    setText('[data-detail-abstract]', 'source-grounded 상세 정보를 보려면 결과 목록에서 문서를 선택해야 합니다.');
    setText('[data-detail-insight]', '선택된 문서 ID가 없습니다.');
    setText('[data-detail-source]', '문서 선택 필요');
    setText('[data-detail-badge]', 'No document');
    setText('[data-detail-health-summary]', '문서 ID가 없어 상세 상태를 계산할 수 없습니다.');
    return;
  }
  let paper;
  try {
    paper = await fetchPaper(id);
  } catch (error) {
    setLiveStatus(detailStatus, '상세 데이터를 불러오지 못했습니다.', 'critical');
    setText('[data-detail-title]', '상세 문서를 불러오지 못했습니다.');
    setText('[data-detail-subtitle]', '문서 ID 또는 서버 상태를 확인해 주세요.');
    setText('[data-detail-authors]', String(error?.message || 'detail-load-failed'));
    setText('[data-detail-abstract]', '상세 데이터를 가져오는 동안 오류가 발생했습니다. 검색 결과에서 다시 진입하거나 서버 로그를 확인해 주세요.');
    setText('[data-detail-insight]', '원인: API 응답 실패');
    setText('[data-detail-source]', `문서 ID · ${id}`);
    setText('[data-detail-badge]', 'Load failed');
    setText('[data-detail-novelty]', '소스 기반 상세 데이터가 없어 원문 링크와 그래프를 표시하지 못했습니다.');
    setText('[data-detail-source-links]', String(error?.message || 'detail-load-failed'));
    setText('[data-detail-health-summary]', '상세 응답을 불러오지 못해 전체 화면이 degraded 상태입니다.');
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
      : '<li>현재 확인된 degraded 구간이 없습니다.</li>';
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
  const flowHint = qs('[data-similarity-flow-hint]');

  const primeSimilarityLoadingState = (message = '비교 문헌과 섹션 대응을 계산하고 있습니다.') => {
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
    if (priorStudiesSummary) priorStudiesSummary.textContent = 'PDF 참고문헌과 발견 문헌을 함께 정리하고 있습니다.';
    if (topMatches) topMatches.innerHTML = '<li><span class="skeleton-line skeleton-line--medium"></span></li><li><span class="skeleton-line skeleton-line--short"></span></li>';
    if (extractionSummary) extractionSummary.textContent = message;
    if (flowHint) {
      flowHint.textContent = '업로드 → 텍스트 추출 → 섹션 대응 → 차이/주의점 요약 순서로 진행됩니다.';
    }
  };

  primeSimilarityLoadingState('업로드 전에도 연결 문헌과 비교 흐름을 준비할 수 있습니다.');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    setButtonBusy(submitButton, true, '유사도 분석 중...');
    primeSimilarityLoadingState('문서 추출과 섹션 비교를 수행하는 중입니다.');
    const stopStatusCycle = cycleStatusMessages(
      similarityStatus,
      ['문서를 업로드하고 있습니다.', '텍스트를 추출하고 있습니다.', '섹션 대응을 계산하고 있습니다.', '차이와 주의점을 정리하고 있습니다.'],
      1300,
      'loading',
    );
    let result;
    try {
      result = await analyzeSimilarity(formData);
    } catch (error) {
      stopStatusCycle();
      if (extractionSummary) {
        extractionSummary.textContent = `유사도 분석 요청이 실패했습니다: ${error.message || 'similarity-request-failed'}`;
      }
      if (flowHint) {
        flowHint.textContent = '요청 실패로 분석을 완료하지 못했습니다. 파일 형식이나 서버 상태를 확인해 주세요.';
      }
      setLiveStatus(similarityStatus, '유사도 분석 요청이 실패했습니다.', 'critical');
      scoreRing?.classList.remove('is-loading');
      setButtonBusy(submitButton, false);
      return;
    }
    stopStatusCycle();
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
        result.confidence ? `confidence ${result.confidence.label || 'unknown'} ${result.confidence.score || 0}%` : '',
        result.relationship ? `관계: ${result.relationship}` : ''
      ].filter(Boolean).join(' · ');
    }
    if (confidenceSummary) {
      const coverage = result.confidence?.structureCoverage;
      confidenceSummary.textContent = result.confidence
        ? [
            `결론 confidence ${result.confidence.label || 'unknown'} ${result.confidence.score || 0}%`,
            coverage ? `입력 섹션 ${coverage.inputSections || 0}개 / 직접 대응 ${coverage.matchedSections || 0}개` : '',
            result.extraction?.degraded ? '추출 degraded 상태가 반영되었습니다.' : '',
          ].filter(Boolean).join(' · ')
        : 'confidence 정보를 아직 계산하지 못했습니다.';
    }
    if (confidenceReasons) {
      confidenceReasons.innerHTML = (result.confidence?.reasons ?? []).length
        ? result.confidence.reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>confidence 근거 정보가 없습니다.</li>';
    }
    if (confidenceWarnings) {
      const warnings = [
        ...(result.confidence?.warnings ?? []),
        ...(result.extraction?.degraded ? ['파일 추출이 degraded 상태여서 결론을 보수적으로 해석해야 합니다.'] : []),
      ];
      confidenceWarnings.innerHTML = warnings.length
        ? warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>현재 확인된 degraded 구간이 없습니다.</li>';
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
        ? `${result.extraction.method || 'text'} · ${result.extraction.extractedCharacters || 0}자 추출 · 추출 confidence ${result.extraction.confidenceLabel || 'unknown'} ${result.extraction.confidence || 0}%${result.extraction.structured ? ' · 구조 보존' : ''}${result.extraction.degraded ? ' · degraded' : ''}${result.extraction.warnings?.length ? ` · 경고: ${result.extraction.warnings.join(', ')}` : ''}${result.confidence ? ` · 결론 confidence ${result.confidence.label || 'unknown'} ${result.confidence.score || 0}%` : ''}`
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
                  <div class="muted-copy">dense ${escapeHtml(item.denseScore)} · sparse ${escapeHtml(item.sparseScore)}</div>
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
      result.extraction?.degraded ? '분석은 완료됐지만 추출 품질에 제한이 있습니다.' : '유사도 분석이 완료되었습니다.',
      result.extraction?.degraded ? 'warning' : 'success',
    );
    if (flowHint) {
      flowHint.textContent = result.extraction?.degraded
        ? '추출 degraded 상태를 반영해 결과를 보수적으로 해석하세요.'
        : '핵심 공통점과 차별점, 상위 비교 문헌까지 한 흐름으로 검토할 수 있습니다.';
    }
    setButtonBusy(submitButton, false);
  });

  const linkedPaperId = new URLSearchParams(window.location.search).get('paperId');
  if (linkedPaperId && compared) {
    compared.innerHTML = `<a href="./detail.html?id=${encodeURIComponent(linkedPaperId)}">${linkedPaperId}</a>`;
  }

  if (linkedPaperId) {
    try {
      const linkedPaper = await fetchPaper(linkedPaperId);
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
  summary.textContent = '운영 요약을 불러오는 중입니다…';
  alertsRoot.innerHTML = createSectionSkeleton(2);
  metricsRoot.innerHTML = createSectionSkeleton(2);
  startupRoot.innerHTML = createSectionSkeleton(2);
  similarityRoot.innerHTML = createSectionSkeleton(2);
  requestsRoot.innerHTML = '<tr><td colspan="5"><span class="skeleton-line skeleton-line--medium"></span></td></tr>';

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

  qs('[data-refresh-cache]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '캐시를 비우는 중...');
    await clearCache({});
    await renderSummary();
    setButtonBusy(button, false);
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
  if (libraryRoot) libraryRoot.innerHTML = createSectionSkeleton(2);
  if (searchesRoot) searchesRoot.innerHTML = createSectionSkeleton(2);
  if (recommendationRoot) recommendationRoot.innerHTML = createSectionSkeleton(2);
  if (authState) authState.textContent = '세션 상태를 확인하는 중입니다…';

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
