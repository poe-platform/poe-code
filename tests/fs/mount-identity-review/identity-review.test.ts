import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import type { ByteSource, CopyFileOptions, ErrnoCode, FileSystem, ReadStreamOptions, WriteFileOptions } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const sentinel = new Uint8Array([...new TextEncoder().encode("independent alias sentinel\n"), 0, 255, 10]);
const previous = new TextEncoder().encode("unrelated destination must survive\n");
const records: Record<string, unknown>[] = [];

type Event = { backend: string; operation: string; path: string; flag?: string; destination?: string; bytes?: number };
type Hooks = {
  acquire?: () => void;
  beforeRead?: () => Promise<void>;
  afterChunk?: () => Promise<void>;
  failRead?: "acquire" | "after-chunk";
  failPublication?: boolean;
};

function traced(backend: FileSystem, name: string, events: Event[], hooks: Hooks = {}): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (property === "readStream" && target.readStream) {
        return (path: string, options: ReadStreamOptions = {}): ByteSource => {
          events.push({ backend: name, operation: "readStream.acquire", path });
          hooks.acquire?.();
          if (hooks.failRead === "acquire") throw new FsError("EIO", { syscall: "readStream", path });
          const stream = target.readStream!(path, options);
          return (async function* () {
            events.push({ backend: name, operation: "readStream.next", path });
            try {
              await hooks.beforeRead?.();
              for await (const chunk of stream) {
                events.push({ backend: name, operation: "readStream.chunk", path, bytes: chunk.byteLength });
                yield chunk;
                await hooks.afterChunk?.();
                if (hooks.failRead === "after-chunk") throw new FsError("EIO", { syscall: "readStream", path });
              }
            } finally {
              events.push({ backend: name, operation: "readStream.return", path });
            }
          })();
        };
      }
      if (property === "writeStream" && target.writeStream) {
        return async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
          events.push({ backend: name, operation: "writeStream.enter", path, flag: options.flag ?? "w" });
          await target.writeStream!(path, source, options);
          events.push({ backend: name, operation: "writeStream.complete", path });
        };
      }
      if (property === "rename") {
        return async (source: string, destination: string, ...options: [CopyFileOptions?]) => {
          events.push({ backend: name, operation: "rename", path: source, destination });
          if (hooks.failPublication && destination === "/target") {
            throw new FsError("EACCES", { syscall: "rename", path: source, dest: destination });
          }
          await target.rename(source, destination, ...options);
        };
      }
      if (property === "writeFile" || property === "copyFile" || property === "readFile") {
        const method = target[property];
        return (...parameters: unknown[]) => {
          events.push({ backend: name, operation: property, path: String(parameters[0]) });
          return Reflect.apply(method, target, parameters);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function snapshot(backend: FileSystem): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  async function visit(path: string): Promise<void> {
    const metadata = await backend.lstat(path);
    const state: Record<string, unknown> = {
      type: metadata.type, mode: metadata.mode, size: metadata.size,
      dev: metadata.dev, ino: metadata.ino, nlink: metadata.nlink,
    };
    entries[path] = state;
    if (metadata.type === "file") {
      const bytes = await backend.readFile(path, { maxBytes: 1024 * 1024 });
      state.base64 = Buffer.from(bytes).toString("base64");
      state.sha256 = createHash("sha256").update(bytes).digest("hex");
    } else if (metadata.type === "symlink") {
      state.target = await backend.readlink!(path);
    } else {
      delete state.size;
      for (const entry of await backend.readdir(path)) await visit(`${path === "/" ? "" : path}/${entry.name}`);
    }
  }
  await visit("/");
  return entries;
}

function errorRecord(error: unknown): unknown {
  return error instanceof FsError
    ? { name: error.name, code: error.code, syscall: error.syscall, path: error.path, dest: error.dest }
    : error instanceof Error ? { name: error.name, message: error.message } : error ?? null;
}

async function exercise(
  name: string, mount: FileSystem, roots: Record<string, FileSystem>, events: Event[],
  source = "/left/file", destination = "/right/target", options: CopyFileOptions = {},
) {
  const capture = async () => Object.fromEntries(await Promise.all(
    Object.entries(roots).map(async ([label, backend]) => [label, await snapshot(backend)]),
  ));
  const before = await capture();
  events.length = 0;
  let failure: unknown;
  try { await mount.copyFile(source, destination, options); }
  catch (error) { failure = error; }
  const operationEvents = [...events];
  const afterState = await capture();
  const record: Record<string, unknown> = { name, source, destination, options: { exclusive: options.exclusive ?? false }, before, after: afterState, failure: errorRecord(failure), events: operationEvents };
  records.push(record);
  return { before, after: afterState, failure, events: operationEvents, source, destination, record };
}

function boundary(result: Awaited<ReturnType<typeof exercise>>, code: ErrnoCode): void {
  assert.ok(result.failure instanceof FsError, `expected FsError ${code}; received ${JSON.stringify(errorRecord(result.failure))}`);
  assert.equal(result.failure.code, code);
  assert.equal(result.failure.syscall, "copyFile");
  assert.equal(result.failure.path, result.source);
  assert.equal(result.failure.dest, result.destination);
}

function untouched(result: Awaited<ReturnType<typeof exercise>>, code: ErrnoCode): void {
  assert.deepEqual(result.after, result.before, "all source/destination bytes, links and namespace survive");
  boundary(result, code);
  assert.deepEqual(result.events.filter((event) => ["writeStream.enter", "writeFile", "rename"].includes(event.operation)), [], "reject before target write entry");
}

function order(events: Event[], ...operations: string[]): void {
  let previousIndex = -1;
  for (const operation of operations) {
    const index = events.findIndex((event, position) => position > previousIndex && event.operation === operation);
    assert.ok(index > previousIndex, `${operation} missing/out of order: ${JSON.stringify(events)}`);
    previousIndex = index;
  }
}

function copied(events: Event[]): void {
  order(events, "readStream.acquire", "readStream.next", "readStream.chunk", "writeStream.complete");
  order(events, "writeStream.enter", "writeStream.complete");
}

async function realPair(context: TestContext) {
  const root = await mkdtemp(fileURLToPath(new URL(".fixture-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const left = await createRealFileSystem({ root });
  const right = await createRealFileSystem({ root });
  await left.writeFile("/file", sentinel);
  return { left, right };
}

function outer(left: FileSystem, right: FileSystem): FileSystem {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

const aliases = [
  { name: "real same-path across same-root instances", alias: "same-path", wrap: "none" },
  { name: "real hardlink across same-root instances", alias: "hardlink", wrap: "none" },
  { name: "real symlink across same-root instances", alias: "symlink", wrap: "none" },
  { name: "nested mounts retain real same-path identity", alias: "same-path", wrap: "nested" },
  { name: "readonly over nested mount retains real hardlink identity", alias: "hardlink", wrap: "readonly" },
  { name: "overlay lower read aliases direct real destination", alias: "same-path", wrap: "lower" },
  { name: "overlay upper read aliases direct real symlink destination", alias: "symlink", wrap: "upper" },
] as const;

for (const row of aliases) {
  test(row.name, async (context) => {
    const { left, right } = await realPair(context);
    const destination = row.alias === "same-path" ? "/file" : "/alias";
    if (row.alias === "hardlink") await left.link("/file", destination);
    if (row.alias === "symlink") await left.symlink("/file", destination);
    const events: Event[] = [];
    let reader = traced(left, "real-left", events);
    let source = "/left/file";
    const roots: Record<string, FileSystem> = { left, right };
    if (row.wrap === "nested" || row.wrap === "readonly") {
      reader = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/inner": reader } });
      source = "/left/inner/file";
      if (row.wrap === "readonly") reader = createReadOnlyFileSystem(reader);
    } else if (row.wrap === "lower" || row.wrap === "upper") {
      const other = createMemoryFileSystem();
      roots.otherLayer = other;
      reader = createOverlayFileSystem(row.wrap === "lower" ? { lower: reader, upper: other } : { lower: other, upper: reader });
    }
    const result = await exercise(row.name, outer(reader, traced(right, "real-right", events)), roots, events, source, `/right${destination}`);
    untouched(result, "EINVAL");
  });
}

for (const hardlink of [false, true]) {
  test(`memory shared backend ${hardlink ? "nested hardlink" : "same-path"} alias`, async () => {
    const backend = createMemoryFileSystem();
    await backend.writeFile("/file", sentinel);
    if (hardlink) await backend.link("/file", "/alias");
    const events: Event[] = [];
    const reader = traced(backend, "memory-left", events);
    const writer = traced(backend, "memory-right", events);
    const target = hardlink ? createMountFileSystem({ root: writer }) : writer;
    const name = `memory shared backend ${hardlink ? "nested hardlink" : "same-path"} alias`;
    untouched(await exercise(name, outer(reader, target), { backend }, events, "/left/file", hardlink ? "/right/alias" : "/right/file"), "EINVAL");
  });
}

function colliding(backend: FileSystem): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (property === "stat" || property === "lstat") {
        return async (...parameters: Parameters<FileSystem["stat"]>) => ({ ...await target[property](...parameters), dev: 7, ino: 11 });
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("distinct synthetic dev/ino collisions still perform the copy", async () => {
  const left = colliding(createMemoryFileSystem());
  const right = colliding(createMemoryFileSystem());
  await left.writeFile("/file", sentinel);
  await right.writeFile("/target", previous);
  const events: Event[] = [];
  const result = await exercise("distinct synthetic dev/ino collisions still perform the copy", outer(traced(left, "left", events), traced(right, "right", events)), { left, right }, events);
  assert.equal(result.failure, undefined);
  assert.deepEqual(await left.readFile("/file"), sentinel);
  assert.deepEqual(await right.readFile("/target"), sentinel);
  assert.deepEqual(result.after.left, result.before.left);
  copied(result.events);
});

test("equal-content real files are not samefile or a no-op", async (context) => {
  const { left, right } = await realPair(context);
  await right.writeFile("/target", sentinel);
  assert.notEqual((await left.stat("/file")).ino, (await right.stat("/target")).ino);
  const events: Event[] = [];
  const result = await exercise("equal-content real files are not samefile or a no-op", outer(traced(left, "left", events), traced(right, "right", events)), { left, right }, events);
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.after, result.before);
  copied(result.events);
});

test("distinct real roots with identical local pathname remain copyable", async (context) => {
  const { left } = await realPair(context);
  const { right } = await realPair(context);
  await right.writeFile("/file", previous);
  const events: Event[] = [];
  const result = await exercise("distinct real roots with identical local pathname remain copyable", outer(traced(left, "left", events), traced(right, "right", events)), { left, right }, events, "/left/file", "/right/file");
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.after.left, result.before.left);
  assert.deepEqual(await right.readFile("/file"), sentinel);
  copied(result.events);
});

test("exclusive real alias rejects EEXIST before either stream", async (context) => {
  const { left, right } = await realPair(context);
  await left.link("/file", "/target");
  const events: Event[] = [];
  untouched(await exercise("exclusive real alias rejects EEXIST before either stream", outer(traced(left, "left", events), traced(right, "right", events)), { left, right }, events, "/left/file", "/right/target", { exclusive: true }), "EEXIST");
});

test("readonly destination rejects EROFS before either stream", async (context) => {
  const { left, right } = await realPair(context);
  await right.writeFile("/target", previous);
  const events: Event[] = [];
  untouched(await exercise("readonly destination rejects EROFS before either stream", outer(traced(left, "left", events), createReadOnlyFileSystem(traced(right, "right", events))), { left, right }, events), "EROFS");
});

test("exclusive target created during stream acquisition is preserved", async (context) => {
  const { left, right } = await realPair(context);
  const events: Event[] = [];
  let insertion: Promise<void> | undefined;
  let insertedState: Record<string, unknown> | undefined;
  const reader = traced(left, "left", events, { acquire() {
    events.push({ backend: "race", operation: "target.create", path: "/target" });
    insertion = right.link("/file", "/target");
  } });
  const writer = new Proxy(traced(right, "right", events), {
    get(target, property) {
      if (property === "writeStream") return async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
        await insertion;
        insertedState = { left: await snapshot(left), right: await snapshot(right) };
        return target.writeStream!(path, source, options);
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await exercise("exclusive target created during stream acquisition is preserved", outer(reader, writer), { left, right }, events, "/left/file", "/right/target", { exclusive: true });
  result.record.insertedState = insertedState;
  boundary(result, "EEXIST");
  assert.deepEqual(result.after, insertedState, "failed exclusive publication preserves exactly the externally inserted hardlink state");
  assert.deepEqual(await left.readFile("/file"), sentinel);
  assert.deepEqual(await right.readFile("/target"), sentinel);
  assert.equal((await left.stat("/file")).ino, (await right.stat("/target")).ino);
  assert.deepEqual((await right.readdir("/")).map((entry) => entry.name), ["file", "target"]);
  order(result.events, "readStream.acquire", "target.create", "writeStream.enter");
  assert.equal(result.events.find((event) => event.operation === "writeStream.enter")?.flag, "wx");
});

test("synchronous source acquisition failure preserves real destination", async (context) => {
  const { left, right } = await realPair(context);
  await right.writeFile("/target", previous);
  const events: Event[] = [];
  const result = await exercise("synchronous source acquisition failure preserves real destination", outer(traced(left, "left", events, { failRead: "acquire" }), traced(right, "right", events)), { left, right }, events);
  boundary(result, "EIO");
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.events, [{ backend: "left", operation: "readStream.acquire", path: "/file" }]);
});

for (const mode of ["source-failure", "publication-failure", "exclusive-race"] as const) {
  test(`overlay destination preserves namespace on ${mode}`, async (context) => {
    const { left } = await realPair(context);
    const upper = createMemoryFileSystem();
    const lower = createMemoryFileSystem();
    if (mode !== "exclusive-race") await upper.writeFile("/target", previous);
    const events: Event[] = [];
    let insertedTarget: unknown;
    const hooks: Hooks = mode === "source-failure" ? { failRead: "after-chunk" } : mode === "exclusive-race" ? {
      async afterChunk() {
        events.push({ backend: "race", operation: "target.create", path: "/target" });
        await upper.writeFile("/target", previous, { flag: "wx" });
        insertedTarget = (await snapshot(upper))["/target"];
      },
    } : {};
    const destination = createOverlayFileSystem({ lower, upper: traced(upper, "upper", events, { failPublication: mode === "publication-failure" }) });
    const result = await exercise(`overlay destination preserves namespace on ${mode}`, outer(traced(left, "left", events, hooks), traced(destination, "overlay", events)), { left, upper, lower }, events, "/left/file", "/right/target", { exclusive: mode === "exclusive-race" });
    if (mode === "exclusive-race") result.record.insertedTarget = insertedTarget;
    boundary(result, mode === "source-failure" ? "EIO" : mode === "publication-failure" ? "EACCES" : "EEXIST");
    assert.deepEqual(result.after.left, result.before.left);
    assert.deepEqual(result.after.lower, result.before.lower);
    assert.deepEqual(await destination.readFile("/target"), previous);
    assert.deepEqual((await upper.readdir("/")).map((entry) => entry.name), ["target"], "no staged files survive");
    if (mode !== "exclusive-race") assert.deepEqual(result.after.upper, result.before.upper);
    else assert.deepEqual(result.after.upper["/target"], insertedTarget);
    order(result.events, "readStream.acquire", "readStream.next", "readStream.chunk");
    assert.ok(result.events.some((event) => event.backend === "upper" && event.operation === "writeStream.enter" && event.path !== "/target"), "writes are staged, not directed at the published target");
    assert.equal(result.events.some((event) => event.backend === "upper" && event.operation === "writeStream.enter" && event.path === "/target"), false);
    if (mode === "publication-failure") assert.ok(result.events.some((event) => event.operation === "rename" && event.destination === "/target"));
    else assert.equal(result.events.some((event) => event.operation === "rename" && event.destination === "/target"), false);
  });
}

after(async () => {
  if (process.env.MOUNT_IDENTITY_REVIEW_EVIDENCE) {
    await writeFile(process.env.MOUNT_IDENTITY_REVIEW_EVIDENCE, `${JSON.stringify(records, null, 2)}\n`);
  }
});
