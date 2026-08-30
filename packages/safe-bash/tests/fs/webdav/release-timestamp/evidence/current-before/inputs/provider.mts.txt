import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { FileStat, FileSystem } from "virtual-bash";

const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export async function withBackingDav(backing: FileSystem, operation: (baseUrl: string, requests: string[]) => Promise<void>): Promise<void> {
  const requests: string[] = [];
  const resources = new Map<object | symbol | undefined, Map<string, string>>();
  const versions = new Map<string, { stamp: string; version: number }>();
  let nextVersion = 0;
  const identifier = (stat: FileStat) => {
    let scope = resources.get(stat.identityScope);
    if (!scope) { scope = new Map(); resources.set(stat.identityScope, scope); }
    const key = `${stat.dev}:${stat.ino}`;
    let value = scope.get(key);
    if (!value) { value = `urn:uuid:${randomUUID()}`; scope.set(key, value); }
    return value;
  };
  const etag = (path: string, stat: FileStat) => {
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    let version = versions.get(path);
    if (!version || version.stamp !== stamp) { version = { stamp, version: nextVersion++ }; versions.set(path, version); }
    return `"fixture-${version.version}"`;
  };
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    requests.push(method);
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/dav/")) { response.writeHead(404); response.end(); return; }
      const path = decodeURIComponent(url.pathname.slice(4));
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      let stat: FileStat | undefined;
      try { stat = await backing.stat(path); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
      const validator = stat && etag(path, stat);
      if (request.headers["if-match"] && request.headers["if-match"] !== validator) { response.writeHead(412); response.end(); return; }
      if (request.headers["if-none-match"] === "*" && stat) { response.writeHead(412); response.end(); return; }
      if (method === "PROPFIND") {
        if (!stat) { response.writeHead(404); response.end(); return; }
        const paths = [path];
        if (request.headers.depth === "1" && stat.type === "directory") {
          for (const entry of await backing.readdir(path)) paths.push(`${path === "/" ? "" : path}/${entry.name}`);
        }
        const entries: string[] = [];
        for (const entryPath of paths) {
          const entry = await backing.stat(entryPath);
          const href = `/dav${entryPath.split("/").map(encodeURIComponent).join("/")}`;
          entries.push(`<d:response><d:href>${xml(href)}</d:href><d:propstat><d:prop>`
            + `<d:resourcetype>${entry.type === "directory" ? "<d:collection/>" : ""}</d:resourcetype>`
            + `<d:getcontentlength>${entry.size}</d:getcontentlength><d:getetag>${xml(etag(entryPath, entry))}</d:getetag>`
            + `<d:getlastmodified>${new Date(entry.mtimeMs).toUTCString()}</d:getlastmodified>`
            + (body.toString().includes("resource-id") ? `<d:resource-id><d:href>${identifier(entry)}</d:href></d:resource-id>` : "")
            + `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
        }
        const content = Buffer.from(`<d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`);
        response.writeHead(207, { "Content-Type": "application/xml", "Content-Length": content.length });
        response.end(content);
      } else if (method === "GET") {
        if (!stat) { response.writeHead(404); response.end(); return; }
        const content = await backing.readFile(path);
        response.writeHead(200, { ETag: validator!, "Content-Length": content.byteLength });
        response.end(content);
      } else if (method === "PUT") {
        await backing.writeFile(path, new Uint8Array(body));
        versions.delete(path);
        response.writeHead(stat ? 204 : 201); response.end();
      } else if (method === "DELETE") {
        await backing.rm(path);
        versions.delete(path);
        response.writeHead(204); response.end();
      } else if (method === "PROPPATCH") {
        const match = /<v:timestamps>([^]*?)<\/v:timestamps>/.exec(body.toString());
        if (!stat || !match) { response.writeHead(stat ? 400 : 404); response.end(); return; }
        const value: unknown = JSON.parse(match[1]!.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
        if (!value || typeof value !== "object" || !("atimeMs" in value) || typeof value.atimeMs !== "number"
          || !("mtimeMs" in value) || typeof value.mtimeMs !== "number") {
          response.writeHead(400); response.end(); return;
        }
        if (!backing.utimes) { response.writeHead(501); response.end(); return; }
        await backing.utimes(path, value.atimeMs, value.mtimeMs);
        const content = Buffer.from(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${xml(`/dav${path}`)}</d:href>`
          + `<d:propstat><d:prop><v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop>`
          + `<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
        response.writeHead(207, { "Content-Type": "application/xml", "Content-Length": content.length }); response.end(content);
      } else { response.writeHead(501); response.end(); }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      response.writeHead(code === "ENOENT" ? 404 : code === "EACCES" ? 403 : 500);
      response.end();
    }
  });
  server.requestTimeout = 3000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing loopback address");
    await operation(`http://127.0.0.1:${address.port}/dav/`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
