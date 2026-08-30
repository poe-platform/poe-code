import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { WebDavFetch } from "../../../../src/fs/webdav/index.js";

export async function withLoopbackDav(transport: WebDavFetch, operation: (baseUrl: string, fetch: WebDavFetch) => Promise<void>): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach(entry => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      const result = await transport(`http://${request.headers.host}${request.url}`, {
        method: request.method!, headers, ...(body.length ? { body } : {}),
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(new Uint8Array(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  server.requestTimeout = 3000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing loopback address");
    const baseUrl = `http://127.0.0.1:${address.port}/dav/`;
    const fetch: WebDavFetch = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.origin !== new URL(baseUrl).origin || init.method !== "PROPFIND") {
        throw new Error("Property fixture only permits its own loopback PROPFIND requests");
      }
      const body = init.body;
      if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
        throw new TypeError("Property fixture requires a string or byte request body");
      }
      return await new Promise<Response>((resolve, reject) => {
        const pending = httpRequest(parsed, {
          method: init.method,
          headers: Object.fromEntries(new Headers(init.headers)),
          ...(init.signal ? { signal: init.signal } : {}),
        }, async incoming => {
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of incoming) {
              size += chunk.length;
              if (size > 1024 * 1024) throw new Error("Property response exceeds fixture limit");
              chunks.push(Buffer.from(chunk));
            }
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (Array.isArray(value)) value.forEach(entry => headers.append(name, entry));
              else if (value !== undefined) headers.set(name, value);
            }
            resolve(new Response(new Uint8Array(Buffer.concat(chunks)), { status: incoming.statusCode!, headers }));
          } catch (error) { reject(error); }
        });
        pending.setTimeout(3000, () => pending.destroy(new Error("Property fixture request timeout")));
        pending.on("error", reject);
        pending.end(body);
      });
    };
    await operation(baseUrl, fetch);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
