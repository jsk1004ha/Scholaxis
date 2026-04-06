import { createVectorBackendServer } from '../src/vector-backend-server.mjs';

const port = Number(process.env.PORT || 8100);
const server = createVectorBackendServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`Scholaxis vector backend listening on http://127.0.0.1:${port}`);
});
