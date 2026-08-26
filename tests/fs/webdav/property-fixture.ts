import { once } from "node:events";
import { createServer } from "node:http";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";
import { escapeXml, MockDav, multistatus, resource, xmlResponse } from "./mock.js";

export const namespace = "urn:virtual-bash:metadata";

export class PropertyDav {
  readonly base = new MockDav();
  readonly properties = new Map<string, string>();
  propertyStatus = 200;
  readonly fetch: WebDavFetch = async (url, init) => {
    const path = new URL(url).pathname.slice(4).split("/").map(decodeURIComponent).join("/").replace(/\/$/, "") || "/";
    const result = await this.base.fetch(url, init);
    if (init.method === "PROPPATCH" && result.status === 501) {
      if (!this.base.files.has(path)) return new Response(null, { status: 404 });
      const body = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
      if (!body.includes(`xmlns:v="${namespace}"`)) return new Response(null, { status: 400 });
      const match = /<v:timestamps>([^]*?)<\/v:timestamps>/.exec(body);
      if (!match) return new Response(null, { status: 400 });
      const value = match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
      JSON.parse(value);
      if (this.propertyStatus === 200) this.properties.set(path, value);
      return xmlResponse(multistatus(`<z:response><z:href>${escapeXml(new URL(url).pathname)}</z:href>`
        + `<z:propstat><z:prop><v:timestamps xmlns:v="${namespace}"/></z:prop>`
        + `<z:status>HTTP/1.1 ${this.propertyStatus} Property Status</z:status></z:propstat></z:response>`));
    }
    if (init.method === "PROPFIND" && result.status === 207) {
      const depth = new Headers(init.headers).get("Depth");
      const entries = [...this.base.files].filter(([name]) => name === path || (depth === "1"
        && (name.slice(0, name.lastIndexOf("/")) || "/") === path && name !== "/"));
      return xmlResponse(multistatus(...entries.map(([name, data]) => {
        const value = this.properties.get(name);
        const property = value === undefined ? "" : `<z:propstat><z:prop><v:timestamps xmlns:v="${namespace}">`
          + `${escapeXml(value)}</v:timestamps></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>`;
        return resource(`/dav${name.split("/").map(encodeURIComponent).join("/")}${data === null && name !== "/" ? "/" : ""}`,
          data === null, data?.byteLength ?? 0, property, this.base.etag(name));
      })));
    }
    if (result.status >= 200 && result.status < 300 && ["COPY", "MOVE", "DELETE"].includes(init.method!)) {
      const destination = new Headers(init.headers).get("Destination");
      const target = destination && new URL(destination).pathname.slice(4).split("/").map(decodeURIComponent).join("/").replace(/\/$/, "");
      if (target) for (const name of this.properties.keys()) {
        if (name === target || name.startsWith(`${target}/`)) this.properties.delete(name);
      }
      for (const [name, value] of [...this.properties]) if (name === path || name.startsWith(`${path}/`)) {
        if (target) this.properties.set(target + name.slice(path.length), value);
        if (init.method !== "COPY") this.properties.delete(name);
      }
    }
    return result;
  };
}

export async function withLoopbackDav(transport: WebDavFetch, operation: (baseUrl: string) => Promise<void>): Promise<void> {
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
    await operation(`http://127.0.0.1:${address.port}/dav/`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
