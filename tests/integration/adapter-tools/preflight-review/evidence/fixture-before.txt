import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  agentCommands, createAgentCommands, createByteCommands, createDiffPatchCommands,
  createSearchCommands, createStandardCommands, createStructuredCommands,
  createTextProgramCommands, createRealFileSystem, MemoryFileSystem, MockS3Client,
  FsError, MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem, S3FileSystem, Shell,
  WebDavFileSystem,
  type FileSystem, type ShellExecOptions, type ShellResult,
} from "../../../src/index.js";
import { MockDav } from "../../fs/webdav/mock.js";

export const writableAdapters = ["memory", "real", "s3", "webdav", "mount", "overlay"] as const;
export type AdapterName = typeof writableAdapters[number] | "readonly";
export const payload = Uint8Array.from({ length: 4099 }, (_, index) => index % 256);
export const original = "alpha\nbeta\n";
export const revised = "alpha\nBETA\n";
export const change = "--- target.txt\n+++ target.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA\n";
export const families = {
  standard: createStandardCommands,
  text: createTextProgramCommands,
  structured: createStructuredCommands,
  search: createSearchCommands,
  bytes: createByteCommands,
  diffPatch: createDiffPatchCommands,
};

type Cleanup = () => Promise<void>;

export interface Fixture {
  fs: FileSystem;
  shell: Shell;
  dispatched: string[];
  lower?: FileSystem;
  s3?: MockS3Client;
  dav?: MockDav;
  exec(source: string, options?: ShellExecOptions): Promise<ShellResult>;
}

async function seed(fs: FileSystem, signal: AbortSignal): Promise<void> {
  await fs.mkdir("/work/src", { recursive: true, signal });
  for (const [path, contents] of Object.entries({
    "src/tasks.txt": "TODO alpha 2\nTODO beta 3\nDONE gamma 7\n",
    "old.txt": original,
    "new.txt": revised,
    "target.txt": original,
    "change.diff": change,
    "empty.txt": "",
    "config.json": '{"enabled":true,"names":["alpha","beta"]}\n',
  })) await fs.writeFile(`/work/${path}`, Buffer.from(contents), { signal });
  await fs.writeFile("/work/payload.bin", payload, { signal });
}

function s3Fixture(): { fs: S3FileSystem; s3: MockS3Client } {
  const s3 = new MockS3Client({
    buckets: ["adapter-tools"], pageSize: 2,
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });
  return { fs: new S3FileSystem({ transport: s3, bucket: "adapter-tools", prefix: "isolated", pageSize: 2 }), s3 };
}

async function realFixture(cleanups: Cleanup[]): Promise<FileSystem> {
  const root = await mkdtemp(fileURLToPath(new URL("./.real-", import.meta.url)));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return createRealFileSystem({ root });
}

async function davFixture(cleanups: Cleanup[]): Promise<{ fs: WebDavFileSystem; dav: MockDav }> {
  const dav = new MockDav();
  const handlers = new Set<Promise<void>>();
  const failures: unknown[] = [];
  const server = createServer((request, response) => {
    const handler = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 1024 * 1024, "bounded loopback request body");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const result = await dav.fetch(`${baseUrl.origin}${request.url}`, {
        method: request.method ?? "GET", headers,
        ...(size ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
      });
      const body = new Uint8Array(await result.arrayBuffer());
      assert.ok(body.length <= 1024 * 1024, "bounded loopback response body");
      if (!response.destroyed) {
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(body);
      }
    })().catch((error: unknown) => {
      failures.push(error);
      if (!response.destroyed) {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    handlers.add(handler);
    void handler.then(() => handlers.delete(handler));
  });
  server.requestTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await Promise.all(handlers);
    dav.files.clear();
    dav.locks.clear();
    assert.deepEqual(failures, [], "loopback fixture protocol errors");
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = new URL(`http://127.0.0.1:${address.port}/dav/`);
  const fs = new WebDavFileSystem({
    baseUrl: baseUrl.href, timeoutMs: 3000, maxResponseBytes: 1024 * 1024,
    fetch: (url, init) => {
      assert.equal(new URL(url).origin, baseUrl.origin, "no remote network access");
      return fetch(url, { ...init, redirect: "error" });
    },
  });
  return { fs, dav };
}

export async function withFixture(name: AdapterName, run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const cleanups: Cleanup[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fixture deadline: ${name}`)), 15_000);
  try {
    let fs: FileSystem;
    let lower: FileSystem | undefined;
    let s3: MockS3Client | undefined;
    let dav: MockDav | undefined;
    if (name === "real") fs = await realFixture(cleanups);
    else if (name === "s3") ({ fs, s3 } = s3Fixture());
    else if (name === "webdav") ({ fs, dav } = await davFixture(cleanups));
    else if (name === "mount") {
      const objects = s3Fixture();
      s3 = objects.s3;
      await objects.fs.writeFile("/seed.bin", payload, { signal: controller.signal });
      fs = new MountFileSystem({
        root: new MemoryFileSystem(),
        mounts: { "/work": await realFixture(cleanups), "/objects": objects.fs },
      });
    } else if (name === "overlay") {
      const objects = s3Fixture();
      lower = objects.fs;
      s3 = objects.s3;
      await seed(lower, controller.signal);
      fs = new OverlayFileSystem({ lower, upper: new MemoryFileSystem(), maxBufferBytes: 1024 * 1024 });
    } else fs = new MemoryFileSystem();
    if (name !== "overlay") await seed(fs, controller.signal);
    if (name === "readonly") fs = new ReadOnlyFileSystem(fs);
    const dispatched: string[] = [];
    const shell = new Shell({ fs, cwd: "/work", limits: {
      maxOutputBytes: 1024 * 1024, maxCommands: 150, maxLoopIterations: 100,
      maxSourceBytes: 32 * 1024, pipeHighWaterMark: 1024,
    } }).use(agentCommands()).use(async (context, next) => {
      if (shell.commands.has(context.command)) dispatched.push(context.command);
      return next();
    });
    cleanups.push(() => shell.dispose());
    const exec = (source: string, options: ShellExecOptions = {}) => shell.exec(source, {
      ...options, signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
    });
    await exec(":");
    const expected = Object.values(families).flatMap(factory => factory().map(command => command.name)).sort();
    assert.equal(new Set(expected).size, expected.length, "six families have no colliding names");
    assert.deepEqual(createAgentCommands().map(command => command.name).sort(), expected);
    assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expected);
    await run({ fs, shell, dispatched, exec,
      ...(lower ? { lower } : {}), ...(s3 ? { s3 } : {}), ...(dav ? { dav } : {}),
    });
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("fixture cleanup"));
    const failures: unknown[] = [];
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "fixture cleanup failed");
  }
}

export function success(result: ShellResult, stdout?: string): void {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  if (stdout !== undefined) assert.equal(result.stdout, stdout);
}

export function fsError(code: "ENOENT" | "EROFS", path: string): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof FsError, "filesystem boundary must reject with an actual FsError");
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  };
}

export function allFamiliesDispatched(dispatched: readonly string[]): void {
  for (const [name, factory] of Object.entries(families)) {
    assert.ok(factory().some(command => dispatched.includes(command.name)), `${name} family must actually dispatch`);
  }
  for (const name of ["find", "rg", "sed", "awk", "jq", "sha256sum", "gzip", "diff", "patch"]) {
    assert.ok(dispatched.includes(name), `${name} must dispatch through the aggregate registry`);
  }
}

export async function snapshotTree(fs: FileSystem, root = "/work"): Promise<Record<string, Uint8Array | null>> {
  const snapshot: Record<string, Uint8Array | null> = { [root]: null };
  for (const entry of await fs.readdir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.type === "directory") Object.assign(snapshot, await snapshotTree(fs, path));
    else snapshot[path] = await fs.readFile(path);
  }
  return snapshot;
}
