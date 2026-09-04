import { FsError, isErrnoCode, isFsError } from "../../contracts/errors.js";
import { composeAbortSignals } from "../../contracts/abort.js";
import type { AbortSignalScope } from "../../contracts/abort.js";
import type { PlatformComparisonCallback } from "#safe-fs-platform";
import type { ErrnoCode } from "../../contracts/errors.js";
import { readBytes } from "../../contracts/io.js";
import type { ByteSource } from "../../contracts/io.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, EntryComparison, FileStat, FileSystem, FileSystemCapabilities,
  FsOptions, MkdirOptions, ReadFileOptions, ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/filesystem.js";
import { davChild, davChildren, parseXml, scalar } from "./xml.js";
import type { XmlElement } from "./xml.js";
import { assertCallbackAuthorityAllowed, compareEntries, registerEntryAuthority } from "../mount/comparison.js";
import { compareWebDavResources, ownedResponseIdentifier, recordOwnedResourceStat, registerResourceQuery, resourceIdentifier } from "./resource-id.js";

export type WebDavFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WebDavAtomicEmptyDirectoryRequest {
  readonly operation: "atomic-empty-rmdir/v1";
  readonly namespaceUrl: string;
  readonly path: string;
  readonly signal?: AbortSignal;
}

export interface WebDavAtomicEmptyDirectoryResult {
  readonly operation: "atomic-empty-rmdir/v1";
  readonly namespaceUrl: string;
  readonly path: string;
  readonly outcome: "removed";
}

export interface WebDavAtomicEmptyDirectoryBinding {
  readonly namespaceUrl: string;
  readonly removeEmptyDirectory: (request: WebDavAtomicEmptyDirectoryRequest) => Promise<WebDavAtomicEmptyDirectoryResult>;
}

export interface WebDavFileSystemOptions {
  readonly baseUrl: string;
  readonly fetch: WebDavFetch;
  readonly requestStreamSupport?: "native" | boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
  readonly maxXmlBytes?: number;
  readonly maxEntries?: number;
  readonly timeoutMs?: number;
  readonly overwritePolicy?: "lock" | "etag";
  readonly atomicEmptyDirectory?: WebDavAtomicEmptyDirectoryBinding;
  readonly compareEntry?: PlatformComparisonCallback<(this: FileSystem, ...args: Parameters<NonNullable<FileSystem["compareEntry"]>>)
    => ReturnType<NonNullable<FileSystem["compareEntry"]>>>;
}

const timestampNamespace = "urn:virtual-bash:metadata";
const propfindBody = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/>'
  + `<d:getlastmodified/><d:creationdate/><d:getetag/><v:timestamps xmlns:v="${timestampNamespace}"/></d:prop></d:propfind>`;

const lockBody = '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope>'
  + '<d:locktype><d:write/></d:locktype></d:lockinfo>';

const resourceIdBody = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop><d:resource-id/></d:prop></d:propfind>';

function fail(code: ErrnoCode, syscall: string, path: string, message?: string): never {
  throw new FsError(code, { syscall, path, ...(message === undefined ? {} : { message }) });
}

function positive(value: number, name: string, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    throw new FsError("EINVAL", { message: `${name} must be a ${zero ? "nonnegative" : "positive"} safe integer` });
  }
  return value;
}

function createRequestTimeout(timeoutMs: number): AbortSignalScope {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }, timeoutMs);
  if (typeof timer === "object" && timer !== null) {
    const handle: { unref?(): unknown } = timer;
    handle.unref?.();
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    }
  };
}

function nativeRequestStreamsSupported(url: string): boolean {
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    body = new ReadableStream<Uint8Array>({ start(destination) { destination.close(); } });
    let duplexAccessed = false;
    const init: RequestInit & { duplex: "half" } = {
      method: "PUT", body,
      get duplex(): "half" { duplexAccessed = true; return "half"; },
    };
    const request = new Request(url, init);
    return duplexAccessed && !request.headers.has("Content-Type");
  } catch {
    return false;
  } finally {
    if (body && !body.locked) void body.cancel().catch(() => {});
  }
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

function validateDirectoryAccessPath(path: string): void {
  if (typeof path !== "string") fail("EINVAL", "resolve", String(path), "invalid WebDAV path");
  let bytes = 0;
  let components = 0;
  let inComponent = false;
  for (let offset = 0; offset < path.length; offset++) {
    const point = path.codePointAt(offset)!;
    if (point === 47) inComponent = false;
    else if (!inComponent) {
      components++;
      inComponent = true;
    }
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (point > 0xffff) offset++;
    if (bytes > 65_536 || components > 256) {
      fail("ENAMETOOLONG", "access", path, "directory access exceeds the 64KiB path or 256 component limit");
    }
  }
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
    read: true, stat: true, readdir: true, realpath: true, access: true,
    write: true, append: true, exclusiveCreate: true, explicitDirectories: true, implicitDirectories: false,
    mkdir: true, recursiveMkdir: true, remove: true, recursiveRemove: true, rename: true, copy: true,
    exclusiveCopy: true, readlink: false, truncate: false, randomAccessWrite: false,
    removeDirectory: false as boolean, streamingAppend: false as boolean,
    symlinks: false, hardlinks: false, permissions: false, timestamps: true,
    atomicRename: false, streamingRead: true, streamingWrite: true,
  } satisfies FileSystemCapabilities);
  private readonly base: URL;
  private readonly baseSegments: string[];
  private readonly transport: WebDavFetch;
  private readonly requestStreamSupport: "native" | boolean;
  private readonly headers: Headers;
  private readonly maxResponseBytes: number;
  private readonly maxXmlBytes: number;
  private readonly maxEntries: number;
  private readonly timeoutMs: number;
  private readonly overwritePolicy: "lock" | "etag";
  private readonly configuredComparison: boolean;
  private readonly atomicEmptyDirectory: WebDavAtomicEmptyDirectoryBinding | undefined;
  private readonly etags = new WeakMap<FileStat, string>();

  constructor(options: WebDavFileSystemOptions) {
    if (typeof options.fetch !== "function") throw new FsError("EINVAL", { message: "an explicit fetch transport is required" });
    if (options.requestStreamSupport !== undefined && options.requestStreamSupport !== "native"
      && typeof options.requestStreamSupport !== "boolean") {
      throw new FsError("EINVAL", { message: "requestStreamSupport must be native or a boolean" });
    }
    if (options.compareEntry !== undefined && typeof options.compareEntry !== "function") {
      throw new FsError("EINVAL", { message: "compareEntry must be a function" });
    }
    if (options.compareEntry !== undefined) assertCallbackAuthorityAllowed();
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
    const binding = options.atomicEmptyDirectory;
    if (binding !== undefined) {
      if (!binding || typeof binding !== "object" || binding.namespaceUrl !== this.base.href
        || typeof binding.removeEmptyDirectory !== "function") {
        throw new FsError("EINVAL", { message: "atomicEmptyDirectory must bind the canonical WebDAV namespace and a callback" });
      }
      this.atomicEmptyDirectory = Object.freeze({ namespaceUrl: this.base.href, removeEmptyDirectory: binding.removeEmptyDirectory });
    }
    this.transport = options.fetch === globalThis.fetch ? options.fetch.bind(globalThis) : options.fetch;
    this.requestStreamSupport = options.requestStreamSupport ?? (options.fetch === globalThis.fetch ? "native" : false);
    this.capabilities = Object.freeze({ ...this.capabilities,
      removeDirectory: this.atomicEmptyDirectory !== undefined,
      streamingAppend: this.requestStreamSupport !== false,
    });
    this.maxResponseBytes = positive(options.maxResponseBytes ?? 64 * 1024 * 1024, "maxResponseBytes");
    this.maxXmlBytes = positive(options.maxXmlBytes ?? 2 * 1024 * 1024, "maxXmlBytes");
    this.maxEntries = positive(options.maxEntries ?? 10_000, "maxEntries");
    this.timeoutMs = positive(options.timeoutMs ?? 30_000, "timeoutMs");
    this.overwritePolicy = options.overwritePolicy ?? "lock";
    this.configuredComparison = options.compareEntry !== undefined;
    if (!["lock", "etag"].includes(this.overwritePolicy)) throw new FsError("EINVAL", { message: "invalid overwritePolicy" });
    if (this.timeoutMs > 2_147_483_647) throw new FsError("EINVAL", { message: "timeoutMs exceeds timer range" });
    registerResourceQuery(this, (path, settings) => this.resourceId(path, settings), originalWebDavComparison, options.compareEntry);
    registerEntryAuthority(this, compareWebDavResources);
  }

  compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}): Promise<EntryComparison> {
    return compareEntries(this, path, peer, peerPath, options);
  }

  private async resourceId(input: string, options: FsOptions): Promise<string | undefined> {
    const path = normalize(input);
    return this.request("PROPFIND", path, options, {
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" }, body: resourceIdBody,
    }, async (response, signal) => {
      if (response.status !== 207) this.httpError(response.status, "PROPFIND", path);
      const responses = await this.multistatus(response, signal, "PROPFIND", path);
      if (responses.length !== 1) throw new Error("resource identity requires exactly one DAV:response");
      const entry = responses[0]!;
      const href = davChild(entry, "href");
      if (!href) throw new Error("missing resource identity response href");
      if (this.hrefPath(scalar(href)) !== path) fail("EACCES", "PROPFIND", path, "resource identity response addresses another resource");
      const wholeStatus = davChild(entry, "status");
      const propstats = davChildren(entry, "propstat");
      if (wholeStatus) {
        if (propstats.length) throw new Error("conflicting response status and propstat");
        this.httpError(statusCode(wholeStatus), "PROPFIND", path);
      }
      if (propstats.length === 0) throw new Error("missing resource identity propstat");
      let seen = false;
      let identifier: string | undefined;
      for (const propstat of propstats) {
        const status = davChild(propstat, "status");
        const prop = davChild(propstat, "prop");
        if (!status || !prop) throw new Error("incomplete resource identity propstat");
        const code = statusCode(status);
        if (code !== 200 && code !== 404) this.httpError(code, "PROPFIND", path);
        for (const property of davChildren(prop, "resource-id")) {
          if (seen) throw new Error("duplicate or conflicting resource identity property");
          seen = true;
          if (code === 404) continue;
          const value = davChild(property, "href");
          if (!value || property.children.length !== 1 || property.text.trim()) throw new Error("invalid resource identity property");
          identifier = resourceIdentifier(scalar(value));
        }
      }
      const owned = ownedResponseIdentifier(response, path);
      if (owned !== undefined && identifier !== undefined && resourceIdentifier(owned) !== identifier) {
        throw new Error("resource identity contradicts provider provenance");
      }
      return identifier;
    });
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
    consume: (response: Response, signal: AbortSignal) => Promise<T>, collection = false,
    received?: (response: Response, late: boolean) => void): Promise<T> {
    for await (const result of this.requestStream(method, path, options, init, async function* (response, signal) {
      yield await consume(response, signal);
    }, collection, received)) return result;
    throw new Error("missing WebDAV response");
  }

  private async *requestStream<T>(method: string, path: string, options: FsOptions, init: RequestInit,
    consume: (response: Response, signal: AbortSignal) => AsyncIterable<T>, collection = false,
    received?: (response: Response, late: boolean) => void): AsyncGenerator<T> {
    if (options.signal?.aborted) fail("ECANCELED", method, path);
    const deadline = createRequestTimeout(this.timeoutMs);
    const timeout = deadline.signal;
    try {
      const headers = new Headers(this.headers);
      for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
      headers.set("Cache-Control", "no-cache");
      const signalScope = options.signal ? composeAbortSignals([timeout, options.signal]) : undefined;
      const signal = signalScope?.signal ?? timeout;
      let response: Response | undefined;
      const receive = (value: Response, late: boolean): void => {
        if (value.redirected || value.type === "opaqueredirect") fail("ENOTSUP", method, path, "transport followed or hid a redirect");
        if (value.url && this.hrefPath(value.url) !== path) fail("EACCES", method, path, "transport changed the requested resource");
        received?.(value, late);
      };
      try {
        let url = this.url(path, collection);
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          response = await new Promise<Response>((resolve, reject) => {
            let abandoned = false;
            const abort = (): void => {
              abandoned = true;
              signal.removeEventListener("abort", abort);
              reject(signal.reason);
            };
            signal.addEventListener("abort", abort, { once: true });
            try {
              Promise.resolve(this.transport(url, {
                ...init, method, headers, redirect: "manual", credentials: "omit", signal,
              })).then((value) => {
                signal.removeEventListener("abort", abort);
                if (!abandoned) resolve(value);
                else {
                  try { receive(value, true); }
                  catch (ignoredError) { void ignoredError; }
                  finally {
                    if (value.body && !value.body.locked) void value.body.cancel(signal.reason).catch(() => {});
                  }
                }
              }, (error: unknown) => {
                signal.removeEventListener("abort", abort);
                reject(error);
              }).catch(reject);
            } catch (error) {
              signal.removeEventListener("abort", abort);
              reject(error);
            }
          });
          receive(response, false);
          signal.throwIfAborted();
          const location = response.headers.get("Location");
          if (attempt === 0 && method === "PROPFIND" && !url.endsWith("/")
            && [301, 302, 307, 308].includes(response.status) && location !== null
            && this.hrefPath(location) === path && new URL(location, this.base).href === `${url}/`) {
            await response.body?.cancel();
            signal.throwIfAborted();
            url += "/";
            continue;
          }
          yield* consume(response, signal);
          return;
        }
      } catch (cause) {
        if (options.signal?.aborted) throw new FsError("ECANCELED", { syscall: method, path, cause });
        if (timeout.aborted) throw new FsError("ETIMEDOUT", { syscall: method, path, cause });
        if (isFsError(cause)) throw cause;
        throw new FsError("EIO", { syscall: method, path, message: "WebDAV transport or response failure", cause });
      } finally {
        signalScope?.dispose();
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      }
    } finally {
      deadline.dispose();
    }
  }

  private async bytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of this.bodyChunks(response, limit, signal)) {
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data;
  }

  private async *bodyChunks(response: Response, limit: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
      fail("EIO", "webdav", "", "invalid response Content-Length");
    }
    const encoding = response.headers.get("content-encoding");
    const expected = length !== null && (!encoding || encoding.toLowerCase() === "identity") ? Number(length) : undefined;
    if (expected !== undefined && expected > limit) fail("EFBIG", "webdav", "", "response exceeds byte limit");
    if (!response.body) {
      if (expected !== undefined && expected !== 0) fail("EIO", "webdav", "", "response body length differs from Content-Length");
      return;
    }
    const reader = response.body.getReader();
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
        if (expected !== undefined && size > expected) fail("EIO", "webdav", "", "response body length differs from Content-Length");
        yield new Uint8Array(result.value);
      }
      if (expected !== undefined && size !== expected) fail("EIO", "webdav", "", "response body length differs from Content-Length");
    } finally {
      signal.removeEventListener("abort", abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async xml(response: Response, signal: AbortSignal): Promise<XmlElement> {
    const data = await this.bytes(response, this.maxXmlBytes, signal);
    const encoding = (data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0x3c && data[1] === 0)
      ? "utf-16le" : (data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0 && data[1] === 0x3c) ? "utf-16be" : "utf-8";
    return parseXml(new TextDecoder(encoding, { fatal: true }).decode(data), {
      maxNodes: this.maxXmlBytes, maxAttributes: this.maxXmlBytes,
    });
  }

  private async multistatus(response: Response, signal: AbortSignal, method = "PROPFIND", path = ""): Promise<XmlElement[]> {
    const link = response.headers.get("link");
    if (link && /\brel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|'[^']*\bnext\b[^']*'|next\b)/i.test(link)) {
      fail("ENOTSUP", method, path, "paginated WebDAV responses are unsupported");
    }
    const root = await this.xml(response, signal);
    if (root.namespace !== "DAV:" || root.localName !== "multistatus") throw new Error("expected DAV:multistatus");
    const responses = davChildren(root, "response");
    if (responses.length > this.maxEntries) fail("EFBIG", method, path, "response exceeds entry limit");
    return responses;
  }

  private async lockFailure(response: Response, signal: AbortSignal, path: string): Promise<never> {
    try {
      const members = new Set<string>();
      let failure: { member: string; status: number } | undefined;
      for (const element of await this.multistatus(response, signal, "LOCK", path)) {
        const href = davChild(element, "href");
        const status = davChild(element, "status");
        if (!href || !status) throw new Error("invalid LOCK multistatus");
        const member = this.hrefPath(scalar(href));
        if (member !== path && !member.startsWith(`${path}/`)) {
          fail("EACCES", "LOCK", path, "LOCK response member is outside requested subtree");
        }
        if (members.has(member)) throw new Error("duplicate LOCK response href");
        members.add(member);
        const code = statusCode(status);
        if (code >= 300 && (!failure || (failure.status === 424 && code !== 424))) {
          failure = { member, status: code };
        }
      }
      if (!failure) throw new Error("LOCK multistatus without a reported failure");
      this.httpError(failure.status, "LOCK", failure.member);
    } catch (cause) {
      throw new FsError(isFsError(cause) ? cause.code : "EIO", {
        syscall: "LOCK", path, message: "WebDAV LOCK multistatus failure", cause,
      });
    }
  }

  private entryStat(element: XmlElement, path: string): FileStat {
    const wholeStatus = davChild(element, "status");
    if (wholeStatus) {
      const code = statusCode(wholeStatus);
      if (code < 200 || code >= 300) this.httpError(code, "PROPFIND", path);
    }
    const properties = new Map<string, XmlElement>();
    const failures = new Map<string, number>();
    let timestampProperty: XmlElement | undefined;
    let timestampSeen = false;
    for (const propstat of davChildren(element, "propstat")) {
      const status = davChild(propstat, "status");
      const prop = davChild(propstat, "prop");
      if (!status || !prop) throw new Error("incomplete DAV:propstat");
      const code = statusCode(status);
      for (const property of prop.children) {
        if (property.namespace === timestampNamespace && property.localName === "timestamps") {
          if (timestampSeen) throw new Error("duplicate timestamp property");
          timestampSeen = true;
          if (code === 200) timestampProperty = property;
        }
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
    const etag = properties.get("getetag");
    const validator = etag && scalar(etag);
    let mtimeMs = date("getlastmodified") ?? 0;
    let atimeMs = 0;
    if (timestampProperty) {
      const timestamps: unknown = JSON.parse(scalar(timestampProperty));
      if (typeof timestamps !== "object" || timestamps === null
        || !("version" in timestamps) || timestamps.version !== 1
        || !("etag" in timestamps) || typeof timestamps.etag !== "string" || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(timestamps.etag)
        || !("type" in timestamps) || (timestamps.type !== "file" && timestamps.type !== "directory")
        || !("atimeMs" in timestamps) || typeof timestamps.atimeMs !== "number" || !Number.isFinite(timestamps.atimeMs)
        || Math.abs(timestamps.atimeMs) > 8.64e15
        || !("mtimeMs" in timestamps) || typeof timestamps.mtimeMs !== "number" || !Number.isFinite(timestamps.mtimeMs)
        || Math.abs(timestamps.mtimeMs) > 8.64e15) throw new Error("invalid timestamp property");
      if (timestamps.etag === validator && timestamps.type === (directory ? "directory" : "file")) {
        mtimeMs = timestamps.mtimeMs;
        atimeMs = timestamps.atimeMs;
      }
    }
    const stat: FileStat = {
      type: directory ? "directory" : "file", size: Number(sizeText), mode: directory ? 0o40777 : 0o100666,
      mtimeMs, atimeMs, ctimeMs: 0,
      ...(birthtimeMs === undefined ? {} : { birthtimeMs }),
    };
    if (validator) this.etags.set(stat, validator);
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
        const stat = this.entryStat(element, member);
        recordOwnedResourceStat(response, this, member, stat);
        result.set(member, stat);
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
    try {
      const stat = (await this.entries(normalized, "0", options, collection)).get(normalized)!;
      if (collection && stat.type !== "directory") fail("ENOTDIR", "stat", path);
      return stat;
    } catch (error) {
      if (!isFsError(error, "ENOENT")) throw error;
      let parent = "";
      for (const segment of normalized.slice(1).split("/").slice(0, -1)) {
        parent += `/${segment}`;
        const ancestor = (await this.entries(parent, "0", options)).get(parent)!;
        if (ancestor.type !== "directory") fail("ENOTDIR", "stat", path);
      }
      throw error;
    }
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
    return this.request("GET", normalized, options, { headers: { "Accept-Encoding": "identity" } }, async (response, signal) => {
      if (response.status !== 200) this.httpError(response.status, "GET", path);
      return this.bytes(response, limit, signal);
    });
  }

  async *readStream(path: string, options: ReadStreamOptions = {}): AsyncGenerator<Uint8Array> {
    const normalized = normalize(path);
    const start = positive(options.start ?? 0, "start", true);
    const end = options.endExclusive === undefined ? Infinity : positive(options.endExclusive, "endExclusive", true);
    const chunkSize = positive(options.chunkSize ?? 64 * 1024, "chunkSize");
    if (end < start) fail("EINVAL", "readStream", path, "endExclusive precedes start");
    if ((await this.stat(path, options)).type === "directory") fail("EISDIR", "readStream", path);
    yield* this.requestStream("GET", normalized, options, { headers: { "Accept-Encoding": "identity" } }, async function* (this: WebDavFileSystem, response: Response, signal: AbortSignal) {
      if (response.status !== 200) this.httpError(response.status, "GET", path);
      let position = 0;
      for await (const chunk of this.bodyChunks(response, this.maxResponseBytes, signal)) {
        const first = Math.max(0, start - position);
        const last = Math.min(chunk.byteLength, end - position);
        for (let offset = first; offset < last; offset += chunkSize) {
          signal.throwIfAborted();
          yield chunk.slice(offset, Math.min(last, offset + chunkSize));
        }
        position += chunk.byteLength;
        if (position >= end) return;
      }
    }.bind(this));
  }

  private async prepareWrite(path: string, options: WriteFileOptions): Promise<{
    normalized: string; headers: Record<string, string>; prefix: Uint8Array;
  }> {
    const normalized = normalize(path);
    if (options.mode !== undefined) this.unsupported("writeFile mode", path);
    if (options.flag !== undefined && !["w", "wx", "a", "ax"].includes(options.flag)) fail("EINVAL", "writeFile", path);
    if (options.signal?.aborted) fail("ECANCELED", "writeFile", path);
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
    let prefix: Uint8Array = new Uint8Array();
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
      prefix = snapshot.data;
      headers["If-Match"] = snapshot.etag;
    }
    return { normalized, headers, prefix };
  }

  async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    if (!(data instanceof Uint8Array)) fail("EINVAL", "writeFile", path, "data must be Uint8Array");
    const { normalized, headers, prefix } = await this.prepareWrite(path, options);
    if (options.flag === "a" && prefix.byteLength + data.byteLength > this.maxResponseBytes) fail("EFBIG", "appendFile", path);
    const body = new Uint8Array(prefix.byteLength + data.byteLength);
    body.set(prefix);
    body.set(data, prefix.byteLength);
    await this.mutation("PUT", normalized, options, {
      headers, body,
    });
  }

  async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    if (options.signal?.aborted) fail("ECANCELED", "writeStream", path);
    if (this.requestStreamSupport === false
      || (this.requestStreamSupport === "native" && !nativeRequestStreamsSupported(this.base.href))) {
      fail("ENOTSUP", "writeStream", path, "transport does not declare supported request streams");
    }
    const { normalized, headers, prefix } = await this.prepareWrite(path, options);
    const deadline = createRequestTimeout(this.timeoutMs);
    const timeout = deadline.signal;
    try {
      const controller = new AbortController();
      const signalScope = composeAbortSignals([timeout, controller.signal, ...(options.signal ? [options.signal] : [])]);
      const signal = signalScope.signal;
      const limit = this.maxResponseBytes;
      const chunks = (async function* () {
        let size = prefix.byteLength;
        if (prefix.byteLength) yield prefix;
        for await (const chunk of readBytes(source, signal)) {
          size += chunk.byteLength;
          if (size > limit) fail("EFBIG", "writeStream", path, "upload exceeds byte limit");
          yield new Uint8Array(chunk);
        }
      })();
      let finished = false;
      let uploadError: unknown;
      let body: ReadableStream<Uint8Array> | undefined;
      try {
        body = new ReadableStream<Uint8Array>({
          async pull(destination) {
            try {
              const result = await chunks.next();
              if (result.done) { finished = true; destination.close(); }
              else destination.enqueue(result.value);
            } catch (cause) { uploadError = cause; destination.error(cause); }
          },
          cancel(reason) { controller.abort(reason); void chunks.return(undefined).catch(() => {}); },
        }, { highWaterMark: 0 });
        try {
          const request: RequestInit & { duplex: "half" } = { headers, body, duplex: "half" };
          await this.mutation("PUT", normalized, options, request);
          if (uploadError !== undefined) throw uploadError;
          if (!finished) fail("EIO", "writeStream", path, "server responded before consuming the upload");
        } catch (cause) {
          if (options.signal?.aborted) throw new FsError("ECANCELED", { syscall: "writeStream", path, cause });
          if (timeout.aborted) throw new FsError("ETIMEDOUT", { syscall: "writeStream", path, cause });
          if (isFsError(uploadError)) throw uploadError;
          if (isFsError(cause)) throw cause;
          throw new FsError("EIO", { syscall: "writeStream", path, cause });
        }
      } finally {
        controller.abort();
        signalScope.dispose();
        if (body && !body.locked) void body.cancel().catch(() => {});
        void chunks.return(undefined).catch(() => {});
      }
    } finally {
      deadline.dispose();
    }
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

  async rmdir(path: string, options: FsOptions = {}): Promise<void> {
    try {
      const normalized = normalize(path);
      if (options.signal?.aborted) fail("ECANCELED", "rmdir", path);
      if (normalized === "/") fail("EBUSY", "rmdir", path, "cannot remove WebDAV root");
      const stat = await this.stat(path, options);
      if (options.signal?.aborted) fail("ECANCELED", "rmdir", path);
      if (stat.type !== "directory") fail("ENOTDIR", "rmdir", path);
      if (this.atomicEmptyDirectory) {
        await this.atomicRmdir(normalized, path, options);
        return;
      }
      const entries = await this.readdir(path, options);
      if (options.signal?.aborted) fail("ECANCELED", "rmdir", path);
      if (entries.length) fail("ENOTEMPTY", "rmdir", path);
      this.unsupported("rmdir", path);
    } catch (error) {
      if (isFsError(error) && (error.syscall !== "rmdir" || error.path !== path)) {
        throw new FsError(error.code, { syscall: "rmdir", path, cause: error });
      }
      throw error;
    }
  }

  private async atomicRmdir(normalized: string, path: string, options: FsOptions): Promise<void> {
    const deadline = createRequestTimeout(this.timeoutMs);
    const timeout = deadline.signal;
    try {
      const signalScope = options.signal ? composeAbortSignals([timeout, options.signal]) : undefined;
      const signal = signalScope?.signal ?? timeout;
      try {
        signal.throwIfAborted();
        const receipt = await new Promise<WebDavAtomicEmptyDirectoryResult>((resolve, reject) => {
          const abort = (): void => {
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
          };
          signal.addEventListener("abort", abort, { once: true });
          try {
            Promise.resolve(this.atomicEmptyDirectory!.removeEmptyDirectory(Object.freeze({
              operation: "atomic-empty-rmdir/v1", namespaceUrl: this.base.href, path: normalized, signal,
            }))).then((result) => {
              signal.removeEventListener("abort", abort);
              resolve(result);
            }, (error: unknown) => {
              signal.removeEventListener("abort", abort);
              reject(error);
            });
          } catch (error) {
            signal.removeEventListener("abort", abort);
            reject(error);
          }
        });
        signal.throwIfAborted();
        if (!receipt || receipt.operation !== "atomic-empty-rmdir/v1" || receipt.namespaceUrl !== this.base.href
          || receipt.path !== normalized || receipt.outcome !== "removed") {
          fail("EIO", "rmdir", path, "atomic empty-directory receipt mismatch; removal outcome is uncertain");
        }
      } catch (cause) {
        if (options.signal?.aborted) throw new FsError("ECANCELED", { syscall: "rmdir", path, cause });
        if (timeout.aborted) throw new FsError("ETIMEDOUT", { syscall: "rmdir", path, cause });
        if (isFsError(cause)) throw cause;
        const code = cause && typeof cause === "object" && "code" in cause && isErrnoCode(cause.code) ? cause.code : "EIO";
        throw new FsError(code, { syscall: "rmdir", path, cause });
      } finally {
        signalScope?.dispose();
      }
    } finally {
      deadline.dispose();
    }
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

  private async guardTransferIdentity(source: string, destination: string, options: FsOptions): Promise<void> {
    if (!this.configuredComparison && this.compareEntry === originalWebDavComparison) return;
    const comparison = await compareEntries(this, source, this, destination, options);
    if (source === destination) {
      if (comparison === "distinct") fail("EIO", "compareEntry", source, "comparison contradicts identical WebDAV paths");
      return;
    }
    if (comparison === "same") fail("EINVAL", "compareEntry", destination, "source and destination refer to the same entry");
    if (comparison === "unknown") fail("ENOTSUP", "compareEntry", destination, "configured authority cannot establish distinct entries");
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
      await this.guardTransferIdentity(from, to, options);
      if (method === "MOVE") return;
      fail(options.exclusive ? "EEXIST" : "EINVAL", "copyFile", source, "source and destination are identical");
    }
    if (stat.type === "directory" && to.startsWith(`${from}/`)) fail("EINVAL", method, destination, "cannot move directory into itself");
    const existing = await this.maybeStat(destination, options);
    if (existing) await this.guardTransferIdentity(from, to, options);
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
    const unlock = async (value: string): Promise<void> => {
      await this.request("UNLOCK", path, {}, { headers: { "Lock-Token": value } }, async (response) => {
        if (response.status !== 204) this.httpError(response.status, "UNLOCK", path);
      }, collection).catch(() => {});
    };
    try {
      await this.request("LOCK", path, options, {
        headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "infinity", Timeout: "Second-60",
          "If-Match": validator && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(validator) ? validator : "*" },
        body: lockBody,
      }, async (response, signal) => {
        if (response.status === 207) return this.lockFailure(response, signal, path);
        if (response.status !== 200) this.httpError(response.status, "LOCK", path);
        const root = await this.xml(response, signal);
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
          || davChild(scope, "shared")
          || !type || !davChild(type, "write") || !depth || scalar(depth) !== "infinity"
          || !href || `<${scalar(href)}>` !== token
          || (lockRoot !== undefined && (!rootHref || this.hrefPath(scalar(rootHref)) !== path))
          || !timeout || !/^Second-[1-9]\d*$/i.test(scalar(timeout)) || Number(scalar(timeout).slice(7)) > 4_294_967_295) {
          fail("ENOTSUP", "LOCK", path, "server did not grant a finite exclusive depth-infinity write lock");
        }
      }, collection, (response, late) => {
        if (response.status !== 200) return;
        const header = response.headers.get("Lock-Token");
        if (!header || !/^<[a-z][a-z0-9+.-]*:[^<>\s\x00-\x20\x7f]+>$/i.test(header)) throw new Error("invalid LOCK token");
        if (late) void unlock(header);
        else token = header;
      });
      await operation(token!);
    } finally {
      if (token) await unlock(token);
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
    if (options.signal?.aborted) fail("ECANCELED", "access", path);
    if (mode & 2) this.unsupported("access write/execute permission checks", path);
    if (mode & 1) validateDirectoryAccessPath(path);
    const stat = await this.stat(path, options);
    if (options.signal?.aborted) fail("ECANCELED", "access", path);
    if ((mode & 1) && stat.type !== "directory") this.unsupported("access execute permission checks", path);
    if (mode & 4) {
      if (stat.type === "directory") await this.readdir(path, options);
      else await this.request("GET", normalize(path), options, { headers: { "Accept-Encoding": "identity" } }, async (response) => {
        if (response.status !== 200) this.httpError(response.status, "GET", path);
      });
    }
    if (options.signal?.aborted) fail("ECANCELED", "access", path);
  }

  async readlink(path: string, _options: FsOptions = {}): Promise<string> { return this.unsupported("readlink", path); }
  async symlink(_target: string, path: string, _options: FsOptions = {}): Promise<void> { this.unsupported("symlink", path); }
  async link(_source: string, path: string, _options: FsOptions = {}): Promise<void> { this.unsupported("link", path); }
  async chmod(path: string, _mode: number, _options: FsOptions = {}): Promise<void> { this.unsupported("chmod", path); }
  async utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    const normalized = normalize(path);
    if (![atimeMs, mtimeMs].every(value => Number.isFinite(value) && Math.abs(value) <= 8.64e15)) fail("EINVAL", "utimes", path);
    const stat = await this.stat(path, options);
    const etag = strongEtag(this.etags.get(stat), path);
    const metadata = JSON.stringify({ version: 1, etag, type: stat.type, atimeMs, mtimeMs })
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    await this.request("PROPPATCH", normalized, options, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "If-Match": etag },
      body: `<d:propertyupdate xmlns:d="DAV:" xmlns:v="${timestampNamespace}"><d:set><d:prop>`
        + `<v:timestamps>${metadata}</v:timestamps></d:prop></d:set></d:propertyupdate>`,
    }, async (response, signal) => {
      if (response.status !== 207) this.httpError(response.status, "PROPPATCH", path);
      const entries = await this.multistatus(response, signal);
      if (entries.length !== 1) throw new Error("PROPPATCH must report the requested resource");
      const entry = entries[0]!;
      const href = davChild(entry, "href");
      if (!href || this.hrefPath(scalar(href)) !== normalized) fail("EACCES", "PROPPATCH", path, "unexpected response resource");
      const status = davChild(entry, "status");
      if (status) this.httpError(statusCode(status), "PROPPATCH", path);
      const propstats = davChildren(entry, "propstat");
      if (propstats.length !== 1) throw new Error("PROPPATCH must report the requested property");
      const prop = davChild(propstats[0]!, "prop");
      const result = davChild(propstats[0]!, "status");
      const property = prop?.children[0];
      if (!result || prop?.children.length !== 1 || property?.namespace !== timestampNamespace
        || property.localName !== "timestamps") throw new Error("invalid PROPPATCH property result");
      const code = statusCode(result);
      if (code !== 200) this.httpError(code, "PROPPATCH", path);
    }, stat.type === "directory");
    const updated = await this.stat(path, options);
    if (updated.atimeMs !== atimeMs || updated.mtimeMs !== mtimeMs) {
      fail("EAGAIN", "utimes", path, "server did not retain requested timestamps for the current representation");
    }
  }
  async truncate(path: string, _length?: number, _options: FsOptions = {}): Promise<void> { this.unsupported("truncate", path); }
}

const originalWebDavComparison = WebDavFileSystem.prototype.compareEntry;
