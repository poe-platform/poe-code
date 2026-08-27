import { createServer } from 'node:http';
import assert from 'node:assert/strict';

export async function openFixture(request, emit) {
  const breadth = request.profile === 'breadth';
  if (!(breadth ? request.specimen.configuration === 'loopback-network' : request.specimen.network)) return null;
  const network = request.inputs?.network;
  if (breadth) assert.equal(network.url, 'http://127.0.0.1:63131/fixture.txt');
  const sockets = new Set(), requests = [];
  let failed = null, closing;
  const fail = error => { failed ??= String(error); emit({ kind: 'fixture-error', error: failed }); };
  const server = createServer({ maxHeaderSize: 65536 }, async (incoming, response) => {
    try {
      if (requests.length >= 128) throw new Error('fixture request cap');
      const chunks = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error('fixture upload cap');
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks), path = new URL(incoming.url, 'http://localhost').pathname;
      requests.push({ method: incoming.method, path, bytes: body.toString('base64'), authorization: incoming.headers.authorization ? '[redacted]' : null });
      if (breadth) {
        const allowed = incoming.method === network.method && incoming.url === network.path;
        const bytes = allowed ? Buffer.from(network.bodyBase64, 'base64') : Buffer.from('denied\n');
        response.writeHead(allowed ? network.status : 403, { 'Content-Type': network.contentType, 'Content-Length': bytes.length, Connection: 'close', Date: 'Thu, 01 Jan 1970 00:00:00 GMT' });
        response.end(bytes); return;
      }
      response.sendDate = false;
      if (path === '/redirect') { response.writeHead(302, { Location: '/bytes', 'Content-Length': '0' }); response.end(); return; }
      const payload = path === '/echo' ? body : path === '/auth' ? Buffer.from(incoming.headers.authorization === 'Basic dXNlcjpwYXNz' ? 'authorized' : 'denied') : path === '/missing' ? Buffer.from('missing') : Buffer.from([0, 255, 65, 10]);
      response.writeHead(path === '/missing' ? 404 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length, Connection: 'close' });
      response.end(incoming.method === 'HEAD' ? undefined : payload);
    } catch (error) { fail(error); incoming.destroy(error); response.destroy(error); }
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (sockets.size > 16) { fail(new Error('fixture socket cap')); socket.destroy(); }
  });
  server.on('clientError', (error, socket) => { fail(error); socket.destroy(); });
  server.on('error', fail);
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(breadth ? network.port : 0, '127.0.0.1', resolveListen); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, requests, close() {
    closing ??= new Promise(resolveClose => server.close(() => resolveClose({ closed: !server.listening && sockets.size === 0, sockets: sockets.size, failed, requests })));
    return closing;
  } };
}
