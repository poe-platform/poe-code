import { posix } from "node:path";
import { FsError, isFsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, EntryComparison, FileStat, FileSystem,
  FsOptions, MkdirOptions, ReadFileOptions, ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/filesystem.js";
import { collectBytes, readBytes } from "../../contracts/io.js";
import type { ByteSource } from "../../contracts/io.js";
import { compareEntries, registerEntryAuthority } from "../mount/comparison.js";
import { compareOwnedS3Entries, queryS3Head, recordS3Stat, registerS3EntryOwner } from "./authority.js";
import { encodeCopySource } from "./transport.js";
import type {
  S3GetOutput, S3HeadOutput, S3ListOutput, S3ObjectSummary, S3RequestOptions, S3Transport,
  S3StreamGetOutput,
} from "./transport.js";

export interface S3FileSystemOptions {
  readonly transport: S3Transport;
  readonly bucket: string;
  readonly prefix?: string;
  readonly compareEntry?: (this: FileSystem, ...args: Parameters<NonNullable<FileSystem["compareEntry"]>>) => ReturnType<NonNullable<FileSystem["compareEntry"]>>;
  readonly readOnly?: boolean;
  readonly allowNonAtomicRename?: boolean;
  readonly pageSize?: number;
  readonly maxReadBytes?: number;
  readonly maxStreamBytes?: number;
  readonly maxListEntries?: number;
}

interface NodeInfo {
  readonly stat: FileStat;
  readonly metadata?: S3HeadOutput;
}

export class S3RenameError extends FsError {
  readonly phase: "copy" | "delete";
  readonly copiedKeys: readonly string[];
  readonly deletedKeys: readonly string[];

  constructor(source: string, destination: string, phase: "copy" | "delete", copied: string[], deleted: string[], cause: FsError) {
    super(cause.code, {
      syscall: "rename", path: source, dest: destination, cause,
      message: `non-atomic S3 rename failed during ${phase}; destination copies or partial source deletions may remain`,
    });
    this.name = "S3RenameError";
    this.phase = phase;
    this.copiedKeys = Object.freeze([...copied]);
    this.deletedKeys = Object.freeze([...deleted]);
  }
}

function serviceCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { name?: unknown; code?: unknown; Code?: unknown };
  const value = record.Code ?? record.code ?? record.name;
  return typeof value === "string" ? value : undefined;
}

function translate(error: unknown, syscall: string, path: string, precondition: ErrnoCode = "EAGAIN"): FsError {
  if (error instanceof FsError) return error;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  const name = serviceCode(error);
  let code: ErrnoCode = "EIO";
  if (name === "AbortError" || status === 499) code = "ECANCELED";
  else if (name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket" || status === 404) code = "ENOENT";
  else if (["AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"].includes(name ?? "") || status === 401 || status === 403) code = "EACCES";
  else if (name === "PreconditionFailed" || status === 412) code = precondition;
  else if (name === "ConditionalRequestConflict" || name === "SlowDown" || status === 409 || status === 429 || status === 503) code = "EAGAIN";
  else if (name === "NotImplemented" || status === 501) code = "ENOTSUP";
  else if (name === "EntityTooLarge") code = "EFBIG";
  else if (name === "InvalidArgument" || name === "InvalidRequest" || status === 400) code = "EINVAL";
  else if (name === "TimeoutError" || name === "RequestTimeout" || status === 408) code = "ETIMEDOUT";
  return new FsError(code, { syscall, path, cause: error });
}

function fail(code: ErrnoCode, syscall: string, path: string, message?: string): never {
  throw new FsError(code, { syscall, path, ...(message === undefined ? {} : { message }) });
}

function validateLimit(value: number, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new FsError("EINVAL", { message: `${name} must be an integer from ${minimum} to ${maximum}` });
  }
  return value;
}

function isWellFormed(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

export class S3FileSystem implements FileSystem {
  readonly capabilities;
  readonly readStream?: (path: string, options?: ReadStreamOptions) => ByteSource;
  readonly writeStream?: (path: string, source: ByteSource, options?: WriteFileOptions) => Promise<void>;
  private readonly transport: S3Transport;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly allowRename: boolean;
  private readonly pageSize: number;
  private readonly maxReadBytes: number;
  private readonly maxStreamBytes: number;
  private readonly maxListEntries: number;

  constructor(options: S3FileSystemOptions) {
    if (!options?.transport || ["headObject", "getObject", "putObject", "deleteObject", "copyObject", "listObjectsV2"]
      .some((method) => typeof (options.transport as unknown as Record<string, unknown>)[method] !== "function")) {
      throw new FsError("EINVAL", { message: "an explicit six-operation S3 transport is required; no default credentials or network client are created" });
    }
    if (options.compareEntry !== undefined && typeof options.compareEntry !== "function") {
      throw new FsError("EINVAL", { message: "compareEntry must be a filesystem comparison callback" });
    }
    if (typeof options.bucket !== "string" || !options.bucket || /[\/:\0]/.test(options.bucket)) {
      throw new FsError("EINVAL", { message: "bucket must be a nonempty bucket name, not a URL or ARN" });
    }
    const prefix = options.prefix ?? "";
    if (typeof prefix !== "string" || prefix.includes("\0") || !isWellFormed(prefix)
      || (prefix !== "" && prefix.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === ".."))) {
      throw new FsError("EINVAL", { message: "prefix must be a canonical relative object-key prefix" });
    }
    this.prefix = prefix === "" || prefix.endsWith("/") ? prefix : `${prefix}/`;
    if (Buffer.byteLength(this.prefix) > 1024) throw new FsError("ENAMETOOLONG", { message: "S3 prefix exceeds 1024 UTF-8 bytes" });
    this.transport = options.transport;
    this.bucket = options.bucket;
    this.allowRename = options.allowNonAtomicRename ?? true;
    this.pageSize = validateLimit(options.pageSize ?? 1000, "pageSize", 1, 1000);
    this.maxReadBytes = validateLimit(options.maxReadBytes ?? 64 * 1024 * 1024, "maxReadBytes", 0);
    this.maxStreamBytes = validateLimit(options.maxStreamBytes ?? 5_000_000_000, "maxStreamBytes", 0, 5_000_000_000);
    this.maxListEntries = validateLimit(options.maxListEntries ?? 100_000, "maxListEntries", 1);
    this.capabilities = Object.freeze({
      readOnly: options.readOnly ?? false,
      symlinks: false, hardlinks: false, permissions: false,
      timestamps: options.transport.capabilities?.conditionalCopy === true || options.transport.capabilities?.conditionalPut === true,
      atomicRename: false,
      streamingRead: options.transport.capabilities?.streamingRead === true && typeof options.transport.getObjectStream === "function",
      streamingWrite: options.transport.capabilities?.streamingWrite === true && typeof options.transport.putObjectStream === "function",
    });
    if (this.capabilities.streamingRead) this.readStream = this.streamRead.bind(this);
    if (this.capabilities.streamingWrite) this.writeStream = this.streamWrite.bind(this);
    const transport = this.transport;
    const bucket = this.bucket;
    const registeredPrefix = this.prefix;
    registerS3EntryOwner(this, path => this.path(path), () => this.transport === transport
      && this.bucket === bucket && this.prefix === registeredPrefix, s3Comparison, options.compareEntry);
    registerEntryAuthority(this, compareOwnedS3Entries);
  }

  async compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}): Promise<EntryComparison> {
    return compareEntries(this, path, peer, peerPath, options);
  }

  private path(input: string): string {
    if (typeof input !== "string" || input.includes("\0") || !isWellFormed(input)) fail("EINVAL", "resolve", input, "invalid path string");
    const components: string[] = [];
    for (const part of input.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (components.length === 0) fail("EACCES", "resolve", input, "path attempts to escape the configured prefix");
        components.pop();
      } else components.push(part);
    }
    const path = `/${components.join("/")}`;
    if (Buffer.byteLength(this.key(path)) > 1024) fail("ENAMETOOLONG", "resolve", input);
    return path;
  }

  private key(path: string): string {
    return this.prefix + path.slice(1);
  }

  private directoryKey(path: string): string {
    const key = path === "/" ? this.prefix : `${this.key(path)}/`;
    if (Buffer.byteLength(key) > 1024) fail("ENAMETOOLONG", "resolve", path);
    return key;
  }

  private checkAbort(options: FsOptions, syscall: string, path: string): void {
    if (options.signal?.aborted) fail("ECANCELED", syscall, path);
  }

  private requestOptions(options: FsOptions): S3RequestOptions {
    return options.signal === undefined ? {} : { abortSignal: options.signal };
  }

  private async call<Result>(syscall: string, path: string, options: FsOptions, action: () => Promise<Result>, precondition?: ErrnoCode): Promise<Result> {
    this.checkAbort(options, syscall, path);
    let onAbort: (() => void) | undefined;
    try {
      const pending = action();
      const result = options.signal ? await new Promise<Result>((resolve, reject) => {
        const signal = options.signal!;
        onAbort = () => reject(new FsError("ECANCELED", { syscall, path, cause: signal.reason }));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        pending.then(value => {
          if (signal.aborted && typeof value === "object" && value !== null && "Body" in value) this.dispose(value.Body);
          resolve(value);
        }, reject);
      }) : await pending;
      this.checkAbort(options, syscall, path);
      return result;
    } catch (error) {
      if (options.signal?.aborted) fail("ECANCELED", syscall, path);
      throw translate(error, syscall, path, precondition);
    } finally {
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private writable(path: string, mode?: number): void {
    if (this.capabilities.readOnly) fail("EROFS", "write", path);
    if (mode !== undefined) validateLimit(mode, "mode", 0, 0o7777);
  }

  private unsupported(operation: string, path: string): never {
    return fail("ENOTSUP", operation, path, `S3 does not support ${operation} with the configured transport`);
  }

  private async head(key: string, path: string, options: FsOptions): Promise<S3HeadOutput | undefined> {
    try {
      const input = { Bucket: this.bucket, Key: key };
      return await this.call("headObject", path, options, () => queryS3Head(input, () => this.transport.headObject(input, this.requestOptions(options))));
    } catch (error) {
      if (isFsError(error, "ENOENT") && serviceCode(error.cause) !== "NoSuchBucket") return undefined;
      throw error;
    }
  }

  private makeStat(type: "file" | "directory", metadata?: S3HeadOutput): FileStat {
    const size = type === "directory" ? 0 : metadata?.ContentLength;
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) fail("EIO", "stat", "", "transport omitted a valid object ContentLength");
    const modified = metadata?.LastModified?.getTime() ?? 0;
    if (!Number.isFinite(modified)) fail("EIO", "stat", "", "transport returned an invalid LastModified");
    const timestamp = (key: string, fallback: number): number => {
      const value = metadata?.Metadata?.[key];
      if (value === undefined) return fallback;
      const parsed = Number(value);
      if (!value || !Number.isFinite(parsed)) fail("EIO", "stat", "", "invalid virtual timestamp metadata");
      return parsed;
    };
    const storedMode = metadata?.Metadata?.["virtual-bash-mode"];
    const mode = storedMode === undefined ? (type === "directory" ? 0o755 : 0o644) : Number(storedMode);
    if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777 || storedMode === "") fail("EIO", "stat", "", "invalid virtual mode metadata");
    return { type, size, mode: (type === "directory" ? 0o40000 : 0o100000) | mode,
      mtimeMs: timestamp("virtual-bash-mtime", modified), atimeMs: timestamp("virtual-bash-atime", 0), ctimeMs: modified };
  }

  private async page(prefix: string, path: string, options: FsOptions, delimiter?: string, token?: string, maxKeys = this.pageSize): Promise<S3ListOutput> {
    const result = await this.call("listObjectsV2", path, options, () => this.transport.listObjectsV2({
      Bucket: this.bucket, Prefix: prefix, MaxKeys: maxKeys,
      ...(delimiter === undefined ? {} : { Delimiter: delimiter }),
      ...(token === undefined ? {} : { ContinuationToken: token }),
    }, this.requestOptions(options)));
    for (const item of result.Contents ?? []) {
      if (typeof item.Key !== "string" || !item.Key.startsWith(prefix)) fail("EIO", "listObjectsV2", path, "transport returned an object outside the requested prefix");
      this.validateObject(item, path);
    }
    for (const item of result.CommonPrefixes ?? []) {
      if (delimiter === undefined || typeof item.Prefix !== "string" || !item.Prefix.startsWith(prefix)
        || !item.Prefix.endsWith("/") || item.Prefix === prefix) fail("EIO", "listObjectsV2", path, "invalid common prefix");
      this.validateKey(item.Prefix, path);
    }
    if (result.IsTruncated !== undefined && typeof result.IsTruncated !== "boolean") fail("EIO", "listObjectsV2", path, "invalid IsTruncated flag");
    return result;
  }

  private validateKey(key: string, path: string): void {
    if (!key.startsWith(this.prefix)) fail("EIO", "listObjectsV2", path, "key escapes the configured prefix");
    const relative = key.slice(this.prefix.length).replace(/\/$/, "");
    if (!isWellFormed(key) || key.includes("\0") || Buffer.byteLength(key) > 1024
      || (relative !== "" && relative.split("/").some((part) => !part || part === "." || part === ".."))) {
      fail("ENOTSUP", "listObjectsV2", path, "object key cannot be represented as a canonical filesystem path");
    }
  }

  private validateObject(object: S3ObjectSummary, path: string): void {
    const key = object.Key!;
    this.validateKey(key, path);
    if (object.Size === undefined || !Number.isSafeInteger(object.Size) || object.Size < 0) fail("EIO", "listObjectsV2", path, "invalid object size");
    if (key.endsWith("/") && object.Size !== 0) fail("ENOTSUP", "listObjectsV2", path, "nonempty slash-suffixed objects cannot be treated as directories");
  }

  private async *pages(prefix: string, path: string, options: FsOptions, delimiter?: string, maxKeys = this.pageSize): AsyncGenerator<S3ListOutput> {
    const tokens = new Set<string>();
    let token: string | undefined;
    let entries = 0;
    do {
      const page = await this.page(prefix, path, options, delimiter, token, maxKeys);
      entries += (page.Contents?.length ?? 0) + (page.CommonPrefixes?.length ?? 0);
      if (entries > this.maxListEntries || tokens.size >= this.maxListEntries) fail("EFBIG", "listObjectsV2", path, "listing exceeds maxListEntries");
      yield page;
      if (!page.IsTruncated) return;
      token = page.NextContinuationToken;
      if (typeof token !== "string" || !token || tokens.has(token)) fail("EIO", "listObjectsV2", path, "missing or repeated continuation token");
      tokens.add(token);
    } while (true);
  }

  private async inspect(path: string, options: FsOptions): Promise<NodeInfo | undefined> {
    if (path === "/") {
      const listing = await this.page(this.prefix, path, options, undefined, undefined, 1);
      const marker = this.prefix && listing.Contents?.some(object => object.Key === this.prefix)
        ? await this.head(this.prefix, path, options) : undefined;
      if (marker && marker.ContentLength !== 0) this.unsupported("nonempty directory markers", path);
      return { stat: this.makeStat("directory", marker), ...(marker ? { metadata: marker } : {}) };
    }
    const file = await this.head(this.key(path), path, options);
    if (Buffer.byteLength(this.key(path)) === 1024) {
      return file ? { stat: this.makeStat("file", file), metadata: file } : undefined;
    }
    const directoryKey = this.directoryKey(path);
    const marker = await this.head(directoryKey, path, options);
    if (marker && marker.ContentLength !== 0) this.unsupported("nonempty directory markers", path);
    let directory = marker !== undefined;
    if (!directory) {
      for await (const children of this.pages(directoryKey, path, options, undefined, 1)) {
        if ((children.Contents?.length ?? 0) > 0) {
          directory = true;
          break;
        }
      }
    }
    if (file && directory) this.unsupported("file/prefix collisions", path);
    if (file) return { stat: this.makeStat("file", file), metadata: file };
    if (directory) return { stat: this.makeStat("directory", marker), ...(marker ? { metadata: marker } : {}) };
    return undefined;
  }

  private async lookup(path: string, options: FsOptions): Promise<NodeInfo | undefined> {
    const ancestors: string[] = [];
    for (let parent = posix.dirname(path); path !== "/"; parent = posix.dirname(parent)) {
      ancestors.unshift(parent);
      if (parent === "/") break;
    }
    for (const parent of ancestors) {
      const ancestor = await this.inspect(parent, options);
      if (!ancestor) fail("ENOENT", "stat", parent);
      if (ancestor.stat.type !== "directory") fail("ENOTDIR", "stat", parent);
    }
    return this.inspect(path, options);
  }

  private requireDirectorySuffix(input: string, info: NodeInfo | undefined): void {
    if (input.endsWith("/") && info?.stat.type === "file") fail("ENOTDIR", "stat", input);
  }

  async stat(input: string, options: FsOptions = {}): Promise<FileStat> {
    const path = this.path(input);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (!info) fail("ENOENT", "stat", input);
    recordS3Stat(this, path, info.stat, info.metadata);
    return info.stat;
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.stat(path, options);
  }

  private async body(output: S3GetOutput, path: string, options: ReadFileOptions): Promise<Uint8Array> {
    const limit = Math.min(this.maxReadBytes, validateLimit(options.maxBytes ?? this.maxReadBytes, "maxBytes", 0));
    return this.call("readFile", path, options, async () => {
      if (output.ContentLength !== undefined && output.ContentLength > limit) fail("EFBIG", "readFile", path);
      const body = output.Body;
      if (!body) fail("EIO", "readFile", path, "transport omitted the response body");
      let bytes: Uint8Array;
      if (body instanceof Uint8Array) {
        if (body.byteLength > limit) fail("EFBIG", "readFile", path);
        bytes = new Uint8Array(body);
      } else if (Symbol.asyncIterator in body) {
        bytes = await collectBytes(body, { maxBytes: limit, ...(options.signal ? { signal: options.signal } : {}) });
      } else if ("transformToByteArray" in body) {
        const converted = await body.transformToByteArray();
        if (!(converted instanceof Uint8Array)) fail("EIO", "readFile", path, "transport body is not binary");
        if (converted.byteLength > limit) fail("EFBIG", "readFile", path);
        bytes = new Uint8Array(converted);
      } else fail("EIO", "readFile", path, "unsupported response body");
      this.checkAbort(options, "readFile", path);
      if (output.ContentLength !== undefined && output.ContentLength !== bytes.byteLength) fail("EIO", "readFile", path, "response body length does not match ContentLength");
      return bytes;
    }).catch((error: unknown) => {
      this.dispose(output.Body);
      throw error;
    });
  }

  private async get(path: string, options: FsOptions): Promise<S3GetOutput> {
    return this.call("getObject", path, options, () => this.transport.getObject({ Bucket: this.bucket, Key: this.key(path) }, this.requestOptions(options)));
  }

  async readFile(input: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    const path = this.path(input);
    validateLimit(options.maxBytes ?? this.maxReadBytes, "maxBytes", 0);
    const info = await this.stat(input, options);
    if (info.type === "directory") fail("EISDIR", "readFile", path);
    if (info.size > Math.min(this.maxReadBytes, options.maxBytes ?? this.maxReadBytes)) fail("EFBIG", "readFile", path);
    return this.body(await this.get(path, options), path, options);
  }

  private etag(metadata: S3HeadOutput | undefined, path: string): string {
    if (!metadata?.ETag) this.unsupported("conditional mutation without an ETag", path);
    return metadata.ETag;
  }

  async writeFile(input: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path, options.mode);
    if (!(data instanceof Uint8Array)) fail("EINVAL", "writeFile", path, "data must be Uint8Array");
    const bytes = new Uint8Array(data);
    if (bytes.byteLength > 5_000_000_000) fail("EFBIG", "writeFile", path, "multipart upload is not supported");
    const flag = options.flag ?? "w";
    if (!["w", "wx", "a", "ax"].includes(flag)) fail("EINVAL", "writeFile", path, "invalid write flag");
    if (flag !== "w" && !this.transport.capabilities?.conditionalPut) this.unsupported("conditional writes", path);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (info?.stat.type === "directory") fail("EISDIR", "writeFile", path);
    if (input.endsWith("/")) fail("EISDIR", "writeFile", input);
    const exclusive = flag === "wx" || flag === "ax";
    if (exclusive && info) fail("EEXIST", "writeFile", path);
    let body = bytes;
    let match: string | undefined;
    let metadata: Record<string, string> | undefined = this.writeMetadata(info?.metadata, options.mode);
    if (flag === "a" && info) {
      const current = await this.get(path, options);
      const previous = await this.body(current, path, options);
      match = this.etag(current, path);
      metadata = { ...current.Metadata };
      delete metadata["virtual-bash-mtime"];
      if (previous.length + bytes.length > this.maxReadBytes) fail("EFBIG", "appendFile", path);
      body = new Uint8Array(previous.length + bytes.length);
      body.set(previous);
      body.set(bytes, previous.length);
    }
    await this.call("putObject", path, options, () => this.transport.putObject({
      Bucket: this.bucket, Key: this.key(path), Body: body,
      ...(match === undefined ? {} : { IfMatch: match }),
      ...(exclusive || (flag === "a" && !info) ? { IfNoneMatch: "*" as const } : {}),
      ...(metadata === undefined ? {} : { Metadata: metadata }),
    }, this.requestOptions(options)), exclusive ? "EEXIST" : "EAGAIN");
  }

  private writeMetadata(previous: S3HeadOutput | undefined, mode?: number): Record<string, string> | undefined {
    const metadata = { ...previous?.Metadata };
    delete metadata["virtual-bash-mtime"];
    if (previous === undefined && mode !== undefined) metadata["virtual-bash-mode"] = String(mode);
    return Object.keys(metadata).length === 0 ? undefined : metadata;
  }

  async appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    return this.writeFile(path, data, { ...options, flag: "a" });
  }

  async mkdir(input: string, options: MkdirOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path, options.mode);
    if (options.recursive && path !== "/") {
      await this.mkdir(posix.dirname(path), { ...options, recursive: true });
    }
    const info = await this.lookup(path, options);
    if (info) {
      if (options.recursive && info.stat.type === "directory") return;
      fail("EEXIST", "mkdir", path);
    }
    await this.call("putObject", path, options, () => this.transport.putObject({
      Bucket: this.bucket, Key: this.directoryKey(path), Body: new Uint8Array(),
      ...(options.mode === undefined ? {} : { Metadata: { "virtual-bash-mode": String(options.mode) } }),
      ...(this.transport.capabilities?.conditionalPut ? { IfNoneMatch: "*" as const } : {}),
    }, this.requestOptions(options)), "EEXIST");
  }

  async readdir(input: string, options: FsOptions = {}): Promise<DirectoryEntry[]> {
    const path = this.path(input);
    if ((await this.stat(input, options)).type !== "directory") fail("ENOTDIR", "readdir", path);
    const prefix = this.directoryKey(path);
    const entries = new Map<string, DirectoryEntry>();
    const add = (name: string, type: "file" | "directory"): void => {
      if (!name || name.includes("/")) fail("EIO", "readdir", path, "invalid direct child in delimited listing");
      const existing = entries.get(name);
      if (existing && existing.type !== type) this.unsupported("file/prefix collisions", path);
      entries.set(name, { name, type });
    };
    for await (const page of this.pages(prefix, path, options, "/")) {
      for (const item of page.Contents ?? []) {
        if (item.Key === prefix) continue;
        add(item.Key!.slice(prefix.length), "file");
      }
      for (const item of page.CommonPrefixes ?? []) add(item.Prefix!.slice(prefix.length, -1), "directory");
    }
    return [...entries.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  }

  private async tree(path: string, options: FsOptions): Promise<S3ObjectSummary[]> {
    const objects = new Map<string, S3ObjectSummary>();
    for await (const page of this.pages(this.directoryKey(path), path, options)) {
      for (const item of page.Contents ?? []) objects.set(item.Key!, item);
    }
    for (const key of objects.keys()) {
      const withoutSlash = key.replace(/\/$/, "");
      if (key.endsWith("/") && objects.has(withoutSlash)) this.unsupported("file/prefix collisions", path);
      let parent = posix.dirname(withoutSlash);
      while (parent !== "." && parent !== "/") {
        if (objects.has(parent)) this.unsupported("file/prefix collisions", path);
        parent = posix.dirname(parent);
      }
    }
    return [...objects.values()];
  }

  async rmdir(input: string, options: FsOptions = {}): Promise<void> {
    try {
      const path = this.path(input);
      this.checkAbort(options, "rmdir", input);
      this.writable(path);
      if (path === "/") fail("EBUSY", "rmdir", input, "cannot remove the mounted root");
      const info = await this.lookup(path, options);
      this.checkAbort(options, "rmdir", input);
      if (!info) fail("ENOENT", "rmdir", input);
      if (info.stat.type !== "directory") fail("ENOTDIR", "rmdir", input);
      const prefix = this.directoryKey(path);
      for await (const page of this.pages(prefix, path, options, "/")) {
        this.checkAbort(options, "rmdir", input);
        if (page.Contents?.some(item => item.Key !== prefix) || page.CommonPrefixes?.length) {
          fail("ENOTEMPTY", "rmdir", input);
        }
      }
      this.checkAbort(options, "rmdir", input);
      fail("ENOTSUP", "rmdir", input, "S3 object deletion cannot atomically require an empty directory prefix");
    } catch (error) {
      if (isFsError(error) && (error.syscall !== "rmdir" || error.path !== input)) {
        throw new FsError(error.code, { syscall: "rmdir", path: input, cause: error });
      }
      throw error;
    }
  }

  async rm(input: string, options: RemoveOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path);
    if (path === "/") fail("EBUSY", "rm", path, "cannot remove the mounted root");
    let info: NodeInfo | undefined;
    try {
      info = await this.lookup(path, options);
    } catch (error) {
      if (options.force && isFsError(error, "ENOENT") && serviceCode(error.cause) !== "NoSuchBucket") return;
      throw error;
    }
    this.requireDirectorySuffix(input, info);
    if (!info) {
      if (options.force) return;
      fail("ENOENT", "rm", path);
    }
    const objects = info.stat.type === "directory" ? await this.tree(path, options) : [{ Key: this.key(path) }];
    if (info.stat.type === "directory" && !options.recursive && objects.some((item) => item.Key !== this.directoryKey(path))) fail("ENOTEMPTY", "rm", path);
    for (const item of objects) {
      await this.call("deleteObject", path, options, () => this.transport.deleteObject({ Bucket: this.bucket, Key: item.Key! }, this.requestOptions(options)));
    }
  }

  private async copy(sourceKey: string, destinationKey: string, source: string, metadata: S3HeadOutput, options: CopyFileOptions, destination?: S3HeadOutput | null): Promise<void> {
    if (metadata.ContentLength === undefined || metadata.ContentLength > 5_000_000_000) this.unsupported("multipart copy", source);
    const etag = this.etag(metadata, source);
    const result = await this.call("copyObject", source, options, () => this.transport.copyObject({
      Bucket: this.bucket, Key: destinationKey, CopySource: encodeCopySource(this.bucket, sourceKey),
      CopySourceIfMatch: etag, MetadataDirective: "COPY",
      ...(options.exclusive ? { IfNoneMatch: "*" as const } : {}),
      ...(destination === undefined ? {} : destination === null ? { IfNoneMatch: "*" as const } : { IfMatch: this.etag(destination, source) }),
    }, this.requestOptions(options)));
    if (!result.CopyObjectResult?.ETag) fail("EIO", "copyObject", source, "transport did not confirm a completed CopyObject result");
  }

  async copyFile(sourceInput: string, destinationInput: string, options: CopyFileOptions = {}): Promise<void> {
    const source = this.path(sourceInput);
    const destination = this.path(destinationInput);
    this.writable(destination);
    if (options.exclusive && !this.transport.capabilities?.conditionalCopy) this.unsupported("exclusive server-side copy", destination);
    const origin = await this.lookup(source, options);
    this.requireDirectorySuffix(sourceInput, origin);
    if (!origin) fail("ENOENT", "copyFile", source);
    if (origin.stat.type === "directory") fail("EISDIR", "copyFile", source);
    const target = await this.lookup(destination, options);
    this.requireDirectorySuffix(destinationInput, target);
    if (target?.stat.type === "directory" || destinationInput.endsWith("/")) fail("EISDIR", "copyFile", destination);
    if (target && options.exclusive) fail("EEXIST", "copyFile", destination);
    if (source === destination) return;
    try {
      await this.copy(this.key(source), this.key(destination), source, origin.metadata!, options);
    } catch (error) {
      if (!options.exclusive || !isFsError(error, "EAGAIN")) throw error;
      const status = (error.cause as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
      if (serviceCode(error.cause) !== "PreconditionFailed" && status !== 412) throw error;
      let destinationExists = false;
      try {
        const currentSource = await this.head(this.key(source), source, options);
        if (currentSource?.ETag === origin.metadata?.ETag) {
          destinationExists = await this.head(this.key(destination), destination, options) !== undefined;
        }
      } catch (diagnosticError) {
        if (isFsError(diagnosticError, "ECANCELED")) throw diagnosticError;
      }
      if (destinationExists) {
        throw new FsError("EEXIST", { syscall: "copyFile", path: source, dest: destination, cause: error });
      }
      throw error;
    }
  }

  async rename(sourceInput: string, destinationInput: string, options: FsOptions = {}): Promise<void> {
    const source = this.path(sourceInput);
    const destination = this.path(destinationInput);
    this.writable(destination);
    if (!this.allowRename) this.unsupported("atomic rename; explicitly enable allowNonAtomicRename for copy/delete semantics", source);
    if (!this.transport.capabilities?.conditionalDelete) this.unsupported("rename without conditional delete", source);
    const conditionalCopy = this.transport.capabilities?.conditionalCopy === true;
    if (!conditionalCopy && this.transport.capabilities?.conditionalPut !== true) {
      this.unsupported("rename requires conditional destination copy or conditional PUT, plus conditional delete", source);
    }
    const streamFallback = this.capabilities.streamingRead && this.capabilities.streamingWrite;
    if (source === "/" || destination === "/") fail("EBUSY", "rename", source);
    const origin = await this.lookup(source, options);
    this.requireDirectorySuffix(sourceInput, origin);
    if (!origin) fail("ENOENT", "rename", source);
    if (source === destination) {
      this.requireDirectorySuffix(destinationInput, origin);
      return;
    }
    if (destination.startsWith(`${source}/`)) fail("EINVAL", "rename", destination, "cannot move a path into itself");
    const target = await this.lookup(destination, options);
    this.requireDirectorySuffix(destinationInput, target);
    if (destinationInput.endsWith("/") && origin.stat.type !== "directory") fail("ENOTDIR", "rename", destination);
    if (target && target.stat.type !== origin.stat.type) fail(target.stat.type === "directory" ? "EISDIR" : "ENOTDIR", "rename", destination);
    if (target?.stat.type === "directory" && (await this.readdir(destination, options)).length > 0) fail("ENOTEMPTY", "rename", destination);
    if (target?.metadata) this.etag(target.metadata, destination);
    const objects = origin.stat.type === "directory" ? await this.tree(source, options) : [{
      Key: this.key(source), Size: origin.stat.size, ETag: origin.metadata?.ETag,
    }];
    for (const object of objects) {
      this.etag({ ETag: object.ETag }, source);
      if (object.Size === undefined || object.Size > 5_000_000_000) this.unsupported("multipart copy", source);
      if (!conditionalCopy && object.Size > (streamFallback ? this.maxStreamBytes : this.maxReadBytes)) {
        fail("EFBIG", "rename", source, "conditional PUT fallback exceeds its configured transfer or buffered read limit");
      }
      if (Buffer.byteLength(this.key(destination) + object.Key!.slice(this.key(source).length)) > 1024) fail("ENAMETOOLONG", "rename", destination);
    }
    const copied: string[] = [];
    const deleted: string[] = [];
    let phase: "copy" | "delete" = "copy";
    try {
      for (const object of objects) {
        const destinationKey = this.key(destination) + object.Key!.slice(this.key(source).length);
        const destinationMetadata = origin.stat.type === "file" || object.Key === this.directoryKey(source) ? target?.metadata ?? null : null;
        const metadata = { ContentLength: object.Size, ETag: object.ETag };
        if (conditionalCopy) await this.copy(object.Key!, destinationKey, source, metadata, options, destinationMetadata);
        else await this.copyWithPut(object.Key!, destinationKey, source, metadata, destinationMetadata, options, streamFallback);
        copied.push(destinationKey);
      }
      phase = "delete";
      for (const object of objects) {
        await this.call("deleteObject", source, options, () => this.transport.deleteObject({
          Bucket: this.bucket, Key: object.Key!, IfMatch: object.ETag!,
        }, this.requestOptions(options)));
        deleted.push(object.Key!);
      }
    } catch (error) {
      throw new S3RenameError(source, destination, phase, copied, deleted, translate(error, "rename", source));
    }
  }

  private async copyWithPut(sourceKey: string, destinationKey: string, source: string, expected: S3HeadOutput,
    destination: S3HeadOutput | null, options: FsOptions, streaming: boolean): Promise<void> {
    const etag = this.etag(expected, source);
    const condition = destination === null ? { IfNoneMatch: "*" as const } : { IfMatch: this.etag(destination, destinationKey) };
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const operationOptions = { signal };
    let output: S3GetOutput | undefined;
    let upload: AsyncGenerator<Uint8Array> | undefined;
    let reading = false;
    try {
      output = await this.call("getObject", source, operationOptions, () => streaming
        ? this.transport.getObjectStream!({ Bucket: this.bucket, Key: sourceKey, IfMatch: etag }, { abortSignal: signal })
        : this.transport.getObject({ Bucket: this.bucket, Key: sourceKey }, { abortSignal: signal }));
      if (this.etag(output, source) !== etag) fail("EAGAIN", "rename", source, "source changed before conditional PUT copy");
      if (output.ContentLength !== undefined && output.ContentLength !== expected.ContentLength) {
        fail("EIO", "rename", source, "source response length differs from the enumerated object");
      }
      const input = { Bucket: this.bucket, Key: destinationKey, ...condition,
        ...(output.Metadata === undefined ? {} : { Metadata: { ...output.Metadata } }) };
      if (!streaming) {
        const body = await this.body(output, source, operationOptions);
        if (body.length !== expected.ContentLength) fail("EIO", "rename", source, "source body length differs from the enumerated object");
        await this.call("putObject", source, operationOptions, () => this.transport.putObject({ ...input, Body: body }, { abortSignal: signal }));
        return;
      }
      const body = output.Body;
      if (!body || !(Symbol.asyncIterator in body)) fail("EIO", "rename", source, "streaming transport did not return an async binary body");
      let finished = false;
      upload = (async function* () {
        let count = 0;
        reading = true;
        for await (const chunk of readBytes(body, signal)) {
          if (chunk.length > expected.ContentLength! - count) fail("EIO", "rename", source, "source body exceeds its enumerated length");
          count += chunk.length;
          for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
            signal.throwIfAborted();
            yield new Uint8Array(chunk.subarray(offset, offset + 64 * 1024));
          }
        }
        if (count !== expected.ContentLength) fail("EIO", "rename", source, "incomplete source body");
        finished = true;
      })();
      await this.call("putObject", source, operationOptions, () => this.transport.putObjectStream!({ ...input, Body: upload! }, { abortSignal: signal }));
      if (!finished) fail("EIO", "rename", source, "transport completed without consuming the conditional copy body");
    } finally {
      controller.abort();
      this.dispose(upload);
      this.dispose(output?.Body, !reading);
    }
  }

  async realpath(input: string, options: FsOptions = {}): Promise<string> {
    await this.stat(input, options);
    return this.path(input);
  }

  async access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) fail("EINVAL", "access", path);
    const info = await this.stat(path, options);
    if ((mode & 2) !== 0 && this.capabilities.readOnly) fail("EROFS", "access", path);
    if ((mode & 1) !== 0 && info.type !== "directory") fail("EACCES", "access", path);
  }

  async readlink(path: string): Promise<string> { return this.unsupported("readlink", path); }
  async symlink(_target: string, path: string): Promise<void> { this.unsupported("symlink", path); }
  async link(_existingPath: string, path: string): Promise<void> { this.unsupported("link", path); }
  async chmod(path: string, _mode: number): Promise<void> { this.unsupported("chmod", path); }

  async utimes(input: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path);
    if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs)) fail("EINVAL", "utimes", path);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (!info) fail("ENOENT", "utimes", path);
    if (!this.capabilities.timestamps) this.unsupported("conditional metadata mutation", path);
    const key = info.stat.type === "directory" ? this.directoryKey(path) : this.key(path);
    if (!key) this.unsupported("timestamps on an unprefixed bucket root", path);
    const metadata = { ...info.metadata?.Metadata,
      "virtual-bash-atime": String(atimeMs), "virtual-bash-mtime": String(mtimeMs) };
    if (!info.metadata) {
      if (!this.transport.capabilities?.conditionalPut) this.unsupported("conditional directory marker creation", path);
      await this.call("utimes", path, options, () => this.transport.putObject({
        Bucket: this.bucket, Key: key, Body: new Uint8Array(), Metadata: metadata, IfNoneMatch: "*",
      }, this.requestOptions(options)));
      return;
    }
    if (!this.transport.capabilities?.conditionalCopy) {
      const current = await this.call("getObject", path, options, () => this.transport.getObject({
        Bucket: this.bucket, Key: key,
      }, this.requestOptions(options)));
      const body = await this.body(current, path, options);
      await this.call("utimes", path, options, () => this.transport.putObject({
        Bucket: this.bucket, Key: key, Body: body, IfMatch: this.etag(current, path),
        Metadata: { ...current.Metadata, "virtual-bash-atime": String(atimeMs), "virtual-bash-mtime": String(mtimeMs) },
      }, this.requestOptions(options)));
      return;
    }
    if (info.stat.size > 5_000_000_000) this.unsupported("multipart metadata copy", path);
    const etag = this.etag(info.metadata, path);
    const result = await this.call("utimes", path, options, () => this.transport.copyObject({
      Bucket: this.bucket, Key: key, CopySource: encodeCopySource(this.bucket, key),
      CopySourceIfMatch: etag, IfMatch: etag, MetadataDirective: "REPLACE", Metadata: metadata,
    }, this.requestOptions(options)));
    if (!result.CopyObjectResult?.ETag) fail("EIO", "utimes", path, "transport did not confirm a completed metadata copy");
  }

  async truncate(input: string, length = 0, options: FsOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path);
    validateLimit(length, "length", 0);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (!info) fail("ENOENT", "truncate", path);
    if (info.stat.type === "directory") fail("EISDIR", "truncate", path);
    if (!this.transport.capabilities?.conditionalPut) this.unsupported("conditional truncate", path);
    if (length > this.maxReadBytes) fail("EFBIG", "truncate", path);
    let current = info.metadata!;
    const body = new Uint8Array(length);
    if (length !== 0 && info.stat.size !== 0) {
      if (this.readStream) {
        const previous = await this.call("truncate", path, options, () => collectBytes(this.readStream!(input, { ...options, endExclusive: Math.min(length, info.stat.size) }), { ...options, maxBytes: length }));
        body.set(previous);
      } else {
        const output = await this.get(path, options);
        const previous = await this.body(output, path, options);
        current = output;
        body.set(previous.subarray(0, length));
      }
    }
    const metadata = { ...current.Metadata };
    delete metadata["virtual-bash-mtime"];
    await this.call("truncate", path, options, () => this.transport.putObject({
      Bucket: this.bucket, Key: this.key(path), Body: body, IfMatch: this.etag(current, path), Metadata: metadata,
    }, this.requestOptions(options)));
  }

  private async *streamRead(input: string, options: ReadStreamOptions = {}): ByteSource {
    const path = this.path(input);
    const start = validateLimit(options.start ?? 0, "start", 0);
    const end = options.endExclusive === undefined ? undefined : validateLimit(options.endExclusive, "endExclusive", start);
    const chunkSize = validateLimit(options.chunkSize ?? 64 * 1024, "chunkSize", 1);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (!info) fail("ENOENT", "readStream", path);
    if (info.stat.type === "directory") fail("EISDIR", "readStream", path);
    const stop = Math.min(end ?? info.stat.size, info.stat.size);
    const expected = Math.max(0, stop - start);
    if (expected > this.maxStreamBytes) fail("EFBIG", "readStream", path);
    if (expected === 0 && info.stat.size !== 0) return;
    let count = 0;
    let finished = false;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let output: S3StreamGetOutput | undefined;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    try {
      output = await this.call("getObject", path, options, () => this.transport.getObjectStream!({
        Bucket: this.bucket, Key: this.key(path), IfMatch: this.etag(info.metadata, path),
        ...(expected === 0 || (start === 0 && stop === info.stat.size) ? {} : { Range: `bytes=${start}-${stop - 1}` }),
      }, { abortSignal: signal }));
      if (output.ETag !== undefined && output.ETag !== info.metadata?.ETag) fail("EIO", "readStream", path, "response ETag differs from requested snapshot");
      if (output.ContentLength !== undefined && output.ContentLength !== expected) fail("EIO", "readStream", path, "response length differs from requested snapshot");
      iterator = readBytes(output.Body, signal)[Symbol.asyncIterator]();
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        const chunk = result.value;
        if (chunk.length > expected - count) fail("EIO", "readStream", path, "response exceeds requested length");
        count += chunk.length;
        for (let offset = 0; offset < chunk.length; offset += chunkSize) {
          this.checkAbort(options, "readStream", path);
          yield new Uint8Array(chunk.subarray(offset, offset + chunkSize));
        }
      }
      if (count !== expected) fail("EIO", "readStream", path, "incomplete response body");
      finished = true;
    } catch (error) {
      this.checkAbort(options, "readStream", path);
      throw translate(error, "readStream", path);
    } finally {
      controller.abort();
      if (!finished && output) {
        this.dispose(iterator);
        this.dispose(output.Body, iterator === undefined);
      }
    }
  }

  private dispose(body: unknown, returnIterator = true): void {
    const disposable = body as { destroy?: () => void; cancel?: () => unknown; return?: () => unknown } | undefined;
    try {
      const result = typeof disposable?.destroy === "function" ? disposable.destroy()
        : typeof disposable?.cancel === "function" ? disposable.cancel() : returnIterator ? disposable?.return?.() : undefined;
      void Promise.resolve(result).catch(() => {});
    } catch {}
  }

  private async streamWrite(input: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    const path = this.path(input);
    this.writable(path, options.mode);
    const flag = options.flag ?? "w";
    if (!["w", "wx", "a", "ax"].includes(flag)) fail("EINVAL", "writeStream", path);
    if (flag !== "w" && !this.transport.capabilities?.conditionalPut) this.unsupported("conditional writes", path);
    const info = await this.lookup(path, options);
    this.requireDirectorySuffix(input, info);
    if (info?.stat.type === "directory" || input.endsWith("/")) fail("EISDIR", "writeStream", path);
    const exclusive = flag === "wx" || flag === "ax";
    if (exclusive && info) fail("EEXIST", "writeStream", path);
    if (flag === "a") {
      const current = info ? await this.get(path, options) : undefined;
      const previous = current ? await this.body(current, path, options) : new Uint8Array();
      const limit = Math.min(this.maxReadBytes, this.maxStreamBytes);
      if (previous.length > limit) fail("EFBIG", "writeStream", path);
      const bytes = await this.call("writeStream", path, options, () => collectBytes(source, { maxBytes: limit - previous.length, ...options }));
      const body = new Uint8Array(previous.length + bytes.length);
      body.set(previous);
      body.set(bytes, previous.length);
      const metadata = this.writeMetadata(current, options.mode);
      await this.call("putObject", path, options, () => this.transport.putObject({
        Bucket: this.bucket, Key: this.key(path), Body: body,
        ...(current ? { IfMatch: this.etag(current, path) } : { IfNoneMatch: "*" as const }),
        ...(metadata ? { Metadata: metadata } : {}),
      }, this.requestOptions(options)));
      return;
    }
    const adapter = this;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let finished = false;
    const body = (async function* () {
      let total = 0;
      for await (const chunk of readBytes(source, signal)) {
        if (chunk.length > adapter.maxStreamBytes - total) fail("EFBIG", "writeStream", path);
        total += chunk.length;
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
          adapter.checkAbort({ signal }, "writeStream", path);
          yield new Uint8Array(chunk.subarray(offset, offset + 64 * 1024));
        }
      }
      finished = true;
    })();
    try {
      const metadata = this.writeMetadata(info?.metadata, options.mode);
      await this.call("putObject", path, options, () => this.transport.putObjectStream!({
        Bucket: this.bucket, Key: this.key(path), Body: body, ...(exclusive ? { IfNoneMatch: "*" as const } : {}),
        ...(metadata === undefined ? {} : { Metadata: metadata }),
      }, { abortSignal: signal }), exclusive ? "EEXIST" : "EAGAIN");
      if (!finished) fail("EIO", "writeStream", path, "transport completed without consuming the request body");
    } finally {
      controller.abort();
      this.dispose(body);
    }
  }
}

const s3Comparison = S3FileSystem.prototype.compareEntry;
