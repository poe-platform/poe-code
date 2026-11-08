import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import sharp from "./index.js";

const original = Uint8Array.of(111, 108, 100);
async function fixture() {
  const fs = new MemoryFileSystem();
  const bytes = await sharp({create: {width: 7, height: 3, channels: 4, background: "red"}}).png().toBuffer();
  await fs.writeFile("/input.png", bytes);
  await fs.writeFile("/output.png", original);
  return {fs, bytes};
}
function injected(fs: MemoryFileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
  return new Proxy(fs, {get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    if (key === "readFile" || key === "writeFile") return async () => {throw new Error("whole-file fallback forbidden");};
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}

it.each(["staged", "conditional"])("preserves the destination until complete %s publication and performs no whole-file I/O", async mode => {
  const {fs} = await fixture();
  let publications = 0;
  const capabilities = {...fs.capabilities, atomicFilePublication: mode === "conditional"};
  const overrides: Partial<FileSystem> = {capabilities, capabilitiesFor: async () => capabilities};
  if (mode === "conditional") overrides.publishFileConditional = async (path, source, options) => {
    const chunks: Uint8Array[] = [];
    for await (const bytes of source) {
      expect(await fs.readFile(path)).toEqual(original);
      chunks.push(new Uint8Array(bytes));
    }
    publications++;
    return fs.writeFileConditional(path, Buffer.concat(chunks), options);
  };
  else overrides.publishStagedFile = async (staging, path, options) => {
    expect(await fs.readFile(path)).toEqual(original);
    publications++;
    await fs.publishStagedFile(staging, path, options);
  };
  const info = await sharp("/input.png", {filesystem: injected(fs, overrides)}).png().toFile("/output.png");
  expect(publications).toBe(1);
  expect(info).toMatchObject({format: "png", width: 7, height: 3, channels: 4});
  const output = await fs.readFile("/output.png");
  expect(info.size).toBe(output.length);
  expect([...await sharp(output).raw().toBuffer()]).toEqual(Array.from({length: 21}, () => [255, 0, 0, 255]).flat());
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it.each([0, 4])("rejects publisher return after only %i output chunks without changing the destination", async consumed => {
  const {fs} = await fixture();
  const capabilities = {...fs.capabilities, atomicFilePublication: true};
  const filesystem = injected(fs, {capabilities, capabilitiesFor: async () => capabilities, publishFileConditional: async (path, source) => {
    const iterator = source[Symbol.asyncIterator]();
    for (let index = 0; index < consumed; index++) expect((await iterator.next()).done).toBe(false);
    return fs.stat(path);
  }});
  await expect(sharp("/input.png", {filesystem}).png().toFile("/output.png")).rejects.toMatchObject({code: "EIO"});
  expect(await fs.readFile("/output.png")).toEqual(original);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it.each(["staged", "conditional"])("preserves a concurrent destination replacement when %s publication loses its comparison", async mode => {
  const {fs} = await fixture();
  const raced = Uint8Array.of(114, 97, 99, 101);
  const capabilities = {...fs.capabilities, atomicFilePublication: mode === "conditional"};
  const overrides: Partial<FileSystem> = {capabilities, capabilitiesFor: async () => capabilities};
  if (mode === "conditional") overrides.publishFileConditional = async (path, source, options) => {
    const chunks: Uint8Array[] = [];
    for await (const bytes of source) chunks.push(new Uint8Array(bytes));
    await fs.writeFile(path, raced);
    return fs.writeFileConditional(path, Buffer.concat(chunks), options);
  };
  else overrides.publishStagedFile = async (staging, path, options) => {
    await fs.writeFile(path, raced);
    await fs.publishStagedFile(staging, path, options);
  };
  await expect(sharp("/input.png", {filesystem: injected(fs, overrides)}).png().toFile("/output.png")).rejects.toMatchObject({code: "EAGAIN"});
  expect(await fs.readFile("/output.png")).toEqual(raced);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it("accepts short retained reads and closes without using pathname input", async () => {
  const {fs} = await fixture();
  const close = vi.fn();
  const filesystem = injected(fs, {openReadFile: async (path, options) => {
    const handle = await fs.openReadFile(path, options);
    return {
      stat: handle.stat.bind(handle),
      read: (position, maximum, options) => handle.read(position, Math.min(3, maximum), options),
      async close() {close(); await handle.close();}
    };
  }});
  expect(await sharp("/input.png", {filesystem}).png().toFile("/output.png")).toMatchObject({width: 7, height: 3});
  expect(close).toHaveBeenCalledTimes(1);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it("preserves the destination on a malformed PNG input and retires its source handle", async () => {
  const {fs, bytes} = await fixture();
  await fs.writeFile("/input.png", bytes.subarray(0, 34));
  const close = vi.fn();
  const filesystem = injected(fs, {openReadFile: async (path, options) => {
    const handle = await fs.openReadFile(path, options);
    return {stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() {close(); await handle.close();}};
  }});
  await expect(sharp("/input.png", {filesystem}).png().toFile("/output.png")).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readFile("/output.png")).toEqual(original);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it.each(["identity", "version"])("rejects source %s drift before publishing and retires its handle", async kind => {
  const {fs} = await fixture();
  const close = vi.fn();
  const filesystem = injected(fs, {openReadFile: async (path, options) => {
    const handle = await fs.openReadFile(path, options);
    let stats = 0;
    return {
      async stat(options) {
        const stat = await handle.stat(options);
        return stats++ === 0 ? stat : kind === "identity" ? {...stat, ino: stat.ino! + 1} : {...stat, mtimeMs: stat.mtimeMs + 1};
      },
      read: handle.read.bind(handle),
      async close() {close(); await handle.close();}
    };
  }});
  await expect(sharp("/input.png", {filesystem}).png().toFile("/output.png")).rejects.toMatchObject({code: "EAGAIN"});
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readFile("/output.png")).toEqual(original);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it("preserves cancellation after retained source acquisition and closes the acquired handle", async () => {
  const {fs} = await fixture();
  const controller = new AbortController();
  const reason = {cancel: "source acquired"};
  const close = vi.fn();
  const filesystem = injected(fs, {openReadFile: async (path, options) => {
    const handle = await fs.openReadFile(path, options);
    controller.abort(reason);
    return {stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() {close(); await handle.close();}};
  }});
  await expect(sharp("/input.png", {filesystem, signal: controller.signal}).png().toFile("/output.png")).rejects.toBe(reason);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readFile("/output.png")).toEqual(original);
});

it("retires staging acquired just before cancellation without publishing it", async () => {
  const {fs} = await fixture();
  const controller = new AbortController();
  const reason = {cancel: "staging acquired"};
  const filesystem = injected(fs, {createStagedFile: async (...args) => {
    const staging = await fs.createStagedFile(...args);
    controller.abort(reason);
    return staging;
  }});
  await expect(sharp("/input.png", {filesystem, signal: controller.signal}).png().toFile("/output.png")).rejects.toBe(reason);
  expect(await fs.readFile("/output.png")).toEqual(original);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input.png", "output.png"]);
});

it("rejects input/output hardlink aliases before publication", async () => {
  const {fs, bytes} = await fixture();
  await fs.rm("/output.png");
  await fs.link("/input.png", "/output.png");
  await expect(sharp("/input.png", {filesystem: injected(fs)}).png().toFile("/output.png")).rejects.toThrow("same file");
  expect(await fs.readFile("/input.png")).toEqual(bytes);
  expect(await fs.readFile("/output.png")).toEqual(bytes);
});

it("checks the effective PNG dimensions before allocating pixel storage", async () => {
  const {fs, bytes} = await fixture();
  // The legacy metadata parser uses the final IHDR; the streaming path must
  // enforce the same pixel budget even when the first header advertises 1x1.
  const small = bytes.slice(8,33);
  const view = new DataView(small.buffer);
  view.setUint32(8,1); view.setUint32(12,1);
  await fs.writeFile("/input.png", Buffer.concat([bytes.subarray(0,8),small,bytes.subarray(8)]));
  const opened = vi.fn(fs.open.bind(fs));
  await expect(sharp("/input.png", {filesystem:injected(fs,{open:opened}),limitInputPixels:1}).png().toFile("/output.png")).rejects.toThrow("pixel limit");
  expect(opened).not.toHaveBeenCalled();
  expect(await fs.readFile("/output.png")).toEqual(original);
});
