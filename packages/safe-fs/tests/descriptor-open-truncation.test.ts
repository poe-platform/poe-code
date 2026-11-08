import { describe, expect, it, vi } from "vitest";
import type { FileDescriptorCapabilities, OpenFileOptions } from "../src/contracts/descriptor.js";
import { openFileDescriptor, type DescriptorBackend } from "../src/fs/descriptor.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";

const capabilities: FileDescriptorCapabilities = {
  positionedRead: false, positionedWrite: false, truncate: false, synchronization: "none",
};

function backend(): DescriptorBackend<object> {
  return {
    resource: {},
    async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read() { return 0; }, async write(_resource, bytes) { return bytes.length; },
    truncate: vi.fn(async () => {}), async sync() {}, close: vi.fn(async () => {}),
  };
}

it("accepts open truncation without granting or performing ftruncate", async () => {
  const retained = backend();
  const acquire = vi.fn(async (options: OpenFileOptions) => { expect(options.truncate).toBe(true); return retained; });
  const descriptor = await openFileDescriptor("/node", { access: "write", truncate: true }, { ...capabilities, openTruncate: true }, acquire);
  try {
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(descriptor.capabilities).toEqual({ ...capabilities, openTruncate: true });
    expect((await descriptor.stat()).type).toBe("character");
    await expect(descriptor.truncate(0)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "ftruncate" });
    expect(retained.truncate).not.toHaveBeenCalled();
  } finally { await descriptor.close(); }
});

it("an explicit false blocks open truncation without removing ftruncate support", async () => {
  const acquire = vi.fn(async () => backend());
  const selected = { ...capabilities, truncate: true, openTruncate: false };
  await expect(openFileDescriptor("/node", { access: "write", truncate: true }, selected, acquire)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "open" });
  expect(acquire).not.toHaveBeenCalled();
  const descriptor = await openFileDescriptor("/node", { access: "write" }, selected, acquire);
  try { await descriptor.truncate(0); expect(descriptor.capabilities.truncate).toBe(true); }
  finally { await descriptor.close(); }
});

it.each([false, true])("omission preserves truncate=%s admission and capability shape", async truncate => {
  const selected = { ...capabilities, truncate };
  const acquire = vi.fn(async () => backend());
  if (!truncate) {
    await expect(openFileDescriptor("/node", { access: "write", truncate: true }, selected, acquire)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(acquire).not.toHaveBeenCalled();
  }
  const descriptor = await openFileDescriptor("/node", { access: "write", truncate }, selected, acquire);
  try { expect(descriptor.capabilities).toEqual(selected); expect(Object.hasOwn(descriptor.capabilities, "openTruncate")).toBe(false); }
  finally { await descriptor.close(); }
});

it("validates selected backend open admission and closes on refusal", async () => {
  const retained = backend();
  Object.defineProperty(retained, "capabilities", { value: { ...capabilities, openTruncate: false } });
  await expect(openFileDescriptor("/node", { access: "write", truncate: true }, { ...capabilities, openTruncate: true }, async () => retained))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  expect(retained.close).toHaveBeenCalledTimes(1);
});

describe.each(["readObservation", "openTruncate"])("%s capability validation", field => {
  it.each([null, 0, 1, "true", {}])("rejects %j before acquisition", async value => {
    const selected = { ...capabilities };
    Reflect.set(selected, field, value);
    const acquire = vi.fn(async () => backend());
    await expect(openFileDescriptor("/node", { access: "write" }, selected, acquire)).rejects.toMatchObject({ code: "EINVAL" });
    expect(acquire).not.toHaveBeenCalled();
  });
  it("validates acquired capability changes and releases the resource", async () => {
    const retained = backend();
    const selected = { ...capabilities };
    Reflect.set(selected, field, "true");
    Object.defineProperty(retained, "capabilities", { value: selected });
    await expect(openFileDescriptor("/node", { access: "write" }, capabilities, async () => retained)).rejects.toMatchObject({ code: "EINVAL" });
    expect(retained.close).toHaveBeenCalledTimes(1);
  });
});

it("does not grant read-only opens a truncate flag", async () => {
  const acquire = vi.fn(async () => backend());
  await expect(openFileDescriptor("/node", { access: "read", truncate: true }, { ...capabilities, openTruncate: true }, acquire))
    .rejects.toMatchObject({ code: "EINVAL" });
  expect(acquire).not.toHaveBeenCalled();
});

it("mount forwarding accepts the acquired resource's open-only capability", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/node", new Uint8Array());
  const retained = backend();
  const open = vi.fn(async (path: string, options: OpenFileOptions) =>
    openFileDescriptor(path, options, { ...capabilities, openTruncate: true }, async () => retained));
  Object.defineProperty(source, "open", { value: open });
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
  const descriptor = await mounted.open("/volume/node", { access: "write", truncate: true });
  try {
    expect(descriptor.capabilities.openTruncate).toBe(true);
    expect(descriptor.capabilities.truncate).toBe(false);
    await expect(descriptor.truncate(0)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).toHaveBeenCalledTimes(1);
  } finally { await descriptor.close(); }
  expect(retained.close).toHaveBeenCalledTimes(1);
});

it.each(["readonly", "readonly-mount"])("%s masks openTruncate but preserves observation", async wrapper => {
  const source = new MemoryFileSystem();
  await source.writeFile("/node", new Uint8Array());
  const retained = backend();
  retained.probeRead = async () => "ready";
  const open = vi.fn(async (path: string, options: OpenFileOptions) =>
    openFileDescriptor(path, options, { ...capabilities, openTruncate: true, readObservation: true }, async () => retained));
  Object.defineProperty(source, "open", { value: open });
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/volume": source } });
  const readonly = new ReadOnlyFileSystem(wrapper === "readonly" ? source : mounted);
  const path = wrapper === "readonly" ? "/node" : "/volume/node";
  const descriptor = await readonly.open(path, { access: "read" });
  try {
    expect(descriptor.capabilities.openTruncate).toBe(false);
    expect(descriptor.capabilities.truncate).toBe(false);
    expect(descriptor.capabilities.readObservation).toBe(true);
    expect(await descriptor.probeRead!()).toBe("ready");
    await expect(readonly.open(path, { access: "write", truncate: true })).rejects.toMatchObject({ code: "EROFS" });
    expect(open).toHaveBeenCalledTimes(1);
  } finally { await descriptor.close(); }
  expect(retained.close).toHaveBeenCalledTimes(1);
});

it("readonly preserves the legacy shape when both new fields are omitted", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array());
  const readonly = new ReadOnlyFileSystem(memory);
  const descriptor = await readonly.open("/file", { access: "read" });
  try {
    expect(Object.hasOwn(descriptor.capabilities, "openTruncate")).toBe(false);
    expect(Object.hasOwn(descriptor.capabilities, "readObservation")).toBe(false);
  } finally { await descriptor.close(); }
});
