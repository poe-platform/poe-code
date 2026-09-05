import { fs, vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDescriptor, FileDescriptorCapabilities } from "../src/contracts/descriptor.js";
import { openFileDescriptor, forwardFileDescriptor } from "../src/fs/descriptor.js";
import type { DescriptorBackend } from "../src/fs/descriptor.js";
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
  positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile", position: true,
};

function backend(): DescriptorBackend<{ position: number }> {
  return {
    resource: { position: 0 },
    async stat() { return { type: "file", size: 999, mode: 0o100666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read(resource, bytes, position) { if (position === null) resource.position += bytes.length; return bytes.length; },
    async write(resource, bytes, position) { if (position === null) resource.position += bytes.length; return bytes.length; },
    async getPosition(resource) { return resource.position; },
    async truncate() {}, async sync() {}, async close() {},
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

it("memory queries the retained cursor across sequential and positioned I/O, truncate, rename and unlink", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", new TextEncoder().encode("abcdef"));
  const descriptor = await filesystem.open("/file", { access: "readwrite" });
  try {
    expect(descriptor.capabilities.position).toBe(true);
    expect(await descriptor.getPosition!()).toBe(0);
    expect(await descriptor.read(new Uint8Array(2), null)).toBe(2);
    expect(await descriptor.getPosition!()).toBe(2);
    await descriptor.read(new Uint8Array(1), 4);
    await descriptor.write(Uint8Array.of(90), 5);
    expect(await descriptor.getPosition!()).toBe(2);
    await descriptor.write(Uint8Array.of(88), null);
    expect(await descriptor.getPosition!()).toBe(3);
    await descriptor.truncate(1);
    expect((await descriptor.stat()).size).toBe(1);
    expect(await descriptor.getPosition!()).toBe(3);
    expect(await descriptor.read(new Uint8Array(5), null)).toBe(0);
    expect(await descriptor.getPosition!()).toBe(3);
    await filesystem.rename("/file", "/moved");
    await filesystem.rm("/moved");
    await filesystem.writeFile("/file", new Uint8Array(40));
    expect(await descriptor.getPosition!()).toBe(3);
    await descriptor.write(Uint8Array.of(89), null);
    expect(await descriptor.getPosition!()).toBe(4);
    expect((await filesystem.stat("/file")).size).toBe(40);
  } finally { await descriptor.close(); }
  await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "EBADF" });
});

it("append reports the last actual cursor, not changing EOF or the append destination", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array(4));
  const descriptor = await filesystem.open("/file", { access: "readwrite", append: true });
  try {
    expect(await descriptor.getPosition!()).toBe(0);
    await descriptor.read(new Uint8Array(1), null);
    expect(await descriptor.getPosition!()).toBe(1);
    await descriptor.write(Uint8Array.of(1, 2), null);
    expect(await descriptor.getPosition!()).toBe(6);
    await filesystem.appendFile("/file", Uint8Array.of(3, 4, 5));
    expect(await descriptor.getPosition!()).toBe(6);
    expect((await descriptor.stat()).size).toBe(9);
    await descriptor.truncate(2);
    expect(await descriptor.getPosition!()).toBe(6);
    await descriptor.write(Uint8Array.of(6), null);
    expect(await descriptor.getPosition!()).toBe(3);
    await expect(descriptor.write(Uint8Array.of(7), 0)).rejects.toMatchObject({ code: "EINVAL" });
    expect(await descriptor.getPosition!()).toBe(3);
  } finally { await descriptor.close(); }
});

it.each([false, true])("zero-length I/O preserves the actual cursor before and beyond EOF: append=%s", async append => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array(8));
  const descriptor = await filesystem.open("/file", { access: "readwrite", append });
  try {
    await descriptor.read(new Uint8Array(3), null);
    for (const length of [8, 1]) {
      await descriptor.truncate(length);
      expect(await descriptor.read(new Uint8Array(), null)).toBe(0);
      expect(await descriptor.read(new Uint8Array(), 40)).toBe(0);
      expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
      if (append) await expect(descriptor.write(new Uint8Array(), 40)).rejects.toMatchObject({ code: "EINVAL" });
      else expect(await descriptor.write(new Uint8Array(), 40)).toBe(0);
      expect(await descriptor.getPosition!()).toBe(3);
      expect((await descriptor.stat()).size).toBe(length);
    }
  } finally { await descriptor.close(); }
});

it.each(["read", "write", "readwrite"] as const)("position is independent of descriptor access: %s", async access => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array(4));
  const descriptor = await filesystem.open("/file", { access });
  try { expect(descriptor.capabilities.position).toBe(true); expect(await descriptor.getPosition!()).toBe(0); }
  finally { await descriptor.close(); }
});

it("separate opens have separate cursors while forwarding aliases share the retained descriptor", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array(8));
  const retained = await filesystem.open("/file", { access: "readwrite" });
  const independent = await filesystem.open("/file", { access: "readwrite" });
  const alias = await openFileDescriptor("/alias", { access: "readwrite" }, capabilities, async () =>
    forwardFileDescriptor(retained, async (_syscall, _options, action) => action()));
  try {
    await retained.read(new Uint8Array(2), null);
    expect(await alias.getPosition!()).toBe(2);
    await alias.write(new Uint8Array(3), null);
    expect(await retained.getPosition!()).toBe(5);
    expect(await independent.getPosition!()).toBe(0);
  } finally { await alias.close(); await independent.close(); }
});

describe.each(["mount", "readonly", "readonly-mount"])("%s position forwarding", wrapper => {
  it("preserves position support without reopening paths", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array(5));
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
    const filesystem = wrapper === "mount" ? mounted : new ReadOnlyFileSystem(wrapper === "readonly" ? source : mounted);
    const path = wrapper === "readonly" ? "/file" : "/volume/file";
    const descriptor = await filesystem.open(path, { access: "read" });
    try {
      expect(descriptor.capabilities.position).toBe(true);
      await descriptor.read(new Uint8Array(3), null);
      await source.rm("/file");
      expect(await descriptor.getPosition!()).toBe(3);
    } finally { await descriptor.close(); }
  });
  it("preserves an explicit refusal without querying or estimating position", async () => {
    const source = new MemoryFileSystem();
    await source.writeFile("/file", new Uint8Array(5));
    const retained = backend();
    const query = vi.spyOn(retained, "getPosition");
    vi.spyOn(source, "open").mockImplementation((path, options) => openFileDescriptor(path, options, { ...capabilities, position: false }, async () => retained));
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
    const filesystem = wrapper === "mount" ? mounted : new ReadOnlyFileSystem(wrapper === "readonly" ? source : mounted);
    const descriptor = await filesystem.open(wrapper === "readonly" ? "/file" : "/volume/file", { access: "read" });
    try {
      expect(descriptor.capabilities.position).toBe(false);
      await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(query).not.toHaveBeenCalled();
    } finally { await descriptor.close(); }
  });
});

it("query serialization drains before close and rejects newly admitted queries after close starts", async () => {
  const subject = backend();
  const started = deferred<void>();
  const finish = deferred<number>();
  const events: string[] = [];
  subject.getPosition = async resource => { events.push(`query:${resource.position}`); started.resolve(); return finish.promise; };
  subject.close = async () => { events.push("close"); };
  const descriptor = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, async () => subject);
  const writing = descriptor.write(new Uint8Array(3), null);
  const query = descriptor.getPosition!();
  const closing = descriptor.close();
  await started.promise;
  expect(events).toEqual(["query:3"]);
  await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "EBADF" });
  finish.resolve(3);
  expect(await query).toBe(3);
  await writing;
  await closing;
  expect(events).toEqual(["query:3", "close"]);
  expect(descriptor.close()).toBe(closing);
});

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("invalid backend cursor is refused without size fallback: %s", async position => {
  const subject = backend();
  subject.getPosition = async () => position;
  const stat = vi.spyOn(subject, "stat");
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject);
  try {
    await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "EIO", syscall: "getPosition", path: "/file" });
    expect(stat).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

it.each([false, undefined])("absent or false capability refuses queries without probing the backend: %s", async position => {
  const subject = backend();
  const query = vi.spyOn(subject, "getPosition");
  const selected = { ...capabilities };
  if (position === undefined) delete selected.position;
  else selected.position = position;
  const descriptor = await openFileDescriptor("/file", { access: "read" }, selected, async () => subject);
  try {
    expect(descriptor.capabilities.position).toBe(position);
    await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(query).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

it("an advertised position capability without an implementation fails acquisition and closes once", async () => {
  const subject = backend();
  delete subject.getPosition;
  const close = vi.spyOn(subject, "close");
  await expect(openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject)).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("invalid capability metadata fails before resource acquisition", async () => {
  const acquire = vi.fn(async () => backend());
  await expect(openFileDescriptor("/file", { access: "read" }, { ...capabilities, position: "yes" as unknown as boolean }, acquire)).rejects.toMatchObject({ code: "EINVAL" });
  expect(acquire).not.toHaveBeenCalled();
});

it("position implementation is captured once rather than rereading mutable provider metadata", async () => {
  const subject = backend();
  let reads = 0;
  Object.defineProperty(subject, "getPosition", { configurable: true, get() { reads++; return async () => Number.MAX_SAFE_INTEGER; } });
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject);
  Object.defineProperty(subject, "getPosition", { get() { throw new Error("replacement method"); } });
  try {
    expect(await descriptor.getPosition!()).toBe(Number.MAX_SAFE_INTEGER);
    expect(await descriptor.getPosition!()).toBe(Number.MAX_SAFE_INTEGER);
    expect(reads).toBe(1);
  } finally { await descriptor.close(); }
});

it("forwarded position calls retain their original implementation and operation boundary", async () => {
  const subject = backend();
  subject.resource.position = 4;
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject);
  const events: string[] = [];
  const forwarded = forwardFileDescriptor(descriptor, async (syscall, _options, action) => { events.push(syscall); return action(); });
  const wrapped = await openFileDescriptor("/alias", { access: "read" }, capabilities, async () => forwarded);
  Object.defineProperty(descriptor, "getPosition", { get() { throw new Error("replacement query"); } });
  try { expect(await wrapped.getPosition!()).toBe(4); expect(events).toEqual(["getPosition"]); }
  finally { await wrapped.close(); }
});

it("queued query cancellation does not invoke the backend or prevent close", async () => {
  const subject = backend();
  const gate = deferred<number>();
  subject.read = async () => gate.promise;
  const query = vi.spyOn(subject, "getPosition");
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject);
  const reading = descriptor.read(new Uint8Array(1), null);
  const controller = new AbortController();
  const queued = descriptor.getPosition!({ signal: controller.signal });
  const closing = descriptor.close();
  controller.abort(false);
  gate.resolve(0);
  await reading;
  await expect(queued).rejects.toBe(false);
  await closing;
  expect(query).not.toHaveBeenCalled();
});

it("forwarding cannot upgrade an unknown cursor even when a caller supplies a true capability", async () => {
  const subject = backend();
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, position: false }, async () => subject);
  try {
    expect(() => forwardFileDescriptor(descriptor, async (_syscall, _options, action) => action(), capabilities)).toThrowError(expect.objectContaining({ code: "ENOTSUP" }));
  } finally { await descriptor.close(); }
});

for (const reason of [false, 0, "", null, NaN]) it(`falsey cancellation dominates a late position result: ${String(reason)}`, async () => {
  const subject = backend();
  const started = deferred<void>();
  const finish = deferred<number>();
  subject.getPosition = async () => { started.resolve(); return finish.promise; };
  const controller = new AbortController();
  const descriptor = await openFileDescriptor("/file", { access: "read" }, capabilities, async () => subject);
  const query = descriptor.getPosition!({ signal: controller.signal });
  await started.promise;
  controller.abort(reason);
  finish.resolve(-1);
  try { await expect(query).rejects.toBe(reason); }
  finally { await descriptor.close(); }
});

it("pre-aborted queries are refused before backend invocation, even when unsupported", async () => {
  const subject = backend();
  const query = vi.spyOn(subject, "getPosition");
  const descriptor = await openFileDescriptor("/file", { access: "read" }, { ...capabilities, position: false }, async () => subject);
  const controller = new AbortController();
  controller.abort(0);
  try { await expect(descriptor.getPosition!({ signal: controller.signal })).rejects.toBe(0); expect(query).not.toHaveBeenCalled(); }
  finally { await descriptor.close(); }
});

it("real adapters do not advertise or estimate position without a native query primitive", async () => {
  vol.fromJSON({ "/machine/file": "abcdef" });
  const filesystem = new RealFileSystem("/machine");
  const descriptor: FileDescriptor = await filesystem.open("/file", { access: "readwrite" });
  try {
    expect(descriptor.capabilities.position).toBeUndefined();
    await descriptor.read(new Uint8Array(2), null);
    await descriptor.write(Uint8Array.of(65), null);
    await expect(descriptor.getPosition!()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(await fs.promises.readFile("/machine/file", "utf8")).toBe("abAdef");
  } finally { await descriptor.close(); }
});
