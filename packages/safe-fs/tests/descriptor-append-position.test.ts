import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";
import type { FileDescriptorCapabilities, OpenFileOptions } from "../src/contracts/descriptor.js";
import { FsError } from "../src/contracts/errors.js";
import { forwardFileDescriptor, openFileDescriptor, type DescriptorBackend, type DescriptorOpenOptions } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";

const capabilities: FileDescriptorCapabilities = {
  position: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
};

function fixture() {
  const fs = createFsFromVolume(Volume.fromJSON({ "/file": "abcdef" }));
  const resource = { descriptor: -1, position: 0, append: false, closes: 0 };
  const positions: (number | null)[] = [];
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async stat(current) {
      const stat = fs.fstatSync(current.descriptor);
      return { type: "file", size: Number(stat.size), mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs) };
    },
    async getPosition(current) { return current.position; },
    async read(current, buffer, position) {
      const count = fs.readSync(current.descriptor, buffer, 0, buffer.length, position ?? current.position);
      if (position === null) current.position += count;
      return count;
    },
    async write(current, buffer, position) {
      positions.push(position);
      const offset = position ?? (current.append ? Number(fs.fstatSync(current.descriptor).size) : current.position);
      const count = fs.writeSync(current.descriptor, buffer, 0, buffer.length, offset);
      if (position === null) current.position = offset + count;
      return count;
    },
    async truncate(current, length) { fs.ftruncateSync(current.descriptor, length); },
    async sync() {},
    async close(current) { current.closes++; fs.closeSync(current.descriptor); },
  };
  const acquire = vi.fn(async (options: DescriptorOpenOptions) => {
    resource.descriptor = fs.openSync("/file", "r+");
    resource.append = options.append;
    return backend;
  });
  return { fs, resource, positions, backend, acquire };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

for (const access of ["read", "write", "readwrite"] as const) {
  for (const append of [false, true]) {
    for (const positionedAppendWrite of [undefined, false, true]) {
      for (const positionedWrite of [false, true]) {
        it(`access=${access} append=${append} optIn=${positionedAppendWrite} base=${positionedWrite}`, async () => {
          const subject = fixture();
          const selected = { ...capabilities, positionedWrite, ...(positionedAppendWrite === undefined ? {} : { positionedAppendWrite }) };
          if (access === "read" && append) {
            await expect(openFileDescriptor("/file", { access, append }, selected, subject.acquire)).rejects.toMatchObject({ code: "EINVAL" });
            expect(subject.acquire).not.toHaveBeenCalled();
            return;
          }
          const descriptor = await openFileDescriptor("/file", { access, append }, selected, subject.acquire);
          const effectiveOptIn = positionedAppendWrite === true && positionedWrite && access !== "read";
          const effectivePosition = positionedWrite && access !== "read" && (!append || effectiveOptIn);
          try {
            expect(descriptor.capabilities.positionedWrite).toBe(effectivePosition);
            expect(descriptor.capabilities.positionedAppendWrite).toBe(positionedAppendWrite === undefined ? undefined : effectiveOptIn);
            expect(Object.hasOwn(descriptor.capabilities, "positionedAppendWrite")).toBe(positionedAppendWrite !== undefined);
            for (const bytes of [new Uint8Array(), Uint8Array.of(88, 89)]) {
              if (effectivePosition) expect(await descriptor.write(bytes, 1)).toBe(bytes.length);
              else await expect(descriptor.write(bytes, 1)).rejects.toMatchObject({ code: access === "read" ? "EBADF" : append ? "EINVAL" : "ESPIPE" });
              expect(await descriptor.getPosition!()).toBe(0);
            }
            expect(subject.fs.readFileSync("/file", "utf8")).toBe(effectivePosition ? "aXYdef" : "abcdef");
            expect(subject.positions).toEqual(effectivePosition ? [1] : []);
            expect(subject.acquire).toHaveBeenCalledTimes(1);
          } finally { await descriptor.close(); }
          expect(subject.resource.closes).toBe(1);
        });
      }
    }
  }
}

it("preserves positioned offsets and cursor while sequential append uses the actual write end", async () => {
  const subject = fixture();
  const descriptor = await openFileDescriptor("/file", { access: "readwrite", append: true }, { ...capabilities, positionedAppendWrite: true }, subject.acquire);
  try {
    expect(await descriptor.read(new Uint8Array(2), null)).toBe(2);
    expect(await descriptor.write(Uint8Array.of(88), 0)).toBe(1);
    expect(await descriptor.getPosition!()).toBe(2);
    expect(subject.fs.readFileSync("/file", "utf8")).toBe("Xbcdef");
    expect(await descriptor.write(Uint8Array.of(89), null)).toBe(1);
    expect(await descriptor.getPosition!()).toBe(7);
    subject.fs.appendFileSync("/file", "zz");
    expect(await descriptor.getPosition!()).toBe(7);
    expect(await descriptor.write(new Uint8Array(), 20)).toBe(0);
    expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
    expect(await descriptor.getPosition!()).toBe(7);
    expect(await descriptor.write(Uint8Array.of(81), 1)).toBe(1);
    expect(await descriptor.getPosition!()).toBe(7);
    expect(await descriptor.write(Uint8Array.of(33), null)).toBe(1);
    expect(await descriptor.getPosition!()).toBe(10);
    expect(subject.fs.readFileSync("/file", "utf8")).toBe("XQcdefYzz!");
    expect(subject.positions).toEqual([0, null, 1, null]);
  } finally { await descriptor.close(); }
});

it.each([null, 0, 1, "true", [], {}])("rejects invalid opt-in %j before acquiring", async value => {
  const subject = fixture();
  const selected = { ...capabilities };
  Reflect.set(selected, "positionedAppendWrite", value);
  await expect(openFileDescriptor("/file", { access: "write", append: true }, selected, subject.acquire)).rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
  expect(subject.acquire).not.toHaveBeenCalled();
});

it.each([null, 0, 1, "true", [], {}])("closes acquired resources with invalid selected opt-in %j", async value => {
  const subject = fixture();
  const selected = { ...capabilities };
  Reflect.set(selected, "positionedAppendWrite", value);
  Object.defineProperty(subject.backend, "capabilities", { value: selected });
  await expect(openFileDescriptor("/file", { access: "write", append: true }, capabilities, subject.acquire)).rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
  expect(subject.acquire).toHaveBeenCalledTimes(1);
  expect(subject.resource.closes).toBe(1);
  expect(subject.positions).toEqual([]);
});

it.each(["admission", "backend"])("captures %s capabilities before mutation", async source => {
  const subject = fixture();
  const selected = { ...capabilities, positionedAppendWrite: true };
  const getter = vi.fn(() => true);
  Object.defineProperty(selected, "positionedAppendWrite", { enumerable: true, configurable: true, get: getter });
  if (source === "backend") Object.defineProperty(subject.backend, "capabilities", { value: selected });
  const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, source === "backend" ? capabilities : selected, subject.acquire);
  Object.defineProperty(selected, "positionedAppendWrite", { value: false });
  selected.positionedWrite = false;
  try {
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    expect(descriptor.capabilities.positionedAppendWrite).toBe(true);
    expect(descriptor.capabilities.positionedWrite).toBe(true);
    expect(await descriptor.write(Uint8Array.of(90), 2)).toBe(1);
    expect(subject.positions).toEqual([2]);
    expect(await descriptor.getPosition!()).toBe(0);
    expect(getter).toHaveBeenCalledTimes(1);
  } finally { await descriptor.close(); }
});

it.each([undefined, false])("selected backend opt-in %s overrides an affirmative admission ceiling", async positionedAppendWrite => {
  const subject = fixture();
  Object.defineProperty(subject.backend, "capabilities", { value: { ...capabilities, ...(positionedAppendWrite === undefined ? {} : { positionedAppendWrite }) } });
  const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, { ...capabilities, positionedAppendWrite: true }, subject.acquire);
  try {
    expect(descriptor.capabilities.positionedWrite).toBe(false);
    expect(descriptor.capabilities.positionedAppendWrite).toBe(positionedAppendWrite);
    await expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EINVAL" });
    expect(subject.positions).toEqual([]);
  } finally { await descriptor.close(); }
});

it.each([undefined, null, false, 0, ""])("cancels queued work and drains close preserving falsey reason %j", async reason => {
  const subject = fixture();
  const started = deferred<void>();
  const gate = deferred<void>();
  const originalWrite = subject.backend.write;
  subject.backend.write = async (resource, bytes, position, options) => {
    started.resolve(); await gate.promise;
    return originalWrite(resource, bytes, position, options);
  };
  const originalClose = subject.backend.close;
  subject.backend.close = async resource => { await originalClose(resource); throw reason; };
  const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, { ...capabilities, positionedAppendWrite: true }, subject.acquire);
  expect(descriptor.capabilities.positionedWrite).toBe(true);
  const first = descriptor.write(Uint8Array.of(88), 0);
  await started.promise;
  const controller = new AbortController();
  const second = descriptor.write(Uint8Array.of(89), 1, { signal: controller.signal });
  controller.abort(reason);
  const canceled = expect(second).rejects.toBe(controller.signal.reason);
  const closing = descriptor.close();
  const rejectedClose = expect(closing).rejects.toBe(reason);
  expect(descriptor.close()).toBe(closing);
  await expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EBADF" });
  expect(subject.resource.closes).toBe(0);
  gate.resolve();
  expect(await first).toBe(1);
  await canceled;
  await rejectedClose;
  expect(subject.positions).toEqual([0]);
  expect(subject.resource.position).toBe(0);
  expect(subject.resource.closes).toBe(1);
  expect(subject.fs.readFileSync("/file", "utf8")).toBe("Xbcdef");
});

it.each([undefined, null, false, 0, ""])("preserves admitted write failure %j and cancellation priority", async reason => {
  const subject = fixture();
  const started = deferred<void>();
  const gate = deferred<number>();
  subject.backend.write = async () => { started.resolve(); return gate.promise; };
  const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, { ...capabilities, positionedAppendWrite: true }, subject.acquire);
  expect(descriptor.capabilities.positionedWrite).toBe(true);
  const controller = new AbortController();
  const writing = descriptor.write(Uint8Array.of(88), 0, { signal: controller.signal });
  const outcome = writing.then(value => ({ value }), error => ({ error }));
  await started.promise;
  controller.abort(reason);
  gate.reject(new FsError("EIO"));
  try { expect(await outcome).toEqual({ error: controller.signal.reason }); }
  finally { await descriptor.close(); }
  expect(subject.positions).toEqual([]);
});

it.each([undefined, null, false, 0, ""])("preserves uncanceled positioned-write rejection %j", async reason => {
  const subject = fixture();
  subject.backend.write = async () => { throw reason; };
  const descriptor = await openFileDescriptor("/file", { access: "write", append: true }, { ...capabilities, positionedAppendWrite: true }, subject.acquire);
  try { await expect(descriptor.write(Uint8Array.of(88), 0)).rejects.toBe(reason); }
  finally { await descriptor.close(); }
});

it.each(["forward", "mount", "readonly", "readonly-mount"])("%s preserves or masks the effective write capability", async wrapper => {
  const subject = fixture();
  const selected = { ...capabilities, positionedAppendWrite: true };
  const readonly = wrapper.startsWith("readonly");
  const options: OpenFileOptions = readonly ? { access: "read" } : { access: "readwrite", append: true };
  const source = new MemoryFileSystem();
  await source.writeFile("/file", new Uint8Array(6));
  const open = vi.fn((path: string, requested: OpenFileOptions) => openFileDescriptor(path, requested, selected, subject.acquire));
  Object.defineProperty(source, "open", { value: open });
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
  const filesystem = wrapper === "readonly" ? new ReadOnlyFileSystem(source) : wrapper === "readonly-mount" ? new ReadOnlyFileSystem(mounted) : mounted;
  const descriptor = wrapper === "forward"
    ? await openFileDescriptor("/alias", options, capabilities, async () => forwardFileDescriptor(await source.open("/file", options), async (_syscall, _options, action) => action()))
    : await filesystem.open(wrapper === "readonly" ? "/file" : "/volume/file", options);
  try {
    expect(descriptor.capabilities.positionedAppendWrite).toBe(!readonly);
    expect(descriptor.capabilities.positionedWrite).toBe(!readonly);
    if (readonly) await expect(descriptor.write(Uint8Array.of(88), 0)).rejects.toMatchObject({ code: "EBADF" });
    else {
      expect(await descriptor.write(Uint8Array.of(88), 0)).toBe(1);
      expect(subject.positions).toEqual([0]);
      expect(subject.fs.readFileSync("/file", "utf8")).toBe("Xbcdef");
    }
    expect(await descriptor.getPosition!()).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
  } finally { await descriptor.close(); }
  expect(subject.resource.closes).toBe(1);
});

it("does not opt the memory provider into positioned append writes", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(1, 2));
  const descriptor = await memory.open("/file", { access: "readwrite", append: true });
  try {
    expect(Object.hasOwn(descriptor.capabilities, "positionedAppendWrite")).toBe(false);
    expect(descriptor.capabilities.positionedWrite).toBe(false);
    await expect(descriptor.write(new Uint8Array(), 0)).rejects.toMatchObject({ code: "EINVAL" });
    await expect(descriptor.write(Uint8Array.of(3), 0)).rejects.toMatchObject({ code: "EINVAL" });
    expect(await memory.readFile("/file")).toEqual(Uint8Array.of(1, 2));
    expect(await descriptor.getPosition!()).toBe(0);
  } finally { await descriptor.close(); }
});

it.each(["getPosition", "probeRead"] as const)("drains canceled %s getter materialization before rejecting publication", async method => {
  const subject = fixture();
  const controller = new AbortController();
  const cleanupStarted = deferred<void>();
  const cleanupRelease = deferred<void>();
  subject.backend.probeRead = async () => "ready";
  const originalMethod = subject.backend[method];
  const getter = vi.fn(() => { controller.abort(false); return originalMethod; });
  Object.defineProperty(subject.backend, method, { get: getter });
  const originalClose = subject.backend.close;
  subject.backend.close = async resource => {
    cleanupStarted.resolve();
    await cleanupRelease.promise;
    await originalClose(resource);
  };
  let published: Awaited<ReturnType<typeof openFileDescriptor>> | undefined;
  let settled = false;
  const opening = openFileDescriptor("/file", { access: "write", append: true, signal: controller.signal },
    { ...capabilities, positionedAppendWrite: true, readObservation: true }, subject.acquire);
  const outcome = opening.then(value => {
    published = value;
    settled = true;
    return { state: "published", value };
  }, error => {
    settled = true;
    return { state: "rejected", error };
  });
  try {
    expect(await Promise.race([outcome, cleanupStarted.promise.then(() => ({ state: "cleanup" }))])).toEqual({ state: "cleanup" });
    expect(settled).toBe(false);
    expect(subject.resource.closes).toBe(0);
    cleanupRelease.resolve();
    expect(await outcome).toEqual({ state: "rejected", error: false });
    expect(subject.resource.closes).toBe(1);
    expect(subject.positions).toEqual([]);
    expect(getter).toHaveBeenCalledTimes(1);
  } finally {
    cleanupRelease.resolve();
    await outcome;
    await published?.close();
  }
});
