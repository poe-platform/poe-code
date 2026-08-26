import { createHash } from "node:crypto";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";

export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function resource(href: string, directory = false, size = 0, extra = "", etag?: string): string {
  return `<z:response><z:href>${escapeXml(href)}</z:href><z:propstat><z:prop>`
    + `<z:resourcetype>${directory ? "<z:collection/>" : ""}</z:resourcetype>`
    + `<z:getcontentlength>${size}</z:getcontentlength>`
    + (etag === undefined ? "" : `<z:getetag>${escapeXml(etag)}</z:getetag>`)
    + `<z:getlastmodified>Wed, 26 Aug 2026 12:00:00 GMT</z:getlastmodified>`
    + `<z:creationdate>2026-08-01T00:00:00Z</z:creationdate>`
    + `</z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>${extra}</z:response>`;
}

export function multistatus(...resources: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><z:multistatus xmlns:z="DAV:">${resources.join("")}</z:multistatus>`;
}

export function xmlResponse(xml: string, headers: Record<string, string> = {}): Response {
  return new Response(xml, { status: 207, headers: { "Content-Type": "application/xml", ...headers } });
}

export interface MockRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
}

export class MockDav {
  readonly files = new Map<string, Uint8Array | null>([["/", null]]);
  readonly requests: MockRequest[] = [];
  etag(path: string): string | undefined {
    const data = this.files.get(path);
    return data === undefined ? undefined : `"${createHash("sha256").update(data === null ? "directory" : "file").update(data ?? "").digest("hex")}"`;
  }
  readonly fetch: WebDavFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    this.requests.push({ url, init, headers });
    const parsed = new URL(url);
    const path = this.path(parsed.pathname);
    const body = init.method === "PUT" ? new Uint8Array(await new Response(init.body).arrayBuffer()) : undefined;
    const directory = this.files.get(path) === null;
    const exists = this.files.has(path);
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const method = init.method;
    const match = headers.get("If-Match");
    if (match && (match === "*" ? !exists : match !== this.etag(path))) return new Response(null, { status: 412 });
    if (headers.get("If-None-Match") === "*" && exists) return new Response(null, { status: method === "GET" ? 304 : 412 });
    if (method === "PROPFIND") {
      if (!exists) return new Response(null, { status: 404 });
      const entries = [...this.files].filter(([name]) => name === path || (headers.get("Depth") === "1"
        && (name.slice(0, name.lastIndexOf("/")) || "/") === path && name !== "/"));
      return xmlResponse(multistatus(...entries.map(([name, data]) => resource(
        `/dav${name === "/" ? "/" : name.split("/").map(encodeURIComponent).join("/")}${data === null && name !== "/" ? "/" : ""}`,
        data === null, data?.byteLength ?? 0, "", this.etag(name),
      ))));
    }
    if (method === "GET") {
      if (!exists) return new Response(null, { status: 404 });
      if (directory) return new Response(null, { status: 405 });
      return new Response(new Uint8Array(this.files.get(path)!), { headers: { ETag: this.etag(path)! } });
    }
    if (method === "PUT") {
      if (directory) return new Response(null, { status: 405 });
      if (this.files.get(parent) !== null) return new Response(null, { status: 409 });
      this.files.set(path, body!);
      return new Response(null, { status: exists ? 204 : 201 });
    }
    if (method === "MKCOL") {
      if (exists) return new Response(null, { status: 405 });
      if (this.files.get(parent) !== null) return new Response(null, { status: 409 });
      this.files.set(path, null);
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      if (!exists) return new Response(null, { status: 404 });
      for (const name of this.files.keys()) {
        if (name === path || name.startsWith(`${path}/`)) this.files.delete(name);
      }
      return new Response(null, { status: 204 });
    }
    if (method === "MOVE" || method === "COPY") {
      if (!exists) return new Response(null, { status: 404 });
      const destination = this.path(new URL(headers.get("Destination")!).pathname);
      const destinationExists = this.files.has(destination);
      if (destinationExists && headers.get("Overwrite") === "F") return new Response(null, { status: 412 });
      if (this.files.get(destination.slice(0, destination.lastIndexOf("/")) || "/") !== null) return new Response(null, { status: 409 });
      for (const [name, data] of [...this.files]) {
        if (name === path || name.startsWith(`${path}/`)) {
          this.files.set(destination + name.slice(path.length), data === null ? null : new Uint8Array(data));
          if (method === "MOVE") this.files.delete(name);
        }
      }
      return new Response(null, { status: destinationExists ? 204 : 201 });
    }
    return new Response(null, { status: 501 });
  };

  private path(pathname: string): string {
    const path = pathname.slice(4).split("/").map(decodeURIComponent).join("/");
    return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path || "/";
  }
}
