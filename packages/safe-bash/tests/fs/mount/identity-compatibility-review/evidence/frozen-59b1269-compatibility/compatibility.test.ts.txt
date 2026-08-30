import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { standardCommands } from "../../../../src/commands/index.js";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../../src/fs/real/index.js";
import { MockS3Client, S3FileSystem } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { MockDav } from "../../webdav/mock.js";

const payload = new Uint8Array([0, 255, 128, 13, 10, 65, 66, 67, 0]);
const previous = new Uint8Array([79, 76, 68, 255]);
const sentinel = new Uint8Array([75, 69, 69, 80]);
type RemoteKind = "s3" | "webdav";
type Action = "copy" | "rename" | "mv";

function opaque<Backend extends object>(backend: Backend): Backend {
  return new Proxy(backend, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function remote(kind: RemoteKind, allowNonAtomicRename = false) {
  if (kind === "s3") {
    const service = new MockS3Client({ buckets: ["compatibility"], now: () => new Date("2026-08-26T12:00:00Z") });
    const firstClient = opaque(service);
    const secondClient = opaque(service);
    assert.notEqual(firstClient, secondClient);
    const make = (transport: typeof service) => new S3FileSystem({
      bucket: "compatibility", prefix: "same-prefix", transport, allowNonAtomicRename,
    });
    return {
      left: make(firstClient), right: make(secondClient),
      trace: () => service.requests.map(request => ({
        operation: request.operation,
        key: "Key" in request.input ? request.input.Key : "",
      })),
    };
  }
  const service = new MockDav();
  const firstClient = { fetch: (url: string, init: RequestInit) => service.fetch(url, init) };
  const secondClient = { fetch: (url: string, init: RequestInit) => service.fetch(url, init) };
  assert.notEqual(firstClient.fetch, secondClient.fetch);
  const make = (client: typeof firstClient) => new WebDavFileSystem({
    baseUrl: "https://compatibility.invalid/dav/", fetch: client.fetch, timeoutMs: 3000,
  });
  return {
    left: make(firstClient), right: make(secondClient),
    trace: () => service.requests.map(request => ({
      operation: request.init.method ?? "", key: new URL(request.url).pathname,
    })),
  };
}

async function bytesAt(filesystem: FileSystem, path: string): Promise<number[] | null> {
  try {
    return [...await filesystem.readFile(path, { maxBytes: 1024 })];
  } catch (error) {
    if (error instanceof FsError && error.code === "ENOENT") return null;
    throw error;
  }
}

async function snapshot(left: FileSystem, right: FileSystem) {
  const entries = async (filesystem: FileSystem) => Promise.all(
    (await filesystem.readdir("/")).map(async entry => ({
      name: entry.name, type: entry.type,
      bytes: entry.type === "file" ? await bytesAt(filesystem, `/${entry.name}`) : null,
    })),
  );
  return { left: await entries(left), right: await entries(right) };
}

async function seed(left: FileSystem, right: FileSystem, existing: boolean) {
  await left.writeFile("/source", payload);
  await left.writeFile("/keep", sentinel);
  await right.writeFile("/keep", sentinel);
  if (existing) await right.writeFile("/target", previous);
}

async function exercise(context: TestContext, settings: {
  filesystem: FileSystem; left: FileSystem; right: FileSystem;
  source: string; target: string; action: Action;
  trace?: () => { operation: string; key: string }[];
}) {
  const { filesystem, left, right, source, target, action, trace } = settings;
  const before = await snapshot(left, right);
  const offset = trace?.().length ?? 0;
  let outcome: object = { status: "success" };
  try {
    if (action === "copy") await filesystem.copyFile(source, target);
    else if (action === "rename") await filesystem.rename(source, target);
    else {
      const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec(`mv ${source} ${target}`);
      if (result.exitCode !== 0) outcome = { status: "command-error", exitCode: result.exitCode, stderr: result.stderr };
    }
  } catch (error) {
    assert.ok(error instanceof FsError, "filesystem failures must retain typed errno");
    outcome = { status: "filesystem-error", code: error.code, syscall: error.syscall, path: error.path, dest: error.dest,
      cause: error.cause instanceof Error ? error.cause.message : null };
  }
  const operations = trace?.().slice(offset) ?? [];
  const after = await snapshot(left, right);
  context.diagnostic(JSON.stringify({ case: context.name, outcome, source, target, action, before, after, operations }));
  if (!("status" in outcome) || outcome.status !== "success") {
    assert.deepEqual(after, before, "this failed operation must not change bytes or namespace");
  }
  assert.deepEqual(outcome, { status: "success" }, "REQUIRED compatibility: distinct-file operation must succeed");
  assert.deepEqual(await bytesAt(left, "/source"), action === "copy" ? [...payload] : null);
  assert.deepEqual(await bytesAt(right, "/target"), [...payload]);
  assert.deepEqual(await bytesAt(left, "/keep"), [...sentinel]);
  assert.deepEqual(await bytesAt(right, "/keep"), [...sentinel]);
  const expected = (entries: typeof before.left, receivesTarget: boolean) => {
    const selected = entries.filter(entry => entry.name !== "target" && !(action !== "copy" && entry.name === "source"));
    if (receivesTarget) selected.push({ name: "target", type: "file", bytes: [...payload] });
    return selected.sort((first, second) => first.name.localeCompare(second.name));
  };
  const sharedBacking = before.right.some(entry => entry.name === "source");
  const expectedLeft = expected(before.left, sharedBacking);
  assert.deepEqual(after.left, expectedLeft);
  assert.deepEqual(after.right, expected(before.right, true));
}

function mounted(left: FileSystem, right: FileSystem) {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

async function realPair(context: TestContext) {
  const root = await mkdtemp(fileURLToPath(new URL("./.real-compatibility-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { left: await createRealFileSystem({ root }), right: await createRealFileSystem({ root }) };
}

for (const view of ["independent-memory", "shared-memory", "readonly", "overlay", "opaque", "real-shared-root"] as const) {
  test(`positive overwrite: ${view}, distinct backing files`, async context => {
    const pair = view === "real-shared-root" ? await realPair(context)
      : { left: createMemoryFileSystem(), right: createMemoryFileSystem() };
    if (view !== "independent-memory" && view !== "real-shared-root") pair.right = pair.left;
    await seed(pair.left, pair.right, true);
    const sourceView = view === "readonly" ? createReadOnlyFileSystem(pair.left)
      : view === "overlay" ? createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: pair.left })
      : view === "opaque" ? opaque(createReadOnlyFileSystem(pair.left)) : pair.left;
    const filesystem = mounted(sourceView, pair.right);
    const origin = await filesystem.stat("/left/source");
    const target = await filesystem.stat("/right/target");
    if (view !== "independent-memory") assert.equal(origin.identityScope, target.identityScope);
    if (view === "real-shared-root") assert.equal(origin.identityScope, Symbol.for("virtual-bash.fs.native"));
    await exercise(context, { filesystem, ...pair, source: "/left/source", target: "/right/target", action: "copy" });
  });
}

for (const view of ["opaque", "real-shared-root"] as const) {
  test(`paired alias control: ${view} does not manufacture disjoint scopes`, async context => {
    const pair = view === "real-shared-root" ? await realPair(context)
      : { left: createMemoryFileSystem(), right: createMemoryFileSystem() };
    if (view === "opaque") pair.right = pair.left;
    await seed(pair.left, pair.right, false);
    const filesystem = mounted(opaque(createReadOnlyFileSystem(pair.left)), opaque(pair.right));
    const before = await snapshot(pair.left, pair.right);
    await assert.rejects(filesystem.copyFile("/left/source", "/right/source"), {
      code: "EINVAL", syscall: "copyFile", path: "/left/source", dest: "/right/source",
    });
    const after = await snapshot(pair.left, pair.right);
    assert.deepEqual(after, before);
    context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "EINVAL", before, after }));
  });
}

test("positive same-mount memory rename replaces a distinct file", async context => {
  const backing = createMemoryFileSystem();
  await seed(backing, backing, true);
  await exercise(context, { filesystem: createMountFileSystem({ root: backing }), left: backing, right: backing,
    source: "/source", target: "/target", action: "rename" });
});

test("REQUIRED shared memory backend mounted twice: distinct-file mv overwrite", async context => {
  const backing = createMemoryFileSystem();
  await seed(backing, backing, true);
  await exercise(context, { filesystem: mounted(backing, backing), left: backing, right: backing,
    source: "/left/source", target: "/right/target", action: "mv" });
});

for (const existing of [false, true]) {
  test(`REQUIRED cross-mount memory mv, target ${existing ? "existing" : "missing"}`, async context => {
    const left = createMemoryFileSystem();
    const right = createMemoryFileSystem();
    await seed(left, right, existing);
    await exercise(context, { filesystem: mounted(left, right), left, right,
      source: "/left/source", target: "/right/target", action: "mv" });
  });
}

for (const kind of ["s3", "webdav"] as const) {
  for (const route of ["direct", "one-mount", "separate-clients"] as const) {
    for (const existing of [false, true]) {
      test(`REQUIRED ${kind} ${route} copy, target ${existing ? "existing" : "missing"}`, async context => {
        const pair = remote(kind);
        await seed(pair.left, pair.right, existing);
        assert.equal((await pair.left.stat("/source")).identityScope, undefined);
        assert.equal((await pair.right.stat("/source")).identityScope, undefined);
        const filesystem = route === "direct" ? pair.left : route === "one-mount"
          ? createMountFileSystem({ root: pair.left }) : mounted(pair.left, pair.right);
        await exercise(context, { filesystem, ...pair, action: "copy",
          source: route === "separate-clients" ? "/left/source" : "/source",
          target: route === "separate-clients" ? "/right/target" : "/target" });
      });
    }
  }

  for (const route of ["direct", "one-mount"] as const) {
    test(`positive ${kind} ${route} existing-target rename${kind === "s3" ? " (non-atomic opt-in)" : " (default lock policy)"}`, async context => {
      const pair = remote(kind, true);
      await seed(pair.left, pair.right, true);
      await exercise(context, { filesystem: route === "direct" ? pair.left : createMountFileSystem({ root: pair.left }),
        ...pair, source: "/source", target: "/target", action: "rename" });
    });
  }

  for (const existing of [false, true]) {
    test(`REQUIRED ${kind} separate-clients cross-mount mv, target ${existing ? "existing" : "missing"}`, async context => {
      const pair = remote(kind, true);
      await seed(pair.left, pair.right, existing);
      await exercise(context, { filesystem: mounted(pair.left, pair.right), ...pair,
        source: "/left/source", target: "/right/target", action: "mv" });
    });
  }

  test(`paired ${kind} opaque separate-client alias stays unchanged (traversal may reject first)`, async context => {
    const pair = remote(kind);
    await seed(pair.left, pair.right, false);
    const filesystem = mounted(opaque(createReadOnlyFileSystem(pair.left)), opaque(pair.right));
    assert.equal((await pair.left.stat("/source")).identityScope, undefined);
    assert.equal((await pair.right.stat("/source")).identityScope, undefined);
    const before = await snapshot(pair.left, pair.right);
    const offset = pair.trace().length;
    let cause: string | null = null;
    await assert.rejects(filesystem.copyFile("/left/source", "/right/source"), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "ENOTSUP");
      assert.equal(error.syscall, "copyFile");
      assert.equal(error.path, "/left/source");
      assert.equal(error.dest, "/right/source");
      cause = error.cause instanceof Error ? error.cause.message : null;
      return true;
    });
    const operations = pair.trace().slice(offset);
    assert.deepEqual(operations.filter(request => !["headObject", "listObjectsV2", "PROPFIND"].includes(request.operation)), []);
    const after = await snapshot(pair.left, pair.right);
    assert.deepEqual(after, before);
    context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "ENOTSUP", cause, before, after, operations }));
  });

  for (const direction of ["to-remote", "from-remote"] as const) {
    for (const existing of [false, true]) {
      test(`REQUIRED memory ${direction} ${kind} copy, target ${existing ? "existing" : "missing"}`, async context => {
        const remotePair = remote(kind);
        const memory = createMemoryFileSystem();
        const left = direction === "to-remote" ? memory : remotePair.left;
        const right = direction === "to-remote" ? remotePair.right : memory;
        await seed(left, right, existing);
        await exercise(context, { filesystem: mounted(left, right), left, right, trace: remotePair.trace,
          source: "/left/source", target: "/right/target", action: "copy" });
      });
    }
  }
}

test("declared S3 default rename limit remains typed ENOTSUP and effect-free", async context => {
  const pair = remote("s3");
  await seed(pair.left, pair.right, true);
  const before = await snapshot(pair.left, pair.right);
  const offset = pair.trace().length;
  await assert.rejects(pair.left.rename("/source", "/target"), { code: "ENOTSUP" });
  const operations = pair.trace().slice(offset);
  assert.deepEqual(operations, []);
  const after = await snapshot(pair.left, pair.right);
  assert.deepEqual(after, before);
  context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "ENOTSUP", before, after, operations }));
});
