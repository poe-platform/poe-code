import { FsError, isFsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, FileStat, FileSystem,
  FsOptions, MkdirOptions, ReadFileOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/filesystem.js";
import { davChild, davChildren, parseXml, scalar } from "./xml.js";
import type { XmlElement } from "./xml.js";

export type WebDavFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WebDavFileSystemOptions {
  readonly baseUrl: string;
  readonly fetch: WebDavFetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
  readonly maxXmlBytes?: number;
  readonly maxEntries?: number;
  readonly timeoutMs?: number;
  readonly overwritePolicy?: "lock" | "etag";
}

const propfindBody = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/>'
  + '<d:getlastmodified/><d:creationdate/><d:getetag/></d:prop></d:propfind>';

const lockBody = '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope>'
  + '<d:locktype><d:write/></d:locktype></d:lockinfo>';

function fail(code: ErrnoCode, syscall: string, path: string, message?: string): never {
  throw new FsError(code, { syscall, path, ...(message === undefined ? {} : { message }) });
}

function positive(value: number, name: string, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    throw new FsError("EINVAL", { message: `${name} must be a ${zero ? "nonnegative" : "positive"} safe integer` });
  }
  return value;
}

function strongEtag(value: string | null | undefined, path: string): string {
  if (!value || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)) {
    fail("ENOTSUP", "webdav", path, "operation requires a strong entity tag");
  }
  return value;
}

function normalize(path: string): string {
  if (typeof path !== "string" || path.includes("\0") || path.includes("\\")) {
    fail("EINVAL", "resolve", String(path), "invalid WebDAV path");
  }
  try { encodeURIComponent(path); }
  catch { fail("EINVAL", "resolve", path, "path contains an unpaired surrogate"); }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) fail("EACCES", "resolve", path, "path escapes WebDAV root");
      segments.pop();
    } else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function requiresCollection(path: string): boolean {
  const last = path.split("/").at(-1);
  return last === "" || last === "." || last === "..";
}

function validateUrlText(text: string): void {
  if (/[\u0000-\u0020\u007f\\?#]/.test(text)) throw new Error("invalid URL characters");
  for (const segment of text.split("/")) {
    const decoded = decodeURIComponent(segment);
    if (decoded === "." || decoded === ".." || /[/\\\u0000]/.test(decoded)) {
      throw new Error("ambiguous URL segment");
    }
  }
}

function urlSegments(url: URL): string[] {
  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const segments = pathname.slice(1).split("/");
  if (segments.length === 1 && segments[0] === "") return [];
  if (segments.some((segment) => segment === "")) throw new Error("empty URL segment");
  return segments.map((segment) => decodeURIComponent(segment));
}

function statusCode(element: XmlElement): number {
  const text = scalar(element);
  if (!/^HTTP\/\d+\.\d+ [2-5]\d\d(?:[ \t].*)?$/.test(text)) throw new Error("invalid DAV status line");
  return Number(text.split(" ")[1]);
}

export class WebDavFileSystem implements FileSystem {
  readonly capabilities = Object.freeze({
    symlinks: false, hardlinks: false, permissions: false, timestamps: false,
    atomicRename: false, streamingRead: false, streamingWrite: false,
  });
  private readonly base: URL;
  private readonly baseSegments: string[];
  private readonly transport: WebDavFetch;
  private readonly headers: Headers;
  private readonly maxResponseBytes: number;
  private readonly maxXmlBytes: number;
  private readonly maxEntries: number;
  private readonly timeoutMs: number;
  private readonly overwritePolicy: "lock" | "etag";
  private readonly etags = new WeakMap<FileStat, string>();

  constructor(options: WebDavFileSystemOptions) {
    if (typeof options.fetch !== "function") throw new FsError("EINVAL", { message: "an explicit fetch transport is required" });
    try {
      validateUrlText(options.baseUrl);
      this.base = new URL(options.baseUrl);
      if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password
        || this.base.search || this.base.hash) throw new Error("invalid base URL");
      this.baseSegments = urlSegments(this.base);
      this.base.pathname = `/${this.baseSegments.map(encodeURIComponent).join("/")}${this.baseSegments.length ? "/" : ""}`;
      this.headers = new Headers(options.headers);
      for (const name of this.headers.keys()) {
        if (["host", "destination", "depth", "overwrite", "if", "if-match", "if-none-match", "range",
          "content-length", "content-type", "transfer-encoding", "connection", "proxy-authorization", "lock-token", "timeout"].includes(name)) {
          throw new Error(`reserved header ${name}`);
        }
      }
      if (this.base.protocol !== "https:" && [...this.headers.keys()].some((name) => name === "authorization" || name === "cookie")) {
        throw new Error("explicit credentials require HTTPS");
      }
    } catch (cause) {
      throw new FsError("EINVAL", { message: "invalid WebDAV base URL or headers", cause });
    }
    this.transport = options.fetch;
    this.maxResponseBytes = positive(options.maxResponseBytes ?? 64 * 1024 * 1024, "maxResponseBytes");
    this.maxXmlBytes = positive(options.maxXmlBytes ?? 2 * 1024 * 1024, "maxXmlBytes");
    this.maxEntries = positive(options.maxEntries ?? 10_000, "maxEntries");
    this.timeoutMs = positive(options.timeoutMs ?? 30_000, "timeoutMs");
    this.overwritePolicy = options.overwritePolicy ?? "lock";
    if (!["lock", "etag"].includes(this.overwritePolicy)) throw new FsError("EINVAL", { message: "invalid overwritePolicy" });
    if (this.timeoutMs > 2_147_483_647) throw new FsError("EINVAL", { message: "timeoutMs exceeds timer range" });
  }

  private url(path: string, collection = false): string {
    const relative = path.slice(1).split("/").map(encodeURIComponent).join("/");
    return `${this.base.href}${relative}${collection && relative ? "/" : ""}`;
  }

  private hrefPath(href: string): string {
    try {
      validateUrlText(href);
      if (!(href.startsWith("/") && !href.startsWith("//")) && !/^https?:\/\//i.test(href)) throw new Error("href must be absolute");
      const url = new URL(href, this.base);
      if (url.origin !== this.base.origin || url.username || url.password || url.search || url.hash) throw new Error("href is not confined");
      const segments = urlSegments(url);
      if (segments.length < this.baseSegments.length || this.baseSegments.some((segment, index) => segments[index] !== segment)) {
        throw new Error("href escapes root");
      }
      return normalize(`/${segments.slice(this.baseSegments.length).join("/")}`);
    } catch (cause) {
      throw new FsError("EACCES", { syscall: "webdav", message: "response URL escapes or ambiguously addresses WebDAV root", cause });
    }
  }

  private httpError(status: number, method: string, path: string, exclusive = false): never {
    const codes: Partial<Record<number, ErrnoCode>> = {
      400: "EINVAL", 401: "EACCES", 403: "EACCES", 404: "ENOENT", 405: method === "MKCOL" ? "EEXIST" : "ENOTSUP",
      408: "ETIMEDOUT", 409: method === "PUT" || method === "MKCOL" ? "ENOENT" : "EINVAL", 410: "ENOENT",
      412: exclusive ? "EEXIST" : "EAGAIN", 413: "EFBIG", 414: "ENAMETOOLONG", 415: "ENOTSUP",
      423: "EBUSY", 429: "EAGAIN", 501: "ENOTSUP", 503: "EAGAIN", 504: "ETIMEDOUT", 507: "ENOSPC",
    };
    fail(status >= 300 && status < 400 ? "ENOTSUP" : codes[status] ?? "EIO", method, path,
      status >= 300 && status < 400 ? "WebDAV redirects are not followed" : `WebDAV HTTP status ${status}`);
  }

  private async request<T>(method: string, path: string, options: FsOptions, init: RequestInit,
    consume: (response: Response, signal: AbortSignal) => Promise<T>, collection = false): Promise<T> {
    if (options.signal?.aborted) fail("ECANCELED", method, path);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const headers = new Headers(this.headers);
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
    headers.set("Cache-Control", "no-cache");
    let response: Response | undefined;
    try {
      let url = this.url(path, collection);
      for (let attempt = 0; ; attempt++) {
        response = await this.transport(url, {
          ...init, method, headers, redirect: "manual", credentials: "omit", signal,
        });
        if (signal.aborted) signal.throwIfAborted();
        if (response.redirected || response.type === "opaqueredirect") fail("ENOTSUP", method, path, "transport followed or hid a redirect");
        if (response.url && this.hrefPath(response.url) !== path) fail("EACCES", method, path, "transport changed the requested resource");
        const location = response.headers.get("Location");
        if (attempt === 0 && method === "PROPFIND" && !url.endsWith("/")
          && [301, 302, 307, 308].includes(response.status) && location !== null
          && this.hrefPath(location) === path && new URL(location, this.base).href === `${url}/`) {
          await response.body?.cancel();
          signal.throwIfAborted();
          url += "/";
          continue;
        }
        return await consume(response, signal);
      }
    } catch (cause) {
      if (options.signal?.aborted) throw new FsError("ECANCELED", { syscall: method, path, cause });
      if (timeout.aborted) throw new FsError("ETIMEDOUT", { syscall: method, path, cause });
      if (isFsError(cause)) throw cause;
      throw new FsError("EIO", { syscall: method, path, message: "WebDAV transport or response failure", cause });
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }

  private async bytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
    const length = response.headers.get("content-length");
    if (length !== null && /^\d+$/.test(length) && Number(length) > limit) fail("EFBIG", "webdav", "", "response exceeds byte limit");
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const result = await reader.read();
        signal.throwIfAborted();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > limit) fail("EFBIG", "webdav", "", "response exceeds byte limit");
        chunks.push(new Uint8Array(result.value));
      }
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      return data;
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async multistatus(response: Response, signal: AbortSignal): Promise<XmlElement[]> {
    const link = response.headers.get("link");
    if (link && /\brel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|'[^']*\bnext\b[^']*'|next\b)/i.test(link)) {
      fail("ENOTSUP", "PROPFIND", "", "paginated WebDAV responses are unsupported");
    }
    const data = await this.bytes(response, this.maxXmlBytes, signal);
    const encoding = (data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0x3c && data[1] === 0)
      ? "utf-16le" : (data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0 && data[1] === 0x3c) ? "utf-16be" : "utf-8";
    const root = parseXml(new TextDecoder(encoding, { fatal: true }).decode(data));
    if (root.namespace !== "DAV:" || root.localName !== "multistatus") throw new Error("expected DAV:multistatus");
    const responses = davChildren(root, "response");
    if (responses.length > this.maxEntries) fail("EFBIG", "PROPFIND", "", "response exceeds entry limit");
    return responses;
  }

  private entryStat(element: XmlElement, path: string): FileStat {
    const wholeStatus = davChild(element, "status");
    if (wholeStatus) {
      const code = statusCode(wholeStatus);
      if (code < 200 || code >= 300) this.httpError(code, "PROPFIND", path);
    }
    const properties = new Map<string, XmlElement>();
    const failures = new Map<string, number>();
    for (const propstat of davChildren(element, "propstat")) {
      const status = davChild(propstat, "status");
      const prop = davChild(propstat, "prop");
      if (!status || !prop) throw new Error("incomplete DAV:propstat");
      const code = statusCode(status);
      for (const property of prop.children) {
        if (property.namespace !== "DAV:") continue;
        if (properties.has(property.localName) || failures.has(property.localName)) throw new Error("duplicate DAV property");
        if (code >= 200 && code < 300) properties.set(property.localName, property);
        else failures.set(property.localName, code);
      }
    }
    const required = (name: string): XmlElement => {
      const property = properties.get(name);
      if (property) return property;
      const failure = failures.get(name);
      if (failure !== undefined && failure !== 404) this.httpError(failure, "PROPFIND", path);
      return fail("ENOTSUP", "stat", path, `server does not expose DAV:${name}`);
    };
    const resourceType = required("resourcetype");
    const directory = !!davChild(resourceType, "collection");
    if (resourceType.text.trim() || resourceType.children.some((child) => child.namespace !== "DAV:" || child.localName !== "collection")) {
      fail("ENOTSUP", "stat", path, "unsupported DAV resource type");
    }
    const sizeText = directory ? "0" : scalar(required("getcontentlength"));
    if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(Number(sizeText))) throw new Error("invalid content length property");
    const date = (name: string): number | undefined => {
      const property = properties.get(name);
      if (!property) return undefined;
      const value = Date.parse(scalar(property));
      if (!Number.isFinite(value)) throw new Error("invalid date property");
      return value;
    };
    const birthtimeMs = date("creationdate");
    const stat: FileStat = {
      type: directory ? "directory" : "file", size: Number(sizeText), mode: directory ? 0o40777 : 0o100666,
      mtimeMs: date("getlastmodified") ?? 0, atimeMs: 0, ctimeMs: 0,
      ...(birthtimeMs === undefined ? {} : { birthtimeMs }),
    };
    const etag = properties.get("getetag");
    if (etag) this.etags.set(stat, scalar(etag));
    return stat;
  }

  private async entries(path: string, depth: "0" | "1", options: FsOptions, collection = depth === "1"): Promise<Map<string, FileStat>> {
    return this.request("PROPFIND", path, options, {
      headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, body: propfindBody,
    }, async (response, signal) => {
      if (response.status !== 207) this.httpError(response.status, "PROPFIND", path);
      const result = new Map<string, FileStat>();
      for (const element of await this.multistatus(response, signal)) {
        const href = davChild(element, "href");
        if (!href) throw new Error("missing DAV:href");
        const member = this.hrefPath(scalar(href));
        const prefix = path === "/" ? "/" : `${path}/`;
        if (member !== path && (depth === "0" || !member.startsWith(prefix) || member.slice(prefix.length).includes("/"))) {
          fail("EACCES", "PROPFIND", path, "response member is outside requested depth");
        }
        if (result.has(member)) throw new Error("duplicate response href");
        result.set(member, this.entryStat(element, member));
      }
      if (!result.has(path)) throw new Error("response omitted requested resource");
      return result;
    }, collection);
  }

  private async mutation(method: string, path: string, options: FsOptions, init: RequestInit = {}, collection = false): Promise<void> {
    await this.request(method, path, options, init, async (response, signal) => {
      if (response.status === 207) {
        for (const element of await this.multistatus(response, signal)) {
          const href = davChild(element, "href");
          const status = davChild(element, "status");
          if (!href || !status) throw new Error("invalid mutation multistatus");
          const member = this.hrefPath(scalar(href));
          const code = statusCode(status);
          if (code < 200 || code >= 300) {
            try { this.httpError(code, method, member); }
            catch (cause) { throw new FsError("EIO", { syscall: method, path, message: "WebDAV mutation partially failed", cause }); }
          }
        }
        fail("EIO", method, path, "unexpected mutation multistatus without a reported failure");
      }
      const accepted = method === "PUT" ? [200, 201, 204] : method === "MKCOL" ? [201] : method === "DELETE" ? [204] : [201, 204];
      if (!accepted.includes(response.status)) {
        const headers = new Headers(init.headers);
        this.httpError(response.status, method, path, headers.get("If-None-Match") === "*" || headers.get("Overwrite") === "F");
      }
    }, collection);
  }

  private unsupported(operation: string, path: string): never {
    return fail("ENOTSUP", operation, path, `${operation} has no safe portable WebDAV equivalent`);
  }

  private async maybeStat(path: string, options: FsOptions): Promise<FileStat | undefined> {
    try { return await this.stat(path, options); }
    catch (error) { if (isFsError(error, "ENOENT")) return undefined; throw error; }
  }

  async stat(path: string, options: FsOptions = {}): Promise<FileStat> {
    const normalized = normalize(path);
    const collection = requiresCollection(path);
    const stat = (await this.entries(normalized, "0", options, collection)).get(normalized)!;
    if (collection && stat.type !== "directory") fail("ENOTDIR", "stat", path);
    return stat;
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.stat(path, options);
  }

  async readdir(path: string, options: FsOptions = {}): Promise<DirectoryEntry[]> {
    const normalized = normalize(path);
    const entries = await this.entries(normalized, "1", options);
    if (entries.get(normalized)!.type !== "directory") fail("ENOTDIR", "readdir", path);
    return [...entries].filter(([member]) => member !== normalized)
      .map(([member, stat]) => ({ name: member.slice(member.lastIndexOf("/") + 1), type: stat.type }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  async readFile(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    const normalized = normalize(path);
    const limit = Math.min(this.maxResponseBytes, positive(options.maxBytes ?? this.maxResponseBytes, "maxBytes", true));
    if ((await this.stat(path, options)).type === "directory") fail("EISDIR", "readFile", path);
    return this.request("GET", normalized, options, {}, async (response, signal) => {
      if (response.status !== 200) this.httpError(response.status, "GET", path);
      return this.bytes(response, limit, signal);
    });
  }

  async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    const normalized = normalize(path);
    if (options.mode !== undefined) this.unsupported("writeFile mode", path);
    if (options.flag !== undefined && !["w", "wx", "a", "ax"].includes(options.flag)) fail("EINVAL", "writeFile", path);
    if (!(data instanceof Uint8Array)) fail("EINVAL", "writeFile", path, "data must be Uint8Array");
    if (normalized === "/") fail("EISDIR", "writeFile", path);
    if (requiresCollection(path)) {
      await this.stat(path, options);
      fail("EISDIR", "writeFile", path);
    }
    let parent = "";
    for (const segment of normalized.slice(1).split("/").slice(0, -1)) {
      parent += `/${segment}`;
      await this.stat(`${parent}/`, options);
    }
    const exclusive = options.flag === "wx" || options.flag === "ax";
    const existing = exclusive ? undefined : await this.maybeStat(normalized, options);
    if (existing?.type === "directory") fail("EISDIR", "writeFile", path);
    let body = new Uint8Array(data);
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (exclusive || (options.flag === "a" && !existing)) headers["If-None-Match"] = "*";
    if (options.flag === "a" && existing) {
      const snapshot = await this.request("GET", normalized, options, { headers: { "Accept-Encoding": "identity" } }, async (response, signal) => {
        if (response.status !== 200) this.httpError(response.status, "GET", path);
        const etag = strongEtag(response.headers.get("ETag"), path);
        if (response.headers.get("Content-Encoding") && response.headers.get("Content-Encoding")!.toLowerCase() !== "identity") {
          fail("ENOTSUP", "appendFile", path, "conditional append requires an identity representation");
        }
        return { etag, data: await this.bytes(response, this.maxResponseBytes, signal) };
      });
      if (snapshot.data.byteLength + body.byteLength > this.maxResponseBytes) fail("EFBIG", "appendFile", path);
      const combined = new Uint8Array(snapshot.data.byteLength + body.byteLength);
      combined.set(snapshot.data);
      combined.set(body, snapshot.data.byteLength);
      body = combined;
      headers["If-Match"] = snapshot.etag;
    }
    if (options.flag === "a" && body.byteLength > this.maxResponseBytes) fail("EFBIG", "appendFile", path);
    await this.mutation("PUT", normalized, options, {
      headers, body,
    });
  }

  async appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    await this.writeFile(path, data, { ...options, flag: "a" });
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    const normalized = normalize(path);
    if (options.mode !== undefined) this.unsupported("mkdir mode", path);
    if (!options.recursive) {
      if (normalized === "/") fail("EEXIST", "mkdir", path);
      return this.mutation("MKCOL", normalized, options, {}, true);
    }
    let current = "";
    for (const segment of normalized.slice(1).split("/").filter(Boolean)) {
      current += `/${segment}`;
      const existing = await this.maybeStat(`${current}/`, options);
      if (existing) {
        if (existing.type !== "directory") fail("ENOTDIR", "mkdir", current);
        continue;
      }
      try { await this.mutation("MKCOL", current, options, {}, true); }
      catch (error) {
        if (!isFsError(error, "EEXIST")) throw error;
        if ((await this.stat(`${current}/`, options)).type !== "directory") fail("ENOTDIR", "mkdir", current);
      }
    }
    if (normalized === "/") await this.stat(normalized, options);
  }

  async rm(path: string, options: RemoveOptions = {}): Promise<void> {
    const normalized = normalize(path);
    if (normalized === "/") fail("EBUSY", "rm", path, "cannot remove WebDAV root");
    try {
      const stat = await this.stat(path, options);
      if (stat.type === "directory" && !options.recursive) this.unsupported("nonrecursive directory removal", path);
      await this.mutation("DELETE", normalized, options, {}, stat.type === "directory");
    } catch (error) {
      if (!(options.force && isFsError(error, "ENOENT"))) throw error;
    }
  }

  private async transfer(method: "MOVE" | "COPY", source: string, destination: string,
    options: CopyFileOptions): Promise<void> {
    const from = normalize(source);
    const to = normalize(destination);
    if (from === "/" || to === "/") fail("EBUSY", method, source, "cannot replace or transfer WebDAV root");
    const stat = await this.stat(source, options);
    if (method === "COPY" && stat.type === "directory") fail("EISDIR", "copyFile", source);
    if (requiresCollection(destination) && stat.type !== "directory") fail("ENOTDIR", method, destination);
    if (from === to) {
      if (method === "MOVE") return;
      fail(options.exclusive ? "EEXIST" : "EINVAL", "copyFile", source, "source and destination are identical");
    }
    if (stat.type === "directory" && to.startsWith(`${from}/`)) fail("EINVAL", method, destination, "cannot move directory into itself");
    const existing = await this.maybeStat(destination, options);
    if (existing && options.exclusive) fail("EEXIST", method, destination);
    const checkType = (target: FileStat): void => {
      if (target.type === "directory" && stat.type === "file") fail("EISDIR", method, destination);
      if (target.type !== "directory" && stat.type === "directory") fail("ENOTDIR", method, destination);
    };
    if (existing) checkType(existing);
    if (stat.type === "directory" && from.startsWith(`${to}/`)) fail("EINVAL", method, destination, "cannot replace an ancestor of the source");
    const destinationUrl = this.url(to, stat.type === "directory");
    const headers: Record<string, string> = {
      Destination: destinationUrl, Overwrite: existing ? "T" : "F",
      Depth: method === "COPY" ? "0" : "infinity",
    };
    const sourceEtag = this.etags.get(stat);
    if (existing && sourceEtag && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(sourceEtag)) headers["If-Match"] = sourceEtag;
    const mutate = (): Promise<void> => this.mutation(method, from, options, { headers }, stat.type === "directory");
    if (!existing) return mutate();
    if (this.overwritePolicy === "etag" && existing.type === "file") {
      headers.If = `<${destinationUrl}> ([${strongEtag(this.etags.get(existing), destination)}])`;
      return mutate();
    }
    await this.withDestinationLock(to, existing, options, async (token) => {
      const locked = await this.stat(destination, options);
      checkType(locked);
      if (locked.type === "directory" && (await this.readdir(destination, options)).length) fail("ENOTEMPTY", method, destination);
      headers.If = `<${destinationUrl}> (${token})`;
      await mutate();
    });
  }

  private async withDestinationLock(path: string, stat: FileStat, options: FsOptions,
    operation: (token: string) => Promise<void>): Promise<void> {
    let token: string | undefined;
    const collection = stat.type === "directory";
    const validator = this.etags.get(stat);
    try {
      await this.request("LOCK", path, options, {
        headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "infinity", Timeout: "Second-60",
          "If-Match": validator && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(validator) ? validator : "*" },
        body: lockBody,
      }, async (response, signal) => {
        if (response.status !== 200) this.httpError(response.status, "LOCK", path);
        const header = response.headers.get("Lock-Token");
        if (!header || !/^<[a-z][a-z0-9+.-]*:[^<>\s\x00-\x20\x7f]+>$/i.test(header)) throw new Error("invalid LOCK token");
        token = header;
        const root = parseXml(new TextDecoder("utf-8", { fatal: true }).decode(await this.bytes(response, this.maxXmlBytes, signal)));
        const discovery = davChild(root, "lockdiscovery");
        const active = discovery && davChild(discovery, "activelock");
        const scope = active && davChild(active, "lockscope");
        const type = active && davChild(active, "locktype");
        const depth = active && davChild(active, "depth");
        const lockToken = active && davChild(active, "locktoken");
        const href = lockToken && davChild(lockToken, "href");
        const lockRoot = active && davChild(active, "lockroot");
        const rootHref = lockRoot && davChild(lockRoot, "href");
        const timeout = active && davChild(active, "timeout");
        if (root.namespace !== "DAV:" || root.localName !== "prop" || !scope || !davChild(scope, "exclusive")
          || !type || !davChild(type, "write") || !depth || scalar(depth) !== "infinity"
          || !href || `<${scalar(href)}>` !== token || !rootHref || this.hrefPath(scalar(rootHref)) !== path
          || !timeout || !/^Second-[1-9]\d*$/i.test(scalar(timeout)) || Number(scalar(timeout).slice(7)) > 4_294_967_295) {
          fail("ENOTSUP", "LOCK", path, "server did not grant a finite exclusive depth-infinity write lock");
        }
      }, collection);
      await operation(token!);
    } finally {
      if (token) await this.request("UNLOCK", path, {}, { headers: { "Lock-Token": token } }, async (response) => {
        if (response.status !== 204) this.httpError(response.status, "UNLOCK", path);
      }, collection).catch(() => {});
    }
  }

  async rename(source: string, destination: string, options: FsOptions = {}): Promise<void> {
    await this.transfer("MOVE", source, destination, options);
  }

  async copyFile(source: string, destination: string, options: CopyFileOptions = {}): Promise<void> {
    await this.transfer("COPY", source, destination, options);
  }

  async realpath(path: string, options: FsOptions = {}): Promise<string> {
    const normalized = normalize(path);
    await this.stat(path, options);
    return normalized;
  }

  async access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) fail("EINVAL", "access", path);
    if (mode !== 0) this.unsupported("access permission checks", path);
    await this.stat(path, options);
  }

  async readlink(path: string, _options: FsOptions = {}): Promise<string> { return this.unsupported("readlink", path); }
  async symlink(_target: string, path: string, _options: FsOptions = {}): Promise<void> { this.unsupported("symlink", path); }
  async link(_source: string, path: string, _options: FsOptions = {}): Promise<void> { this.unsupported("link", path); }
  async chmod(path: string, _mode: number, _options: FsOptions = {}): Promise<void> { this.unsupported("chmod", path); }
  async utimes(path: string, _atimeMs: number, _mtimeMs: number, _options: FsOptions = {}): Promise<void> { this.unsupported("utimes", path); }
  async truncate(path: string, _length?: number, _options: FsOptions = {}): Promise<void> { this.unsupported("truncate", path); }
}
