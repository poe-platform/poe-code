import { createServer } from 'node:http';
import { once } from 'node:events';

export async function serveOrigin() {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Storage admission</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Origin fixture address missing');
  return {
    url: new URL(`http://127.0.0.1:${address.port}/`),
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
