import { searchCatalog, searchCatalogStream } from './search-service.mjs';

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeDelayForTests() {
  const delayMs = Number(process.env.SCHOLAXIS_TEST_SEARCH_DELAY_MS || 0);
  if (delayMs > 0) {
    await delay(delayMs);
  }
}

const keepAlive = setInterval(() => {}, 1 << 30);
process.send?.({ type: 'ready' });

process.on('message', async (message = {}) => {
  const { taskId = '', taskType = '', payload = {} } = message;
  try {
    await maybeDelayForTests();
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
