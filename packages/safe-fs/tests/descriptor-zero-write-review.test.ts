import * as native from "node:fs/promises";
import { fs as memfs, vol } from "memfs";
import { expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileDescriptorCapabilities } from "../src/contracts/descriptor.js";
import { openFileDescriptor, forwardFileDescriptor, type DescriptorBackend } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, open: vi.fn() };
});

const base: FileDescriptorCapabilities = {
  positionedRead: true, positionedWrite: true, truncate: false, synchronization: "none",
};

function latch<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

function retained() {
  const resource = { calls: 0, closes: 0 };
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read() { throw new Error("unexpected backend read"); },
    async write(current, bytes) { current.calls++; return bytes.length; },
    async truncate() { throw new Error("unexpected truncate"); },
    async sync() { throw new Error("unexpected sync"); },
    async close(current) { current.closes++; },
  };
  return { resource, backend };
}

it.each(["undefined", "inherited", "nonenumerable"] as const)("independent zero-write review: %s opt-in does not activate dispatch", async variant => {
  const host = retained();
  let getterCalls = 0;
  const prototype = Object.defineProperty({}, "delegateZeroLengthWrite", { get() { getterCalls++; return true; } });
  const selected: FileDescriptorCapabilities = variant === "inherited" ? Object.assign(Object.create(prototype), base) : { ...base };
  if (variant === "undefined") Reflect.set(selected, "delegateZeroLengthWrite", undefined);
  if (variant === "nonenumerable") Object.defineProperty(selected, "delegateZeroLengthWrite", { get() { getterCalls++; return true; } });
  const descriptor = await openFileDescriptor("/node", { access: "write" }, selected, async () => host.backend);
  try {
    expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
    expect(host.resource.calls).toBe(0);
    expect(getterCalls).toBe(0);
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(false);
  } finally { await descriptor.close(); }
});

it("independent zero-write review: an empty view retains buffer identity, offset and position", async () => {
  const host = retained();
  const storage = Uint8Array.of(1, 2, 3, 4, 5);
  const empty = storage.subarray(3, 3);
  const controller = new AbortController();
  host.backend.write = async (resource, bytes, position, options) => {
    resource.calls++;
    expect(bytes).toBe(empty);
    expect(bytes.buffer).toBe(storage.buffer);
    expect(bytes.byteOffset).toBe(storage.byteOffset + 3);
    expect(position).toBe(17);
    expect(options.signal).toBe(controller.signal);
    return 0;
  };
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...base, delegateZeroLengthWrite: true }, async () => host.backend);
  try {
    expect(await descriptor.write(empty, 17, { signal: controller.signal })).toBe(0);
    expect(host.resource.calls).toBe(1);
    expect(storage).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  } finally { await descriptor.close(); }
});

it("independent zero-write review: forwarding aliases preserve dispatch and own one retained close", async () => {
  const host = retained();
  const failure = new FsError("EPERM");
  host.backend.write = async current => { current.calls++; throw failure; };
  const inner = await openFileDescriptor("/node", { access: "write" }, { ...base, delegateZeroLengthWrite: true }, async () => host.backend);
  const outer = await openFileDescriptor("/alias", { access: "write" }, base, async () => forwardFileDescriptor(inner, async (_operation, _options, action) => action()));
  try {
    expect(outer.capabilities.delegateZeroLengthWrite).toBe(true);
    await expect(outer.write(new Uint8Array(), null)).rejects.toBe(failure);
    expect(host.resource.calls).toBe(1);
  } finally { await outer.close(); await inner.close(); }
  expect(host.resource.closes).toBe(1);
});

it.each([undefined, null, false, "0"].map(value => ({ value })))("independent zero-write review: nonnumeric result $value cannot become zero", async ({ value }) => {
  const host = retained();
  Reflect.set(host.backend, "write", async () => value);
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...base, delegateZeroLengthWrite: true }, async () => host.backend);
  try { await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EIO" }); }
  finally { await descriptor.close(); }
});

it.each([undefined, null, false, 0].map(reason => ({ reason })))("independent zero-write review: provider rejection retains exact $reason", async ({ reason }) => {
  const host = retained();
  host.backend.write = async () => { throw reason; };
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...base, delegateZeroLengthWrite: true }, async () => host.backend);
  try {
    const outcome = await descriptor.write(new Uint8Array(), null).then(value => ({ accepted: true, value }), failure => ({ accepted: false, reason: failure }));
    expect(outcome).toEqual({ accepted: false, reason });
  } finally { await descriptor.close(); }
});

it.each([false, 0, null])("independent zero-write review: selected getter cancellation %s outranks invalid metadata and close failure", async reason => {
  const host = retained();
  const controller = new AbortController();
  host.backend.close = async current => { current.closes++; throw new Error("cleanup failure"); };
  const selected = Object.defineProperty({ ...base }, "delegateZeroLengthWrite", {
    enumerable: true, get() { controller.abort(reason); return "invalid"; },
  });
  await expect(openFileDescriptor("/node", { access: "write", signal: controller.signal }, base, async () => ({
    ...host.backend, capabilities: selected,
  }))).rejects.toBe(reason);
  expect(host.resource.calls).toBe(0);
  expect(host.resource.closes).toBe(1);
});

it("independent zero-write review: queued zero errors do not poison later admitted work during close", async () => {
  const host = retained();
  const entered = latch<void>();
  const release = latch<number>();
  const denied = new FsError("EPERM");
  host.backend.write = async (current, bytes) => {
    current.calls++;
    if (current.calls === 1) { entered.resolve(); return release.promise; }
    if (current.calls === 2) throw denied;
    return bytes.length;
  };
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...base, delegateZeroLengthWrite: true }, async () => host.backend);
  const first = descriptor.write(Uint8Array.of(1), null);
  await entered.promise;
  const second = descriptor.write(new Uint8Array(), null);
  const secondObserved = second.then(() => {}, () => {});
  const third = descriptor.write(new Uint8Array(), 12);
  const closing = descriptor.close();
  try {
    expect(host.resource.closes).toBe(0);
    await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
    release.resolve(1);
    expect(await first).toBe(1);
    await expect(second).rejects.toBe(denied);
    expect(await third).toBe(0);
    await closing;
    expect(host.resource.calls).toBe(3);
    expect(host.resource.closes).toBe(1);
  } finally { release.resolve(1); await first; await secondObserved; await third; await closing; }
});

it("independent zero-write review: memory retains omission and unchanged bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(5, 6));
  const descriptor = await fs.open("/file", { access: "readwrite" });
  try {
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(false);
    expect(await descriptor.write(new Uint8Array(), 100)).toBe(0);
    expect(await descriptor.read(new Uint8Array(), null)).toBe(0);
    expect(await descriptor.getPosition!()).toBe(0);
    expect(await fs.readFile("/file")).toEqual(Uint8Array.of(5, 6));
  } finally { await descriptor.close(); }
});

it("independent zero-write review: rooted real retains omission and never calls native empty read/write (memfs)", async () => {
  vol.reset();
  vol.fromJSON({ "/sandbox/file": "abc" });
  const handle = await memfs.promises.open("/sandbox/file", "r+");
  const write = vi.spyOn(handle, "write");
  const read = vi.spyOn(handle, "read");
  const close = vi.spyOn(handle, "close");
  vi.mocked(native.open).mockResolvedValueOnce(handle as unknown as native.FileHandle);
  const fs = new RealFileSystem("/sandbox");
  const descriptor = await fs.open("/file", { access: "readwrite" });
  try {
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(false);
    expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
    expect(await descriptor.read(new Uint8Array(), null)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
  expect(close).toHaveBeenCalledTimes(1);
});
