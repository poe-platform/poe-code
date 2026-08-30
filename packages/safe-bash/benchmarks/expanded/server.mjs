import { createServer } from "node:http";

export async function localServer() {
  const requests = [];
  const server = createServer(async (request, response) => {
    response.sendDate = false;
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    const body = Buffer.concat(chunks), path = new URL(request.url, "http://localhost").pathname;
    requests.push({ method: request.method, path, bytes: body.toString("base64"), authorization: request.headers.authorization ? "[redacted]" : null });
    if (path === "/redirect") { response.writeHead(302, { Location: "/bytes", "Content-Length": "0" }); response.end(); return; }
    const payload = path === "/echo" ? body : path === "/auth" ? Buffer.from(request.headers.authorization === "Basic dXNlcjpwYXNz" ? "authorized" : "denied")
      : path === "/missing" ? Buffer.from("missing") : Buffer.from([0, 255, 65, 10]);
    response.writeHead(path === "/missing" ? 404 : 200, { "Content-Type": "application/octet-stream", "Content-Length": payload.length, Connection: "close" });
    response.end(request.method === "HEAD" ? undefined : payload);
  });
  server.requestTimeout = 3000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests, async close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
