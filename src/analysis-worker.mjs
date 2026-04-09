import { runAnalysisTaskByType } from './analysis-tasks.mjs';

const keepAlive = setInterval(() => {}, 1 << 30);
process.send?.({ type: 'ready' });

process.on('message', async (message = {}) => {
  const { taskId = '', taskType = '', payload = {} } = message;
  try {
    const result = await runAnalysisTaskByType(taskType, payload, {
      onProgress: (progress) => process.send?.({ type: 'progress', taskId, progress }),
    });
    process.send?.({ ok: true, taskId, result });
  } catch (error) {
    process.send?.({ ok: false, taskId, error: error.message || String(error || 'analysis-task-failed') });
  }
});

process.on('disconnect', () => {
  clearInterval(keepAlive);
  process.exit(0);
});
