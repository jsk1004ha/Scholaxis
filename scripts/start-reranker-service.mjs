import { createRerankerBackendServer } from '../src/reranker-backend-server.mjs';
import { appConfig } from '../src/config.mjs';

const server = createRerankerBackendServer();

server.listen(appConfig.rerankerPort, appConfig.rerankerHost, () => {
  console.log(`Scholaxis reranker backend listening on http://${appConfig.rerankerHost}:${appConfig.rerankerPort}`);
});
