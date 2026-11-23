function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeDelayForTests() {
  const delayMs = Number(process.env.SCHOLAXIS_TEST_SEARCH_DELAY_MS || 0);
  if (delayMs > 0) {
    await delay(delayMs);
  }
}

let searchModulePromise = null;

function resolveSearchEmbeddingProvider() {
  if (process.env.SCHOLAXIS_SEARCH_EMBEDDING_PROVIDER) {
    process.env.SCHOLAXIS_EMBEDDING_PROVIDER = process.env.SCHOLAXIS_SEARCH_EMBEDDING_PROVIDER;
  } else if (!process.env.SCHOLAXIS_EMBEDDING_PROVIDER || process.env.SCHOLAXIS_EMBEDDING_PROVIDER === 'auto') {
    process.env.SCHOLAXIS_EMBEDDING_PROVIDER = 'hash';
  }

  if (process.env.SCHOLAXIS_SEARCH_RERANKER_PROVIDER) {
    process.env.SCHOLAXIS_RERANKER_PROVIDER = process.env.SCHOLAXIS_SEARCH_RERANKER_PROVIDER;
  } else if (!process.env.SCHOLAXIS_RERANKER_PROVIDER || process.env.SCHOLAXIS_RERANKER_PROVIDER === 'auto') {
    process.env.SCHOLAXIS_RERANKER_PROVIDER = 'heuristic';
  }
}

async function loadSearchModule() {
  resolveSearchEmbeddingProvider();
  searchModulePromise ||= import('./search-service.mjs');
  return searchModulePromise;
}

const keepAlive = setInterval(() => {}, 1 << 30);
process.send?.({ type: 'ready' });

process.on('message', async (message = {}) => {
  const { taskId = '', taskType = '', payload = {} } = message;
  try {
    await maybeDelayForTests();
    const { searchCatalog, searchCatalogStream } = await loadSearchModule();
    const result =
      taskType === 'search-stream'
        ? await searchCatalogStream(payload.options || {}, (event) => {
            process.send?.({ type: 'event', taskId, event });
          })
        : await searchCatalog(payload.options || {});
    process.send?.({ type: 'result', ok: true, taskId, result });
  } catch (error) {
    process.send?.({
      type: 'result',
      ok: false,
      taskId,
      error: error.message || String(error || 'search-task-failed'),
    });
  }
});

process.on('disconnect', () => {
  clearInterval(keepAlive);
  process.exit(0);
});
