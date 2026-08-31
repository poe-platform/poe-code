import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFileSystemOptions, WebDavFetch } from "../../../src/fs/webdav/index.js";
import { MockDav } from "../webdav/mock.js";

export const binary = Uint8Array.from({ length: 4099 }, (_, index) => index % 256);

export function errno(...codes: ErrnoCode[]): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof FsError, `expected FsError, got ${String(error)}`);
    assert.ok(codes.includes(error.code), `expected ${codes.join("|")}, got ${error.code}: ${error.message}`);
    assert.ok(Number.isInteger(error.errno));
    assert.ok(error.errno < 0);
    return true;
  };
}

export function cancellation(signal: AbortSignal): (error: unknown) => boolean {
  return (error) => error === signal.reason || errno("ECANCELED")(error);
}

export function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
}

export async function loopbackDav(context: TestContext, options: Partial<Omit<WebDavFileSystemOptions, "baseUrl" | "fetch">> = {}) {
  const mock = new MockDav();
  const errors: unknown[] = [];
  const handlers = new Set<Promise<void>>();
  const fixture: { intercept?: WebDavFetch } = {};
  const server = createServer((request, response) => {
    const handler = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 2 * 1024 * 1024, "fixture request exceeds bounded body size");
        chunks.push(chunk);
      }
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${request.url}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const init: RequestInit = {
        method: request.method ?? "GET", headers,
        ...(size === 0 ? {} : { body: new Uint8Array(Buffer.concat(chunks)) }),
      };
      const result = await (fixture.intercept ?? mock.fetch)(url, init);
      if (response.destroyed) {
        await result.body?.cancel();
        return;
      }
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.flushHeaders();
      if (result.body) {
        const reader = result.body.getReader();
        try {
          while (!response.destroyed) {
            const next = await reader.read();
            if (next.done) break;
            response.write(next.value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      response.end();
    })().catch((error: unknown) => {
      errors.push(error);
      if (!response.destroyed) {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    handlers.add(handler);
    void handler.then(() => handlers.delete(handler));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await Promise.all(handlers);
    assert.deepEqual(errors, [], "loopback protocol fixture errors");
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/dav/`;
  const fs = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch, ...options });
  return { fs, mock, fixture, baseUrl };
}

export interface AdapterFixture {
  fs: FileSystem;
  root?: string;
}

export const adapters = [
  { name: "memory", async create(): Promise<AdapterFixture> { return { fs: new MemoryFileSystem() }; } },
  { name: "real", async create(context: TestContext): Promise<AdapterFixture> {
    const root = await mkdtemp(join(tmpdir(), "virtual-bash-conformance-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    return { fs: await createRealFileSystem({ root }), root };
  } },
  { name: "s3", async create(): Promise<AdapterFixture> {
    const transport = new MockS3Client({ buckets: ["conformance"], pageSize: 7 });
    return { fs: new S3FileSystem({ transport, bucket: "conformance", prefix: "isolated", pageSize: 11, allowNonAtomicRename: true }) };
  } },
  { name: "webdav", async create(context: TestContext): Promise<AdapterFixture> {
    return loopbackDav(context);
  } },
] as const;

export const sourcePaths = [
  "src/contracts/filesystem.ts", "src/contracts/errors.ts", "src/contracts/io.ts", "src/contracts/path.ts",
  "src/fs/memory/index.ts", "src/fs/real/index.ts", "src/fs/s3/index.ts", "src/fs/s3/http/index.ts",
  "src/fs/webdav/index.ts", "src/integrations/safejs/filesystem.ts", "tests/fs/webdav/mock.ts",
] as const;

export async function sourceState(): Promise<Record<string, string>> {
  const source = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
    path, createHash("sha256").update(await readFile(new URL(`../../../${path}`, import.meta.url))).digest("hex"),
  ])));
  return { ...source, ...await canonicalPeerState(fileURLToPath(new URL("../../../", import.meta.url)), import.meta.resolve("poe-code/safe-fs")) };
}

export async function canonicalPeerState(
  packageRoot: string,
  moduleUrl: string,
  read: (location: string | URL) => Promise<Uint8Array> = readFile,
): Promise<Record<string, string>> {
  let directory = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    let metadata: { name?: string; version?: string; workspaces?: string[]; exports?: Record<string, { import?: string }> } | undefined;
    let metadataBytes: Uint8Array | undefined;
    try {
      metadataBytes = await read(join(directory, "package.json"));
      metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as typeof metadata;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (metadata?.name === "poe-code") {
      const target = metadata.exports?.["./safe-fs"]?.import;
      assert.equal(typeof target, "string", "canonical peer needs its public ESM export");
      assert.equal(resolve(directory, target!), fileURLToPath(moduleUrl), "canonical peer must use its declared public export");
      assert.equal(typeof metadata.version, "string", "canonical peer needs a version");
      const canonical = {
        "canonical:version": metadata.version!,
        "canonical:module-url": moduleUrl,
        "canonical:module-sha256": createHash("sha256").update(await read(new URL(moduleUrl))).digest("hex"),
        "canonical:metadata-sha256": createHash("sha256").update(metadataBytes!).digest("hex"),
      };
      if (resolve(packageRoot) === join(directory, "packages/safe-bash")) {
        assert.ok(metadata.workspaces?.includes("packages/*"), "canonical checkout must declare the Bash workspace");
        assert.equal(target, "./packages/safe-js/dist/safe-fs.js", "canonical checkout must use the shared SafeJS bundle");
        const workspaceBytes = await read(join(packageRoot, "package.json"));
        const workspace = JSON.parse(new TextDecoder().decode(workspaceBytes));
        assert.equal(workspace.name, "virtual-bash");
        assert.equal(workspace.private, true);
        const lockBytes = await read(join(directory, "package-lock.json"));
        const lock = JSON.parse(new TextDecoder().decode(lockBytes));
        assert.equal(lock.packages[""].name, metadata.name, "checkout lock must bind the root package");
        assert.equal(lock.packages[""].version, metadata.version, "checkout lock must bind the current root version");
        assert.equal(lock.packages["packages/safe-bash"].name, workspace.name, "checkout lock must bind the Bash workspace");
        assert.equal(lock.packages["packages/safe-bash"].devDependencies["poe-code"], "file:../..", "checkout peer must be local, not a second registry graph");
        return {
          ...canonical,
          "canonical:profile": "workspace-checkout",
          "canonical:qualification": "local public checkout identity; not published peer-range qualification",
          "canonical:workspace-metadata-sha256": createHash("sha256").update(workspaceBytes).digest("hex"),
          "canonical:workspace-lock-sha256": createHash("sha256").update(lockBytes).digest("hex"),
        };
      }
      const lock = JSON.parse(new TextDecoder().decode(await read(join(packageRoot, "package-lock.json")))) as {
        packages: Record<string, { version?: string; integrity?: string }>;
      };
      const locked = lock.packages["node_modules/poe-code"];
      assert.equal(metadata.version, locked?.version, "installed canonical peer differs from the lockfile");
      assert.equal(typeof locked?.integrity, "string", "canonical peer needs registry integrity");
      assert.match(locked!.integrity!, /^sha512-/u);
      return {
        ...canonical,
        "canonical:profile": "installed-release",
        "canonical:lock-integrity": locked!.integrity!,
      };
    }
    const parent = dirname(directory);
    assert.notEqual(parent, directory, "public canonical module has no installed package metadata");
    directory = parent;
  }
}
