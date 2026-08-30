import assert from "node:assert/strict";
import native from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FsError, MemoryFileSystem, RealFileSystem, MountFileSystem, OverlayFileSystem,
  ReadOnlyFileSystem, S3FileSystem, MockS3Client, S3ServiceError, WebDavFileSystem,
  type FileSystem, type FsOptions, type RemoveOptions, type ErrnoCode,
} from "../../../../src/index.js";
import { MockDav } from "../../../fs/webdav/mock.js";

export interface Event {
  layer: string;
  operation: string;
  path: string;
  recursive?: boolean;
  signal?: boolean;
  aborted?: boolean;
  code?: string;
  detail?: string;
}

export type Namespace = Record<string, { type: string; hex?: string; target?: string }>;
export type Backend = "memory" | "real" | "mount-memory" | "overlay-isolated" | "overlay-static" | "s3" | "webdav" | "missing" | "readonly";
export const backends: readonly Backend[] = ["memory", "real", "mount-memory", "overlay-isolated", "overlay-static", "s3", "webdav", "missing", "readonly"];
export const supported: readonly Backend[] = ["memory", "real", "mount-memory", "overlay-isolated", "overlay-static"];
export const raceBackends: readonly Backend[] = ["memory", "real", "mount-memory", "overlay-isolated"];
export const binary = Uint8Array.from([0, 255, 128, 10, 13, 1, 254, 65]);
export const seedBytes = new TextEncoder().encode("remove me\n");

export async function namespace(fs: FileSystem, path = "/", result: Namespace = {}): Promise<Namespace> {
  const stat = await fs.lstat(path);
  result[path] = stat.type === "file" ? { type: stat.type, hex: Buffer.from(await fs.readFile(path, { maxBytes: 65536 })).toString("hex") }
    : stat.type === "symlink" ? { type: stat.type, target: await fs.readlink?.(path) ?? "unavailable" } : { type: stat.type };
  if (stat.type === "directory") for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) {
    await namespace(fs, `${path === "/" ? "" : path}/${entry.name}`, result);
  }
  return result;
}

export function traced(base: FileSystem, events: Event[], layer: string, hook?: (path: string, options?: FsOptions) => Promise<void>, missing = false): FileSystem {
  async function call<Result>(operation: string, path: string, options: FsOptions | undefined, work: () => Promise<Result>, recursive?: boolean): Promise<Result> {
    const event: Event = { layer, operation, path, signal: options?.signal !== undefined, aborted: options?.signal?.aborted ?? false, ...(recursive === undefined ? {} : { recursive }) };
    events.push(event);
    try { return await work(); }
    catch (error) { event.code = error instanceof FsError ? error.code : error instanceof Error ? error.name : String(error); throw error; }
  }
  return {
    capabilities: base.capabilities,
    readFile: (path, options) => call("readFile", path, options, () => base.readFile(path, options)),
    writeFile: (path, bytes, options) => call("writeFile", path, options, () => base.writeFile(path, bytes, options)),
    appendFile: (path, bytes, options) => call("appendFile", path, options, () => base.appendFile(path, bytes, options)),
    stat: (path, options) => call("stat", path, options, () => base.stat(path, options)),
    lstat: (path, options) => call("lstat", path, options, () => base.lstat(path, options)),
    readdir: (path, options) => call("readdir", path, options, () => base.readdir(path, options)),
    mkdir: (path, options) => call("mkdir", path, options, () => base.mkdir(path, options)),
    rm: (path: string, options?: RemoveOptions) => call("rm", path, options, () => base.rm(path, options), options?.recursive ?? false),
    ...(!missing && base.rmdir ? { rmdir: (path: string, options?: FsOptions) => call("rmdir", path, options, async () => {
      await hook?.(path, options);
      assert.ok(base.rmdir);
      await base.rmdir(path, options);
    }) } : {}),
    rename: (source, destination, options) => call("rename", source, options, () => base.rename(source, destination, options)),
    copyFile: (source, destination, options) => call("copyFile", source, options, () => base.copyFile(source, destination, options)),
    realpath: (path, options) => call("realpath", path, options, () => base.realpath(path, options)),
    access: (path, mode, options) => call("access", path, options, () => base.access(path, mode, options)),
    ...(base.readlink ? { readlink: base.readlink.bind(base) } : {}),
    ...(base.symlink ? { symlink: base.symlink.bind(base) } : {}),
    ...(base.link ? { link: base.link.bind(base) } : {}),
    ...(base.chmod ? { chmod: base.chmod.bind(base) } : {}),
    ...(base.utimes ? { utimes: base.utimes.bind(base) } : {}),
    ...(base.truncate ? { truncate: base.truncate.bind(base) } : {}),
    ...(base.readStream ? { readStream: base.readStream.bind(base) } : {}),
    ...(base.writeStream ? { writeStream: base.writeStream.bind(base) } : {}),
  };
}

export interface Fixture {
  fs: FileSystem;
  writable: FileSystem;
  cwd: string;
  events: Event[];
  layers: Record<string, FileSystem>;
  hook: ((path: string, options?: FsOptions) => Promise<void>) | undefined;
  entryHook: ((path: string, options?: FsOptions) => Promise<void>) | undefined;
  lowerListingHook: ((path: string) => Promise<void>) | undefined;
  restoreNative: (() => void) | undefined;
  realRoot: string | undefined;
  cleanupRoot: string | undefined;
  remoteFault: "EACCES" | "EIO" | undefined;
  provider: (() => unknown) | undefined;
  close(): Promise<void>;
}

export async function fixture(backend: Backend): Promise<Fixture> {
  const events: Event[] = [];
  const base = new MemoryFileSystem();
  const result: Fixture = {
    fs: base, writable: base, cwd: "/work", events, layers: {}, hook: undefined, entryHook: undefined, lowerListingHook: undefined,
    restoreNative: undefined, realRoot: undefined, cleanupRoot: undefined, remoteFault: undefined, provider: undefined,
    async close() { result.restoreNative?.(); if (result.cleanupRoot) await native.rm(result.cleanupRoot, { recursive: true, force: true }); },
  };
  const boundary = (fs: FileSystem) => traced(fs, events, "empty-only-boundary", (path, options) => result.hook?.(path, options) ?? Promise.resolve());
  if (backend === "real") {
    result.cleanupRoot = await native.realpath(await native.mkdtemp(join(tmpdir(), "safe-bash-pruning-adversarial-")));
    result.realRoot = join(result.cleanupRoot, "root");
    await native.mkdir(result.realRoot);
    await native.mkdir(join(result.cleanupRoot, "outside"));
    await native.writeFile(join(result.cleanupRoot, "outside", "host-sentinel"), binary);
    result.layers.host = new RealFileSystem(result.cleanupRoot);
    result.writable = new RealFileSystem(result.realRoot);
    result.fs = boundary(result.writable);
  } else if (backend === "mount-memory") {
    result.layers.root = new MemoryFileSystem();
    result.layers.mounted = base;
    result.writable = new MountFileSystem({ root: result.layers.root, mounts: { "/volume": boundary(base) } });
    result.fs = result.writable;
    result.cwd = "/volume/work";
  } else if (backend === "overlay-isolated" || backend === "overlay-static") {
    const upper = new MemoryFileSystem();
    result.layers.upper = upper;
    result.layers.lower = base;
    if (backend === "overlay-static") {
      await base.mkdir("/work/branch/leaf", { recursive: true });
      await base.writeFile("/work/branch/leaf/file", seedBytes);
    }
    const lower = traced(base, events, "lower");
    result.writable = new OverlayFileSystem({ upper: boundary(upper), lower: {
      ...lower,
      readdir: async (path, options) => {
        const entries = await lower.readdir(path, options);
        await result.lowerListingHook?.(path);
        return entries;
      },
    } });
    result.fs = result.writable;
  } else if (backend === "s3") {
    const mock = new MockS3Client({ buckets: ["adversarial"], pageSize: 2, now: () => new Date("2026-08-26T00:00:00Z"), authorize: request => {
      events.push({ layer: "s3-transport", operation: request.operation, path: "Key" in request.input ? request.input.Key : request.input.Prefix ?? "" });
      if (result.remoteFault) throw new S3ServiceError(result.remoteFault === "EACCES" ? "AccessDenied" : "InternalError", result.remoteFault === "EACCES" ? 403 : 500);
    } });
    result.writable = new S3FileSystem({ transport: mock, bucket: "adversarial", prefix: "owned", pageSize: 2 });
    result.fs = boundary(result.writable);
    result.provider = () => mock.requests;
    result.layers.provider = new S3FileSystem({ transport: mock, bucket: "adversarial", pageSize: 2 });
    await result.layers.provider.mkdir("/unmounted");
    await result.layers.provider.writeFile("/unmounted/sentinel", binary);
  } else if (backend === "webdav") {
    const mock = new MockDav();
    result.writable = new WebDavFileSystem({ baseUrl: "https://adversarial.invalid/dav/", fetch: async (url, options) => {
      events.push({ layer: "webdav-transport", operation: options.method ?? "GET", path: new URL(url).pathname });
      if (result.remoteFault) return new Response(null, { status: result.remoteFault === "EACCES" ? 403 : 500 });
      return mock.fetch(url, options);
    } });
    result.fs = boundary(result.writable);
    result.provider = () => ({ requests: mock.requests.map(request => ({ method: request.init.method, url: request.url })), namespace: [...mock.files].map(([path, bytes]) => ({ path, hex: bytes === null ? null : Buffer.from(bytes).toString("hex") })) });
  } else {
    result.fs = backend === "readonly" ? new ReadOnlyFileSystem(base) : boundary(base);
  }
  await result.writable.mkdir(`${result.cwd}/branch/leaf`, { recursive: true });
  await result.writable.mkdir("/external", { recursive: true });
  await result.writable.writeFile("/external/sentinel", binary);
  await result.writable.writeFile(`${result.cwd}/keep`, binary);
  if (backend !== "overlay-static") await result.writable.writeFile(`${result.cwd}/branch/leaf/file`, seedBytes);
  result.fs = traced(result.fs, events, "consumer", (path, options) => result.entryHook?.(path, options) ?? Promise.resolve(), backend === "missing");
  events.length = 0;
  return result;
}

export async function snapshots(current: Fixture): Promise<Record<string, Namespace>> {
  const result: Record<string, Namespace> = { visible: await namespace(current.fs) };
  for (const [name, fs] of Object.entries(current.layers)) result[name] = await namespace(fs);
  return result;
}

export function nativeBoundary(current: Fixture, target: string, inject: () => Promise<void>): void {
  assert.ok(current.realRoot);
  const original = native.rmdir;
  const hostTarget = join(current.realRoot, target);
  native.rmdir = async (path, options) => {
    if (String(path) === hostTarget) {
      current.events.push({ layer: "native-empty-only-boundary", operation: "rmdir", path: target });
      await inject();
    }
    return original(path, options);
  };
  syncBuiltinESMExports();
  current.restoreNative = () => { native.rmdir = original; syncBuiltinESMExports(); };
}

export function errno(error: unknown): ErrnoCode | undefined { return error instanceof FsError ? error.code : undefined; }
