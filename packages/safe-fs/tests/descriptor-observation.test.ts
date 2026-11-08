import { describe, expect, it, vi } from "vitest";
import type { FileDescriptor, FileDescriptorCapabilities, OpenFileOptions } from "../src/contracts/descriptor.js";
import { FsError } from "../src/contracts/errors.js";
import { forwardFileDescriptor, openFileDescriptor, type DescriptorBackend } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";

const capabilities: FileDescriptorCapabilities = {
  positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture() {
  const resource = { position: 0, probes: 0, reads: 0, writes: 0, closes: 0 };
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async stat() { return { type: "file", size: 12, mode: 0o100666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read(current, bytes, position) { current.reads++; if (position === null) current.position += bytes.length; return bytes.length; },
    async write(current, bytes, position) { current.writes++; if (position === null) current.position += bytes.length; return bytes.length; },
    async probeRead(current) { expect(this).toBe(backend); expect(current).toBe(resource); current.probes++; return "ready"; },
    async truncate() {}, async sync() {},
    async close(current) { current.closes++; },
  };
  return { backend, resource };
}

describe.each(["read", "write", "readwrite"] as const)("%s descriptor observation", access => {
  it.each(["ready", "blocked", "unknown"] as const)("returns %s without reading, writing or changing the cursor", async readiness => {
    const { backend, resource } = fixture();
    backend.probeRead = async current => { current.probes++; return readiness; };
    const descriptor = await openFileDescriptor("/file", { access }, { ...capabilities, readObservation: true }, async () => backend);
    try {
      expect(descriptor.capabilities.readObservation).toBe(true);
      expect(await descriptor.probeRead!()).toBe(readiness);
      expect(resource).toEqual({ position: 0, probes: 1, reads: 0, writes: 0, closes: 0 });
    } finally { await descriptor.close(); }
    expect(resource.closes).toBe(1);
  });
});

it("captures the backend method and receiver once", async () => {
  const { backend, resource } = fixture();
  const original = backend.probeRead!;
  const getter = vi.fn(() => original);
  Object.defineProperty(backend, "probeRead", { configurable: true, get: getter });
  const descriptor = await openFileDescriptor("/file", { access: "write" }, { ...capabilities, readObservation: true }, async () => backend);
  Object.defineProperty(backend, "probeRead", { value: () => { throw new Error("replacement"); } });
  try {
    expect(await descriptor.probeRead!()).toBe("ready");
    expect(await descriptor.probeRead!()).toBe("ready");
    expect(getter).toHaveBeenCalledTimes(1);
    expect(resource.probes).toBe(2);
  } finally { await descriptor.close(); }
});

it.each([false, undefined])("does not promote a backend method when capability is %s", async readObservation => {
  const { backend } = fixture();
  const getter = vi.fn(() => { throw new Error("unadvertised method accessed"); });
  Object.defineProperty(backend, "probeRead", { get: getter });
  const selected = { ...capabilities, ...(readObservation === undefined ? {} : { readObservation }) };
  const descriptor = await openFileDescriptor("/file", { access: "read" }, selected, async () => backend);
  try {
    expect(descriptor.capabilities).toEqual({ ...selected, positionedWrite: false, truncate: false });
    expect(Object.hasOwn(descriptor.capabilities, "readObservation")).toBe(readObservation !== undefined);
    if (descriptor.probeRead) await expect(descriptor.probeRead()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(getter).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

it("rejects advertised observation without a method and closes the acquired resource", async () => {
  const { backend, resource } = fixture();
  Reflect.deleteProperty(backend, "probeRead");
  await expect(openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend))
    .rejects.toMatchObject({ code: "ENOTSUP", syscall: "probeRead" });
  expect(resource.closes).toBe(1);
});

it.each(["eof", "READY", "", false, 0, null, undefined, {}])("rejects invalid observation result %j", async result => {
  const { backend } = fixture();
  Object.defineProperty(backend, "probeRead", { value: async () => result });
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  try { await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "EIO", syscall: "probeRead" }); }
  finally { await descriptor.close(); }
});

it.each([undefined, null, false, 0, "", new FsError("EIO")])("preserves provider rejection identity %j", async reason => {
  const { backend } = fixture();
  backend.probeRead = async () => { throw reason; };
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  try { await expect(descriptor.probeRead!()).rejects.toBe(reason); }
  finally { await descriptor.close(); }
});

it.each([undefined, null, false, 0, ""])("cancellation %j wins after admitted probe failure and cleanup drains", async reason => {
  const { backend, resource } = fixture();
  const started = deferred<void>();
  const gate = deferred<"ready">();
  const controller = new AbortController();
  backend.probeRead = async (_current, options) => { expect(options.signal).toBe(controller.signal); started.resolve(); return gate.promise; };
  const descriptor = await openFileDescriptor("/file", { access: "write" }, { ...capabilities, readObservation: true }, async () => backend);
  expect(descriptor.probeRead).toBeTypeOf("function");
  const pending = descriptor.probeRead!({ signal: controller.signal });
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  await started.promise;
  controller.abort(reason);
  let closed = false;
  const closing = descriptor.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(resource.closes).toBe(0);
  gate.reject(new FsError("EIO"));
  expect(await outcome).toEqual({ error: controller.signal.reason });
  await closing;
  expect(resource.closes).toBe(1);
});

it("serializes admitted operations and refuses probes after close starts", async () => {
  const { backend, resource } = fixture();
  const started = deferred<void>();
  const gate = deferred<void>();
  backend.read = async current => { started.resolve(); await gate.promise; current.position++; return 1; };
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  expect(descriptor.probeRead).toBeTypeOf("function");
  const reading = descriptor.read(new Uint8Array(1), null);
  await started.promise;
  const probing = descriptor.probeRead!();
  const closing = descriptor.close();
  expect(descriptor.close()).toBe(closing);
  await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "EBADF" });
  expect(resource.probes).toBe(0);
  gate.resolve();
  await reading;
  expect(await probing).toBe("ready");
  await closing;
  expect(resource).toEqual({ position: 1, probes: 1, reads: 0, writes: 0, closes: 1 });
});

it("rejects a pre-aborted probe without invoking the provider", async () => {
  const { backend, resource } = fixture();
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  const controller = new AbortController(); controller.abort(false);
  try { await expect(descriptor.probeRead!({ signal: controller.signal })).rejects.toBe(false); expect(resource.probes).toBe(0); }
  finally { await descriptor.close(); }
});

it("a canceled queued probe never reaches the provider and does not poison later work", async () => {
  const { backend, resource } = fixture();
  const started = deferred<void>();
  const gate = deferred<void>();
  backend.read = async () => { started.resolve(); await gate.promise; return 0; };
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  const reading = descriptor.read(new Uint8Array(1), null);
  await started.promise;
  const controller = new AbortController();
  const queued = descriptor.probeRead!({ signal: controller.signal });
  const rejected = expect(queued).rejects.toBe(0);
  controller.abort(0);
  gate.resolve();
  try {
    await reading;
    await rejected;
    expect(resource.probes).toBe(0);
    expect(await descriptor.probeRead!()).toBe("ready");
  } finally { await descriptor.close(); }
});

it.each([undefined, null, false, 0, ""])("drains a successful probe then preserves close rejection %j", async reason => {
  const { backend, resource } = fixture();
  backend.close = async current => { current.closes++; throw reason; };
  const descriptor = await openFileDescriptor("/file", { access: "write" }, { ...capabilities, readObservation: true }, async () => backend);
  expect(await descriptor.probeRead!()).toBe("ready");
  const closing = descriptor.close();
  expect(descriptor.close()).toBe(closing);
  await expect(closing).rejects.toBe(reason);
  await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "EBADF" });
  expect(resource.closes).toBe(1);
});

it("forwarding captures the descriptor method and preserves its receiver", async () => {
  const { backend, resource } = fixture();
  const retained = await openFileDescriptor("/file", { access: "write" }, { ...capabilities, readObservation: true }, async () => backend);
  const original = retained.probeRead!;
  const getter = vi.fn(() => original);
  Object.defineProperty(retained, "probeRead", { configurable: true, get: getter });
  const operations: string[] = [];
  const forwarded = forwardFileDescriptor(retained, async (syscall, _options, action) => { operations.push(syscall); return action(); });
  Object.defineProperty(retained, "probeRead", { value: () => { throw new Error("replacement"); } });
  const alias = await openFileDescriptor("/alias", { access: "write" }, capabilities, async () => forwarded);
  try { expect(await alias.probeRead!()).toBe("ready"); expect(getter).toHaveBeenCalledTimes(1); expect(operations).toEqual(["probeRead"]); }
  finally { await alias.close(); }
  expect(resource.closes).toBe(1);
});

it.each([false, undefined])("forwarding refuses promotion from %s even with a method", async readObservation => {
  const { backend } = fixture();
  const retained = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, ...(readObservation === undefined ? {} : { readObservation }) }, async () => backend);
  Object.defineProperty(retained, "probeRead", { value: async () => "ready" });
  try {
    expect(() => forwardFileDescriptor(retained, async (_syscall, _options, action) => action(), { ...capabilities, readObservation: true }))
      .toThrowError(expect.objectContaining({ code: "ENOTSUP" }));
  } finally { await retained.close(); }
});

it.each([false, undefined])("forwarding masks observation when selected capability is %s", async readObservation => {
  const { backend, resource } = fixture();
  const retained = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  const getter = vi.fn(() => { throw new Error("masked method accessed"); });
  Object.defineProperty(retained, "probeRead", { get: getter });
  const selected = { ...capabilities, ...(readObservation === undefined ? {} : { readObservation }) };
  const forwarded = forwardFileDescriptor(retained, async (_syscall, _options, action) => action(), selected);
  const descriptor = await openFileDescriptor("/alias", { access: "read" }, capabilities, async () => forwarded);
  try {
    expect(Object.hasOwn(forwarded, "probeRead")).toBe(false);
    expect(descriptor.capabilities.readObservation).toBe(readObservation);
    if (descriptor.probeRead) await expect(descriptor.probeRead()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(getter).not.toHaveBeenCalled();
    expect(resource.probes).toBe(0);
  } finally { await descriptor.close(); }
});

it("forwarding rejects an advertised missing method without acquiring another descriptor", async () => {
  const { backend } = fixture();
  const retained = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, readObservation: true }, async () => backend);
  Object.defineProperty(retained, "probeRead", { value: undefined });
  let operations = 0;
  const operation = async <Result>(_syscall: string, _options: object, action: () => Promise<Result>): Promise<Result> => { operations++; return action(); };
  try {
    expect(() => forwardFileDescriptor(retained, operation)).toThrowError(expect.objectContaining({ code: "ENOTSUP" }));
    expect(operations).toBe(0);
  } finally { await retained.close(); }
});

describe.each(["mount", "readonly", "readonly-mount"])("%s resource observation", wrapper => {
  it("preserves the retained resource across unlink without another open", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array(12));
    const { backend, resource } = fixture();
    const open = vi.fn(async (path: string, options: OpenFileOptions): Promise<FileDescriptor> =>
      openFileDescriptor(path, options, { ...capabilities, readObservation: true }, async () => backend));
    Object.defineProperty(source, "open", { value: open });
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
    const filesystem = wrapper === "mount" ? mounted : new ReadOnlyFileSystem(wrapper === "readonly" ? source : mounted);
    const descriptor = await filesystem.open(wrapper === "readonly" ? "/file" : "/volume/file", { access: "read" });
    try {
      await source.rm("/file");
      expect(descriptor.capabilities.readObservation).toBe(true);
      expect(await descriptor.probeRead!()).toBe("ready");
      expect(open).toHaveBeenCalledTimes(1);
      expect(resource.reads).toBe(0);
      expect(resource.position).toBe(0);
    } finally { await descriptor.close(); }
    expect(resource.closes).toBe(1);
  });
});
