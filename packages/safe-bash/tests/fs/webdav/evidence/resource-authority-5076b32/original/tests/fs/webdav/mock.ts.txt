import { createHash, randomUUID } from "node:crypto";
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
  readonly locks = new Map<string, { token: string; expires: number }>();
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
    for (const [name, lock] of this.locks) if (lock.expires <= Date.now()) this.locks.delete(name);
    const match = headers.get("If-Match");
    if (match && (match === "*" ? !exists : match.startsWith("W/") || match !== this.etag(path))) return new Response(null, { status: 412 });
    if (headers.get("If-None-Match") === "*" && exists) return new Response(null, { status: method === "GET" ? 304 : 412 });
    const condition = headers.get("If");
    const submitted = new Set<string>();
    if (condition) {
      const tagged = /^<([^<>]+)>\s+\((.*)\)$/.exec(condition);
      if (!tagged) return new Response(null, { status: 400 });
      const target = this.path(new URL(tagged[1]!, url).pathname);
      const conditions = tagged[2]!.match(/(?:Not\s+)?(?:<[^<>]+>|\[(?:W\/)?"[^"]*"\])/g);
      if (!conditions?.length || conditions.join(" ") !== tagged[2]) return new Response(null, { status: 400 });
      for (let expression of conditions) {
        const negate = expression.startsWith("Not ");
        if (negate) expression = expression.slice(4);
        let matches: boolean;
        if (expression.startsWith("<")) {
          const token = expression.slice(1, -1);
          submitted.add(token);
          matches = [...this.locks].some(([name, lock]) => lock.token === token && (target === name || target.startsWith(`${name}/`)));
        } else matches = this.etag(target)?.replace(/^W\//, "") === expression.slice(1, -1).replace(/^W\//, "");
        if (matches === negate) return new Response(null, { status: 412 });
      }
    }
    if (method === "LOCK") {
      if (headers.get("Depth") !== "infinity" || !init.body) return new Response(null, { status: 400 });
      if ([...this.locks.keys()].some((name) => name === path || name.startsWith(`${path}/`) || path.startsWith(`${name}/`))) return new Response(null, { status: 423 });
      if (!exists) this.files.set(path, new Uint8Array());
      const token = `urn:uuid:${randomUUID()}`;
      this.locks.set(path, { token, expires: Date.now() + 60_000 });
      return new Response(`<d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock>`
        + `<d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:depth>infinity</d:depth>`
        + `<d:timeout>Second-60</d:timeout><d:locktoken><d:href>${escapeXml(token)}</d:href></d:locktoken>`
        + `<d:lockroot><d:href>${escapeXml(url)}</d:href></d:lockroot></d:activelock></d:lockdiscovery></d:prop>`,
      { status: exists ? 200 : 201, headers: { "Lock-Token": `<${token}>`, "Content-Type": "application/xml" } });
    }
    if (method === "UNLOCK") {
      if (headers.get("Lock-Token") !== `<${this.locks.get(path)?.token}>`) return new Response(null, { status: 409 });
      this.locks.delete(path);
      return new Response(null, { status: 204 });
    }
    const destination = headers.has("Destination") ? this.path(new URL(headers.get("Destination")!).pathname) : undefined;
    const affected = [...(method === "COPY" ? [] : [path]), ...(destination ? [destination] : [])];
    if (!["GET", "PROPFIND"].includes(method!)) {
      for (const [name, lock] of this.locks) {
        if (affected.some((target) => target === name || target.startsWith(`${name}/`) || name.startsWith(`${target}/`))
          && !submitted.has(lock.token)) return new Response(null, { status: 423 });
      }
    }
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
      const target = destination!;
      const destinationExists = this.files.has(target);
      if (destinationExists && headers.get("Overwrite") === "F") return new Response(null, { status: 412 });
      if (this.files.get(target.slice(0, target.lastIndexOf("/")) || "/") !== null) return new Response(null, { status: 409 });
      for (const name of this.files.keys()) if (name === target || name.startsWith(`${target}/`)) this.files.delete(name);
      for (const [name, data] of [...this.files]) {
        if (name === path || name.startsWith(`${path}/`)) {
          this.files.set(target + name.slice(path.length), data === null ? null : new Uint8Array(data));
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
