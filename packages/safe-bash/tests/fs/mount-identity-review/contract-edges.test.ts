import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { ByteSource, ErrnoCode, FileStat, FileSystem, FsOptions, ReadStreamOptions, WriteFileOptions } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

const bytes = new Uint8Array([115, 99, 111, 112, 101, 0, 255, 10]);
const previous = new Uint8Array([111, 108, 100, 0, 254]);
const observations: Record<string, unknown>[] = [];
const scopes = new Map<object | symbol, number>();
type Event = { backend: string; operation: string; path: string; flag?: string; size?: number };
type Hooks = {
  metadata?: (stat: FileStat, path: string) => FileStat;
  lstat?: (path: string, options: FsOptions) => Promise<void>;
  beforeWrite?: (path: string, options: WriteFileOptions) => Promise<void>;
  streaming?: boolean;
};

function scopeId(scope: object | symbol | undefined): number | null {
  if (scope === undefined) return null;
  if (!scopes.has(scope)) scopes.set(scope, scopes.size + 1);
  return scopes.get(scope)!;
}

function trace(backend: FileSystem, name: string, events: Event[], hooks: Hooks = {}): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (property === "capabilities" && hooks.streaming !== undefined) return { ...target.capabilities, streamingRead: hooks.streaming, streamingWrite: hooks.streaming };
      if (property === "lstat" || property === "stat") return async (path: string, options: FsOptions = {}) => {
        if (property === "lstat") await hooks.lstat?.(path, options);
        const stat = await target[property](path, options);
        return hooks.metadata?.(stat, path) ?? stat;
      };
      if (property === "readStream" && target.readStream) return (path: string, options: ReadStreamOptions = {}): ByteSource => {
        events.push({ backend: name, operation: "readStream.acquire", path });
        const stream = target.readStream!(path, options);
        return (async function* () {
          events.push({ backend: name, operation: "readStream.next", path });
          for await (const chunk of stream) {
            events.push({ backend: name, operation: "readStream.chunk", path, size: chunk.length });
            yield chunk;
          }
        })();
      };
      if (property === "writeStream" && target.writeStream) return async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
        events.push({ backend: name, operation: "writeStream.enter", path, flag: options.flag ?? "w" });
        await hooks.beforeWrite?.(path, options);
        await target.writeStream!(path, source, options);
      };
      if (property === "writeFile") return async (path: string, data: Uint8Array, options: WriteFileOptions = {}) => {
        events.push({ backend: name, operation: "writeFile", path, flag: options.flag ?? "w" });
        await hooks.beforeWrite?.(path, options);
        await target.writeFile(path, data, options);
      };
      if (property === "readFile" || property === "copyFile" || property === "rename") return (...parameters: unknown[]) => {
        events.push({ backend: name, operation: property, path: String(parameters[0]) });
        return Reflect.apply(target[property], target, parameters);
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function snapshot(filesystem: FileSystem): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  async function visit(path: string): Promise<void> {
    const stat = await filesystem.lstat(path);
    const entry: Record<string, unknown> = { type: stat.type, mode: stat.mode, dev: stat.dev, ino: stat.ino, nlink: stat.nlink, scope: scopeId(stat.identityScope) };
    result[path] = entry;
    if (stat.type === "file") entry.bytesBase64 = Buffer.from(await filesystem.readFile(path, { maxBytes: 1024 * 1024 })).toString("base64");
    if (stat.type === "symlink") entry.target = await filesystem.readlink!(path);
    if (stat.type === "directory") for (const child of await filesystem.readdir(path)) await visit(`${path === "/" ? "" : path}/${child.name}`);
  }
  await visit("/");
  return result;
}

async function exercise(name: string, filesystem: FileSystem, roots: Record<string, FileSystem>, events: Event[], source: string, destination: string, options: FsOptions = {}) {
  const capture = async () => Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([name, root]) => [name, await snapshot(root)])));
  const before = await capture();
  events.length = 0;
  let failure: unknown;
  try { await filesystem.copyFile(source, destination, options); }
  catch (error) { failure = error; }
  const actualEvents = [...events];
  const afterState = await capture();
  const record: Record<string, unknown> = { name, source, destination, before, after: afterState, events: actualEvents, failure: failure instanceof FsError ? { code: failure.code, syscall: failure.syscall, path: failure.path, dest: failure.dest } : failure instanceof Error ? failure.message : failure ?? null };
  observations.push(record);
  return { before, after: afterState, events: actualEvents, failure, record, source, destination };
}

function boundary(result: Awaited<ReturnType<typeof exercise>>, code: ErrnoCode): void {
  assert.ok(result.failure instanceof FsError);
  assert.equal(result.failure.code, code);
  assert.equal(result.failure.syscall, "copyFile");
  assert.equal(result.failure.path, result.source);
  assert.equal(result.failure.dest, result.destination);
}

function mount(left: FileSystem, right: FileSystem): FileSystem {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

const invalid = [
  { name: "missing scope", field: "identityScope", value: undefined },
  { name: "null scope", field: "identityScope", value: null },
  { name: "string scope", field: "identityScope", value: "native" },
  { name: "function scope", field: "identityScope", value: () => {} },
  { name: "negative device", field: "dev", value: -1 },
  { name: "negative inode", field: "ino", value: -1 },
  { name: "unsafe inode", field: "ino", value: Number.MAX_SAFE_INTEGER + 1 },
  { name: "nonfinite device", field: "dev", value: NaN },
  { name: "missing inode", field: "ino", value: undefined },
] as const;

for (const row of invalid) {
  test(`unknown identity: ${row.name} rejects before acquisition in both directions`, async () => {
    const left = createMemoryFileSystem();
    const right = createMemoryFileSystem();
    await left.writeFile("/file", bytes);
    await right.writeFile("/file", previous);
    const events: Event[] = [];
    const broken = trace(left, "broken", events, { metadata(stat, path) {
      return path === "/file" ? Object.defineProperty(stat, row.field, { value: row.value, enumerable: true }) : stat;
    } });
    const filesystem = mount(broken, trace(right, "complete", events));
    for (const [source, destination] of [["/left/file", "/right/file"], ["/right/file", "/left/file"]] as const) {
      const result = await exercise(row.name, filesystem, { left, right }, events, source, destination);
      boundary(result, "ENOTSUP");
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.events, [], "unknown identity rejects before eager source acquisition and writes");
    }
  });
}

test("truthful disjoint object scopes permit synthetic coordinate collisions without coercion", async () => {
  const left = createMemoryFileSystem();
  const right = createMemoryFileSystem();
  await left.writeFile("/file", bytes);
  await right.writeFile("/file", previous);
  const events: Event[] = [];
  const opaque = () => ({ toString() { throw new Error("forbidden scope coercion"); }, [Symbol.toPrimitive]() { throw new Error("forbidden scope coercion"); } });
  const scoped = (backend: FileSystem, name: string) => {
    const identityScope = opaque();
    return trace(backend, name, events, { metadata(stat) { return { ...stat, identityScope, dev: 7, ino: 11 }; } });
  };
  const result = await exercise("truthful disjoint object scopes", mount(scoped(left, "left"), scoped(right, "right")), { left, right }, events, "/left/file", "/right/file");
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.after.left, result.before.left);
  assert.deepEqual(await right.readFile("/file"), bytes);
  assert.ok(result.events.some((event) => event.operation === "readStream.chunk"));
  assert.ok(result.events.some((event) => event.operation === "writeStream.enter"));
});

test("prototype scope getter survives readonly and nested mount without premature source acquisition", async () => {
  const backend = createMemoryFileSystem();
  await backend.writeFile("/file", bytes);
  await backend.link("/file", "/target");
  const events: Event[] = [];
  let getterReads = 0;
  const decorated = trace(backend, "source", events, { metadata(stat) {
    const { identityScope, ...rest } = stat;
    return Object.setPrototypeOf(rest, { get identityScope() { getterReads++; return identityScope; } });
  } });
  const nested = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/nested": createReadOnlyFileSystem(decorated) } });
  const filesystem = mount(nested, trace(backend, "target", events));
  const result = await exercise("getter forwarding", filesystem, { backend }, events, "/left/nested/file", "/right/target");
  result.record.getterReads = getterReads;
  boundary(result, "EINVAL");
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.events, []);
  assert.ok(getterReads > 0);
  assert.equal((await nested.stat("/nested/file")).identityScope, (await backend.stat("/file")).identityScope);
});

test("overlay copy-up replaces exposed backing identity and permits a truly distinct subsequent copy", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", bytes);
  const events: Event[] = [];
  const overlay = createOverlayFileSystem({ upper: trace(upper, "upper", events), lower: trace(lower, "lower", events) });
  const view = createReadOnlyFileSystem(overlay);
  const filesystem = mount(view, trace(lower, "target", events));
  const lowerIdentity = await lower.stat("/file");
  assert.equal((await filesystem.stat("/left/file")).identityScope, lowerIdentity.identityScope);
  const rejected = await exercise("overlay before copy-up", filesystem, { upper, lower }, events, "/left/file", "/right/file");
  boundary(rejected, "EINVAL");
  assert.deepEqual(rejected.after, rejected.before);
  assert.deepEqual(rejected.events, []);
  await overlay.writeFile("/file", previous);
  const upperIdentity = await upper.stat("/file");
  for (const method of ["stat", "lstat"] as const) {
    const exposed = await filesystem[method]("/left/file");
    assert.equal(exposed.identityScope, upperIdentity.identityScope);
    assert.equal(exposed.dev, upperIdentity.dev);
    assert.equal(exposed.ino, upperIdentity.ino);
    assert.notEqual(exposed.identityScope, lowerIdentity.identityScope);
  }
  assert.deepEqual(await lower.readFile("/file"), bytes);
  const copied = await exercise("overlay after copy-up", filesystem, { upper, lower }, events, "/left/file", "/right/file");
  assert.equal(copied.failure, undefined);
  assert.deepEqual(copied.after.upper, copied.before.upper);
  assert.deepEqual(await lower.readFile("/file"), previous);
});

test("new repeated-backend constructor input retains hardlink protection and rejects duplicate mount paths", async () => {
  const backend = createMemoryFileSystem();
  await backend.writeFile("/file", bytes);
  await backend.link("/file", "/target");
  const events: Event[] = [];
  const shared = trace(backend, "shared", events);
  const filesystem = mount(shared, shared);
  const result = await exercise("repeated backend hardlink", filesystem, { backend }, events, "/left/file", "/right/target");
  boundary(result, "EINVAL");
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.events, []);
  assert.throws(() => createMountFileSystem({ root: backend, mounts: { "/same": backend, "/same/.": createMemoryFileSystem() } }), (error) => error instanceof FsError && error.code === "EINVAL" && error.syscall === "mount");
  const copied = await exercise("repeated backend distinct target", filesystem, { backend }, events, "/left/file", "/right/new");
  assert.equal(copied.failure, undefined);
  assert.deepEqual(await backend.readFile("/file"), bytes);
  assert.deepEqual(await backend.readFile("/new"), bytes);
});

for (const streaming of [true, false]) {
  test(`default missing-target alias race uses exclusive creation, streaming=${streaming}`, async () => {
    const backend = createMemoryFileSystem();
    await backend.writeFile("/file", bytes);
    const events: Event[] = [];
    let inserted: Record<string, unknown> | undefined;
    const target = trace(backend, "target", events, { streaming, async beforeWrite(path) {
      await backend.link("/file", path);
      inserted = await snapshot(backend);
      events.push({ backend: "external-writer", operation: "link", path });
    } });
    const result = await exercise(`default missing target race ${streaming}`, mount(trace(backend, "source", events, { streaming }), target), { backend }, events, "/left/file", "/right/new");
    result.record.inserted = inserted;
    boundary(result, "EEXIST");
    assert.deepEqual(result.after.backend, inserted);
    assert.deepEqual(await backend.readFile("/file"), bytes);
    assert.deepEqual(await backend.readFile("/new"), bytes);
    assert.equal(result.events.find((event) => event.operation === (streaming ? "writeStream.enter" : "writeFile"))?.flag, "wx");
  });
}

for (const wrapped of [false, true]) {
  test(`ENOENT-shaped cancellation during target lookup is not missing-file permission, overlay=${wrapped}`, async () => {
    const left = createMemoryFileSystem();
    const right = createMemoryFileSystem();
    await left.writeFile("/file", bytes);
    await right.writeFile("/target", previous);
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { syscall: "caller-abort", path: "/cancellation" });
    const events: Event[] = [];
    const target = trace(right, "target", events, { async lstat(path, options) {
      if (path === "/target") {
        assert.equal(options.signal, controller.signal);
        controller.abort(reason);
        throw reason;
      }
    } });
    const upper = createMemoryFileSystem();
    const selected = wrapped ? createOverlayFileSystem({ upper, lower: target }) : target;
    const result = await exercise(`ENOENT cancellation ${wrapped}`, mount(trace(left, "source", events), selected), { left, right, upper }, events, "/left/file", "/right/target", { signal: controller.signal });
    result.record.sameAbortReason = result.failure === reason;
    assert.equal(result.failure, reason);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.events, []);
  });
}

test("unknown same-mount identity cannot delegate to an arbitrary destructive copyFile method", async () => {
  const backend = createMemoryFileSystem();
  await backend.writeFile("/file", bytes);
  await backend.link("/file", "/target");
  const events: Event[] = [];
  const decorated = trace(backend, "generic", events, { metadata(stat) {
    const { identityScope: ignoredOmitted, ...rest } = stat;
    return rest;
  } });
  const unsafe = new Proxy(decorated, {
    get(target, property) {
      if (property === "copyFile") return async (source: string, destination: string) => {
        events.push({ backend: "generic", operation: "copyFile.delegate", path: destination });
        await target.writeStream!(destination, target.readStream!(source), { flag: "w" });
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const filesystem = createMountFileSystem({ root: unsafe });
  const result = await exercise("unknown same-mount delegation", filesystem, { backend }, events, "/file", "/target");
  boundary(result, "ENOTSUP");
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.events, []);
});

after(async () => {
  if (process.env.IDENTITY_EDGE_EVIDENCE) await writeFile(process.env.IDENTITY_EDGE_EVIDENCE, `${JSON.stringify(observations, null, 2)}\n`);
});
