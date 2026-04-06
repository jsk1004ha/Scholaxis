import { createGraphBackendServer } from '../src/graph-backend-server.mjs';

const port = Number(process.env.PORT || 8200);
const server = createGraphBackendServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`Scholaxis graph backend listening on http://127.0.0.1:${port}`);
});
