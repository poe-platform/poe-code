import { expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileDescriptor, FileDescriptorCapabilities } from "../src/contracts/descriptor.js";
import { openFileDescriptor, type DescriptorBackend } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

const capabilities: FileDescriptorCapabilities = {
  position: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function fixture() {
  const resource = { position: 7, live: true };
  const write = vi.fn<DescriptorBackend<typeof resource>["write"]>(async (current, bytes, position) => {
    expect(current.live).toBe(true);
    if (position === null) current.position += bytes.byteLength;
    return bytes.byteLength;
  });
  const read = vi.fn<DescriptorBackend<typeof resource>["read"]>(async () => 0);
  const close = vi.fn<DescriptorBackend<typeof resource>["close"]>(async current => { current.live = false; });
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async getPosition(current) { return current.position; },
    read, write, close,
    async truncate() {},
    async sync() {},
  };
  return { resource, backend, write, read, close };
}

for (const access of ["write", "readwrite"] as const) {
  it.each([true, false, undefined])(`zero writes: ${access}, delegate=%s`, async delegation => {
    const subject = fixture();
    const selected = { ...capabilities, ...(delegation === undefined ? {} : { delegateZeroLengthWrite: delegation }) };
    const descriptor = await openFileDescriptor("/node", { access }, selected, async () => subject.backend);
    try {
      const empty = new Uint8Array();
      expect(await descriptor.write(empty, null)).toBe(0);
      expect(await descriptor.write(empty, 3)).toBe(0);
      expect(subject.write).toHaveBeenCalledTimes(delegation === true ? 2 : 0);
      if (delegation === true) {
        expect(subject.write).toHaveBeenNthCalledWith(1, subject.resource, empty, null, {});
        expect(subject.write).toHaveBeenNthCalledWith(2, subject.resource, empty, 3, {});
      }
      expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(delegation !== undefined);
      if (delegation !== undefined) expect(descriptor.capabilities).toMatchObject({ delegateZeroLengthWrite: delegation });
      expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
      expect(await descriptor.getPosition!()).toBe(7);
    } finally { await descriptor.close(); }
    expect(subject.close).toHaveBeenCalledTimes(1);
  });
}

it.each([true, false, undefined])("read-only masks delegate=%s without changing empty reads or write denial", async delegation => {
  const subject = fixture();
  const selected = { ...capabilities, ...(delegation === undefined ? {} : { delegateZeroLengthWrite: delegation }) };
  const descriptor = await openFileDescriptor("/node", { access: "read" }, selected, async () => subject.backend);
  try {
    expect(await descriptor.read(new Uint8Array(), null)).toBe(0);
    expect(await descriptor.read(new Uint8Array(), 3)).toBe(0);
    expect(subject.read).not.toHaveBeenCalled();
    await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
    await expect(descriptor.write(new Uint8Array(), -1)).rejects.toMatchObject({ code: "EBADF" });
    expect(subject.write).not.toHaveBeenCalled();
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(delegation !== undefined);
    if (delegation !== undefined) expect(descriptor.capabilities).toMatchObject({ delegateZeroLengthWrite: false });
  } finally { await descriptor.close(); }
});

it("does not auto-enable an existing memory provider", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1, 2, 3));
  const descriptor = await fs.open("/file", { access: "readwrite" });
  try {
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(false);
    expect(await descriptor.write(new Uint8Array(), 20)).toBe(0);
    expect(await descriptor.getPosition!()).toBe(0);
    expect((await descriptor.stat()).size).toBe(3);
  } finally { await descriptor.close(); }
});

it.each([
  { admitted: true, selected: false },
  { admitted: true, selected: undefined },
  { admitted: false, selected: true },
  { admitted: undefined, selected: true },
])("acquired capabilities override admission: $admitted -> $selected", async entry => {
  const subject = fixture();
  const admitted = { ...capabilities, ...(entry.admitted === undefined ? {} : { delegateZeroLengthWrite: entry.admitted }) };
  const selected = { ...capabilities, ...(entry.selected === undefined ? {} : { delegateZeroLengthWrite: entry.selected }) };
  const descriptor = await openFileDescriptor("/node", { access: "write" }, admitted, async () => ({ ...subject.backend, capabilities: selected }));
  try {
    expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
    expect(subject.write).toHaveBeenCalledTimes(entry.selected === true ? 1 : 0);
    expect(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite")).toBe(entry.selected !== undefined);
    if (entry.selected !== undefined) expect(descriptor.capabilities).toMatchObject({ delegateZeroLengthWrite: entry.selected });
  } finally { await descriptor.close(); }
});

it("captures admitted and selected capability getters once, before later mutation", async () => {
  const subject = fixture();
  let requestedValue = false;
  let selectedValue = true;
  const requestedGetter = vi.fn(() => requestedValue);
  const selectedGetter = vi.fn(() => selectedValue);
  const admitted = Object.defineProperty({ ...capabilities }, "delegateZeroLengthWrite", { enumerable: true, get: requestedGetter });
  const selected = Object.defineProperty({ ...capabilities }, "delegateZeroLengthWrite", { enumerable: true, get: selectedGetter });
  const backendGetter = vi.fn(() => selected);
  Object.defineProperty(subject.backend, "capabilities", { get: backendGetter });
  const descriptor = await openFileDescriptor("/node", { access: "write" }, admitted, async () => subject.backend);
  requestedValue = true;
  selectedValue = false;
  try {
    expect(requestedGetter).toHaveBeenCalledTimes(1);
    expect(selectedGetter).toHaveBeenCalledTimes(1);
    expect(backendGetter).toHaveBeenCalledTimes(1);
    expect(await descriptor.write(new Uint8Array(), null)).toBe(0);
    expect(await descriptor.write(new Uint8Array(), 3)).toBe(0);
    expect(subject.write).toHaveBeenCalledTimes(2);
    expect(descriptor.capabilities).toMatchObject({ delegateZeroLengthWrite: true });
    expect(selectedGetter).toHaveBeenCalledTimes(1);
  } finally { await descriptor.close(); }
});

it.each([null, 0, 1, "true", [], {}].map(value => ({ value })))("rejects invalid requested delegate=$value before acquisition", async ({ value }) => {
  const subject = fixture();
  const selected = { ...capabilities, ...{ delegateZeroLengthWrite: value } } as FileDescriptorCapabilities;
  const acquire = vi.fn(async () => subject.backend);
  let descriptor: FileDescriptor | undefined;
  try {
    await expect(openFileDescriptor("/node", { access: "write" }, selected, acquire).then(result => {
      descriptor = result;
      return result;
    })).rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
    expect(acquire).not.toHaveBeenCalled();
    expect(subject.close).not.toHaveBeenCalled();
  } finally { await descriptor?.close(); }
});

it.each([null, 0, 1, "true", [], {}].map(value => ({ value })))("invalid acquired delegate=$value closes retained resource once", async ({ value }) => {
  const subject = fixture();
  const selected = { ...capabilities, ...{ delegateZeroLengthWrite: value } } as FileDescriptorCapabilities;
  let descriptor: FileDescriptor | undefined;
  try {
    await expect(openFileDescriptor("/node", { access: "write" }, capabilities, async () => ({
      ...subject.backend, capabilities: selected,
    })).then(result => {
      descriptor = result;
      return result;
    })).rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
    expect(subject.close).toHaveBeenCalledTimes(1);
    expect(subject.resource.live).toBe(false);
    expect(subject.write).not.toHaveBeenCalled();
  } finally { await descriptor?.close(); }
});

it("invalid acquired capability waits for cleanup and preserves EINVAL over falsey close failure", async () => {
  const subject = fixture();
  const entered = deferred<void>();
  const gate = deferred<void>();
  subject.close.mockImplementation(async current => {
    entered.resolve();
    await gate.promise;
    current.live = false;
    throw false;
  });
  const selected = { ...capabilities };
  Reflect.set(selected, "delegateZeroLengthWrite", "true");
  let published: FileDescriptor | undefined;
  let settled = false;
  const opening = openFileDescriptor("/node", { access: "write" }, capabilities, async () => ({ ...subject.backend, capabilities: selected }));
  const observed = opening.then(descriptor => { published = descriptor; settled = true; }, () => { settled = true; });
  try {
    expect(await Promise.race([entered.promise.then(() => true), observed.then(() => false)])).toBe(true);
    expect(settled).toBe(false);
    gate.resolve();
    await expect(opening).rejects.toMatchObject({ code: "EINVAL", syscall: "open" });
    expect(subject.close).toHaveBeenCalledTimes(1);
    expect(subject.resource.live).toBe(false);
  } finally { gate.resolve(); await observed; await published?.close().catch(() => {}); }
});

it.each([false, 0])("acquired capability getter failure retains falsey identity=%s and drains cleanup", async reason => {
  const subject = fixture();
  const gate = deferred<void>();
  const entered = deferred<void>();
  subject.close.mockImplementation(async current => {
    entered.resolve();
    await gate.promise;
    current.live = false;
  });
  const selected = Object.defineProperty({ ...capabilities }, "delegateZeroLengthWrite", {
    enumerable: true, get() { throw reason; },
  });
  let settled = false;
  const opening = openFileDescriptor("/node", { access: "write" }, capabilities, async () => ({ ...subject.backend, capabilities: selected }));
  const observed = opening.then(() => { settled = true; }, () => { settled = true; });
  try {
    expect(await Promise.race([entered.promise.then(() => true), observed.then(() => false)])).toBe(true);
    expect(settled).toBe(false);
    gate.resolve();
    await expect(opening).rejects.toBe(reason);
    expect(subject.close).toHaveBeenCalledTimes(1);
    expect(subject.resource.live).toBe(false);
  } finally { gate.resolve(); await observed; }
});

it.each([true, false, undefined])("nonempty partial writes remain unchanged for delegate=%s", async delegation => {
  const subject = fixture();
  subject.write.mockImplementation(async (current, bytes, position) => {
    const count = Math.min(2, bytes.byteLength);
    if (position === null) current.position += count;
    return count;
  });
  const selected = { ...capabilities, ...(delegation === undefined ? {} : { delegateZeroLengthWrite: delegation }) };
  const descriptor = await openFileDescriptor("/node", { access: "write" }, selected, async () => subject.backend);
  try {
    const bytes = Uint8Array.of(1, 2, 3, 4, 5);
    expect(await descriptor.write(bytes, null)).toBe(2);
    expect(await descriptor.write(bytes, 3)).toBe(2);
    expect(await descriptor.getPosition!()).toBe(9);
    expect(subject.write).toHaveBeenCalledTimes(2);
    expect(subject.write.mock.calls[0]![1]).toBe(bytes);
    expect(bytes).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  } finally { await descriptor.close(); }
});

it.each(["write", "readwrite"] as const)("delegated empty EPERM is preserved and does not poison later writes: %s", async access => {
  const subject = fixture();
  const failure = new FsError("EPERM", { syscall: "write", path: "/node" });
  subject.write.mockRejectedValueOnce(failure);
  const descriptor = await openFileDescriptor("/node", { access }, { ...capabilities, ...{ delegateZeroLengthWrite: true } }, async () => subject.backend);
  try {
    await expect(descriptor.write(new Uint8Array(), null)).rejects.toBe(failure);
    expect(await descriptor.getPosition!()).toBe(7);
    expect(await descriptor.write(Uint8Array.of(1), null)).toBe(1);
    expect(subject.write).toHaveBeenCalledTimes(2);
  } finally { await descriptor.close(); }
});

it.each([1, -1, 0.5, NaN, Infinity])("delegated empty writes reject invalid returned count=%s", async count => {
  const subject = fixture();
  subject.write.mockResolvedValueOnce(count);
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...capabilities, ...{ delegateZeroLengthWrite: true } }, async () => subject.backend);
  try {
    await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EIO", syscall: "write" });
    expect(subject.write).toHaveBeenCalledTimes(1);
    expect(await descriptor.getPosition!()).toBe(7);
  } finally { await descriptor.close(); }
});

it("delegation does not bypass argument, position, access, closed or signal checks", async () => {
  const subject = fixture();
  const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...capabilities, ...{ delegateZeroLengthWrite: true } }, async () => subject.backend);
  try {
    await expect(descriptor.read(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
    await expect(descriptor.write([] as unknown as Uint8Array, null)).rejects.toMatchObject({ code: "EINVAL" });
    for (const position of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(descriptor.write(new Uint8Array(), position)).rejects.toMatchObject({ code: "EINVAL" });
    }
    await descriptor.close();
    await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
    const controller = new AbortController();
    controller.abort(false);
    await expect(descriptor.write(new Uint8Array(), null, { signal: controller.signal })).rejects.toBe(false);
    expect(subject.write).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
  expect(subject.close).toHaveBeenCalledTimes(1);
});

it("empty delegation does not grant positioned-write capability", async () => {
  const subject = fixture();
  const descriptor = await openFileDescriptor("/node", { access: "write" }, {
    ...capabilities, positionedWrite: false, ...{ delegateZeroLengthWrite: true },
  }, async () => subject.backend);
  try {
    await expect(descriptor.write(new Uint8Array(), 3)).rejects.toMatchObject({ code: "ESPIPE" });
    expect(subject.write).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

it.each([false, true])("positioned append admission remains independent of empty delegation: %s", async positionedAppendWrite => {
  const subject = fixture();
  const descriptor = await openFileDescriptor("/node", { access: "write", append: true }, {
    ...capabilities, ...{ positionedAppendWrite, delegateZeroLengthWrite: true },
  }, async () => subject.backend);
  try {
    if (positionedAppendWrite) {
      expect(await descriptor.write(new Uint8Array(), 3)).toBe(0);
      expect(subject.write).toHaveBeenCalledTimes(1);
      expect(subject.write.mock.calls[0]![2]).toBe(3);
    } else {
      await expect(descriptor.write(new Uint8Array(), 3)).rejects.toMatchObject({ code: "EINVAL" });
      expect(subject.write).not.toHaveBeenCalled();
    }
    expect(await descriptor.getPosition!()).toBe(7);
  } finally { await descriptor.close(); }
});

for (const reason of [false, 0]) {
  for (const backendFailure of [false, true]) {
    it(`admitted empty write drains before close; cancellation=${String(reason)}, backendFailure=${backendFailure}`, async () => {
      const subject = fixture();
      const entered = deferred<void>();
      const gate = deferred<number>();
      subject.write.mockImplementation(async () => { entered.resolve(); return gate.promise; });
      const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...capabilities, ...{ delegateZeroLengthWrite: true } }, async () => subject.backend);
      const controller = new AbortController();
      const writing = descriptor.write(new Uint8Array(), null, { signal: controller.signal });
      const observed = writing.then(() => {}, () => {});
      try {
        expect(await Promise.race([entered.promise.then(() => true), observed.then(() => false)])).toBe(true);
        expect(subject.write.mock.calls[0]![3].signal).toBe(controller.signal);
        controller.abort(reason);
        const closing = descriptor.close();
        expect(descriptor.close()).toBe(closing);
        await expect(descriptor.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
        expect(subject.close).not.toHaveBeenCalled();
        expect(subject.resource.live).toBe(true);
        if (backendFailure) gate.reject(new FsError("EPERM"));
        else gate.resolve(0);
        await expect(writing).rejects.toBe(reason);
        await closing;
        expect(subject.close).toHaveBeenCalledTimes(1);
        expect(subject.resource.live).toBe(false);
      } finally {
        gate.resolve(0);
        await observed;
        await descriptor.close();
      }
    });
  }

  it(`queued canceled empty write never enters the backend: ${String(reason)}`, async () => {
    const subject = fixture();
    const gate = deferred<number>();
    const entered = deferred<void>();
    subject.write.mockImplementationOnce(async () => { entered.resolve(); return gate.promise; });
    const descriptor = await openFileDescriptor("/node", { access: "write" }, { ...capabilities, ...{ delegateZeroLengthWrite: true } }, async () => subject.backend);
    const first = descriptor.write(Uint8Array.of(1), null);
    await entered.promise;
    const controller = new AbortController();
    const second = descriptor.write(new Uint8Array(), null, { signal: controller.signal });
    const observed = second.then(() => {}, () => {});
    try {
      controller.abort(reason);
      const closing = descriptor.close();
      expect(subject.close).not.toHaveBeenCalled();
      gate.resolve(1);
      expect(await first).toBe(1);
      await expect(second).rejects.toBe(reason);
      await closing;
      expect(subject.write).toHaveBeenCalledTimes(1);
      expect(subject.close).toHaveBeenCalledTimes(1);
    } finally { gate.resolve(1); await first; await observed; await descriptor.close(); }
  });
}
