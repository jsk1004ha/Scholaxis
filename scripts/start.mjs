import { bootstrapRuntime } from '../src/runtime-bootstrap.mjs';

const state = bootstrapRuntime({ persistEnvFile: true });

if (state.createdEnvFile) {
  console.log(`[bootstrap] created ${state.createdEnvFile} with quickstart defaults for first-run startup.`);
}
if (state.envCreateError) {
  console.warn(`[bootstrap] could not persist .env automatically: ${state.envCreateError}`);
  console.warn('[bootstrap] continuing with inferred in-memory quickstart defaults for this run.');
}
for (const message of state.inferredDefaults) {
  console.log(`[bootstrap] ${message}`);
}

const { startServer } = await import('../src/server.mjs');

startServer();
