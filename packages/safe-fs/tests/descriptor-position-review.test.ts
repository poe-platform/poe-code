import { vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";
import type { FileDescriptorCapabilities, FsOptions } from "../src/contracts/filesystem.js";
import { forwardFileDescriptor, openFileDescriptor, type DescriptorBackend } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

beforeEach(() => { vol.reset(); });

const capabilities: FileDescriptorCapabilities = {
  position: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

async function fixture() {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", Uint8Array.of(0, 255, 128, 3, 4, 5));
  const retained = await filesystem.open("/file", { access: "readwrite" });
  const backend = forwardFileDescriptor(retained, async (_syscall, _options, action) => action());
  return { filesystem, retained, backend };
}

it("captures a backend query once with its backend receiver and retained resource", async () => {
  const { retained, backend } = await fixture();
  let captures = 0;
  const query = vi.fn(async function (this: typeof backend, resource: typeof retained, options: FsOptions) {
    expect(this).toBe(backend);
    expect(resource).toBe(retained);
    expect(options.signal).toBe(controller.signal);
    return resource.getPosition!();
  });
  const controller = new AbortController();
  Object.defineProperty(backend, "getPosition", { configurable: true, get() { captures++; return query; } });
  const descriptor = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, async () => backend);
  Object.defineProperty(backend, "getPosition", { get() { throw new Error("uncaptured query"); } });
  try {
    await descriptor.read(new Uint8Array(2), null);
    expect(await descriptor.getPosition!({ signal: controller.signal })).toBe(2);
    expect(await descriptor.getPosition!({ signal: controller.signal })).toBe(2);
    expect(captures).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  } finally { await descriptor.close(); }
});

it.each([false, undefined])("forwarding cannot upgrade position=%s or inspect its hidden query", async position => {
  const { retained } = await fixture();
  const selected = { ...capabilities };
  if (position === undefined) delete selected.position;
  else selected.position = position;
  Object.defineProperty(retained, "capabilities", { value: selected });
  const query = vi.fn(() => { throw new Error("unsupported query getter"); });
  Object.defineProperty(retained, "getPosition", { get: query });
  try {
    expect(() => forwardFileDescriptor(retained, async (_syscall, _options, action) => action(), capabilities))
      .toThrowError(expect.objectContaining({ code: "ENOTSUP", syscall: "getPosition" }));
    expect(query).not.toHaveBeenCalled();
  } finally { await retained.close(); }
});

it("a narrowed query stays unsupported after caller metadata and provider method mutate", async () => {
  const { retained } = await fixture();
  const selected = { ...capabilities, position: false };
  const backend = forwardFileDescriptor(retained, async (_syscall, _options, action) => action(), selected);
  selected.position = true;
  const descriptor = await openFileDescriptor("/alias", { access: "read" }, capabilities, async () => backend);
  const query = vi.spyOn(retained, "getPosition");
  try {
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    expect(descriptor.capabilities.position).toBe(false);
    await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(query).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

for (const wrapper of ["mount", "readonly"] as const) {
  it.each(["missing", "throwing"])(`${wrapper} releases an acquired descriptor when query capture is %s`, async kind => {
    const { filesystem, retained } = await fixture();
    const close = vi.spyOn(retained, "close");
    const failure = new Error("query capture failed");
    Object.defineProperty(retained, "getPosition", kind === "missing"
      ? { value: undefined }
      : { get() { throw failure; } });
    vi.spyOn(filesystem, "open").mockResolvedValue(retained);
    const view = wrapper === "mount" ? new MountFileSystem({ root: filesystem }) : new ReadOnlyFileSystem(filesystem);
    const opening = view.open("/file", { access: "read" });
    if (kind === "missing") await expect(opening).rejects.toMatchObject({ code: "ENOTSUP" });
    else if (wrapper === "readonly") await expect(opening).rejects.toBe(failure);
    else await expect(opening).rejects.toMatchObject({ code: "EIO" });
    expect(close).toHaveBeenCalledTimes(1);
    await expect(retained.read(new Uint8Array(1), null)).rejects.toMatchObject({ code: "EBADF" });
  });
}

it("late acquisition cancellation closes without capturing the query and retains a falsey reason", async () => {
  const { backend } = await fixture();
  const ready = deferred<DescriptorBackend<typeof backend.resource>>();
  const close = vi.spyOn(backend, "close");
  const query = vi.fn(() => { throw new Error("cancelled acquisition queried"); });
  Object.defineProperty(backend, "getPosition", { get: query });
  const controller = new AbortController();
  const opening = openFileDescriptor("/file", { access: "read", signal: controller.signal }, capabilities, async () => ready.promise);
  controller.abort(null);
  ready.resolve(backend);
  await expect(opening).rejects.toBe(null);
  expect(close).toHaveBeenCalledTimes(1);
  expect(query).not.toHaveBeenCalled();
});

it.each([false, 0, "", null, NaN])("a rejected running query drains before close and cancellation wins exactly: %s", async reason => {
  const { backend } = await fixture();
  const started = deferred<void>();
  const finish = deferred<number>();
  const events: string[] = [];
  backend.getPosition = async () => { events.push("query"); started.resolve(); return finish.promise; };
  const release = backend.close;
  backend.close = async resource => { events.push("close"); await release(resource); throw "close failure"; };
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => backend);
  const controller = new AbortController();
  const query = descriptor.getPosition!({ signal: controller.signal });
  const observed = expect(query).rejects.toBe(reason);
  await started.promise;
  controller.abort(reason);
  const closing = descriptor.close();
  const closed = expect(closing).rejects.toBe("close failure");
  expect(descriptor.close()).toBe(closing);
  await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "EBADF" });
  expect(events).toEqual(["query"]);
  finish.reject(new Error("late provider failure"));
  await observed;
  await closed;
  expect(events).toEqual(["query", "close"]);
  expect(descriptor.close()).toBe(closing);
});

it("a failed query does not poison serialized writes or later queries", async () => {
  const { backend } = await fixture();
  const query = backend.getPosition!;
  let first = true;
  backend.getPosition = async (resource, options) => {
    if (first) { first = false; throw 0; }
    return query(resource, options);
  };
  const descriptor = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, async () => backend);
  const failed = expect(descriptor.getPosition!()).rejects.toBe(0);
  const writing = descriptor.write(Uint8Array.of(255, 254, 253), null);
  const position = descriptor.getPosition!();
  const closing = descriptor.close();
  await failed;
  expect(await writing).toBe(3);
  expect(await position).toBe(3);
  await closing;
});

it("queued queries snapshot their borrowed signal rather than later options mutation", async () => {
  const { backend } = await fixture();
  const finish = deferred<number>();
  backend.read = async () => finish.promise;
  const original = new AbortController();
  const replacement = new AbortController();
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => backend);
  const reading = descriptor.read(new Uint8Array(1), null);
  const options = { signal: original.signal };
  const queued = descriptor.getPosition!(options);
  const observed = expect(queued).rejects.toBe(0);
  options.signal = replacement.signal;
  original.abort(0);
  finish.resolve(0);
  await reading;
  await observed;
  await descriptor.close();
});

it("append aliases retain their own last cursor across another append, unlink and pathname replacement", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", Uint8Array.of(1, 2));
  const first = await filesystem.open("/file", { access: "readwrite", append: true });
  const second = await filesystem.open("/file", { access: "readwrite", append: true });
  const alias = await openFileDescriptor("/alias", { access: "readwrite", append: true }, capabilities,
    async () => forwardFileDescriptor(first, async (_syscall, _options, action) => action()));
  try {
    await first.write(Uint8Array.of(255), null);
    await second.write(Uint8Array.of(128, 0), null);
    expect(await alias.getPosition!()).toBe(3);
    expect(await second.getPosition!()).toBe(5);
    await filesystem.rename("/file", "/moved");
    await filesystem.rm("/moved");
    await filesystem.writeFile("/file", new Uint8Array(40));
    await second.truncate(1);
    expect(await alias.getPosition!()).toBe(3);
    expect(await second.getPosition!()).toBe(5);
    await alias.write(Uint8Array.of(254), null);
    expect(await first.getPosition!()).toBe(2);
    expect(await second.getPosition!()).toBe(5);
    const bytes = new Uint8Array(2);
    expect(await second.read(bytes, 0)).toBe(2);
    expect(bytes).toEqual(Uint8Array.of(1, 254));
    expect(await second.getPosition!()).toBe(5);
    expect((await filesystem.stat("/file")).size).toBe(40);
  } finally { await alias.close(); await second.close(); }
});

it.each(["mount", "readonly"] as const)("%s cannot infer a real descriptor cursor from stat after sequential IO", async kind => {
  vol.fromJSON({ "/machine/file": "abcdef" });
  const real = new RealFileSystem("/machine");
  const view = kind === "mount" ? new MountFileSystem({ root: real }) : new ReadOnlyFileSystem(real);
  const descriptor = await view.open("/file", { access: "read" });
  try {
    const bytes = new Uint8Array(2);
    expect(await descriptor.read(bytes, null)).toBe(2);
    expect(bytes).toEqual(Uint8Array.of(97, 98));
    const stat = vi.spyOn(descriptor, "stat");
    expect(descriptor.capabilities.position).not.toBe(true);
    await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(stat).not.toHaveBeenCalled();
    expect(await descriptor.read(bytes, null)).toBe(2);
    expect(bytes).toEqual(Uint8Array.of(99, 100));
  } finally { await descriptor.close(); }
});
