import {expect, it, vi} from "vitest";
import type {FileSystem} from "@poe-code/safe-fs/core";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert} from "./engine.js";
import type {ResourceFileSystem} from "./types.js";

it("spills extracted resources to caller storage and awaits bounded writes", async () => {
  const backing = new MemoryFileSystem();
  const open = vi.spyOn(backing, "open");
  let bytes = 0, largest = 0, pending = 0;
  const readFile = vi.fn(async () => {throw new Error("whole resource read forbidden");});
  const writeFile = vi.fn(async () => {throw new Error("whole resource write forbidden");});
  const fs: ResourceFileSystem = {
    async lstat(path) {
      if (path === "/") return {type: "directory"};
      if (path === "/image.bin") return {type: "file"};
      throw Object.assign(new Error("missing"), {code: "ENOENT"});
    },
    readFile, writeFile,
    async *readStream() {
      const reused = new Uint8Array(8192);
      for (let i = 0; i < 16; i++) {reused.fill(i); yield reused;}
    },
    async mkdir() {},
    async writeStream(path, chunks, options) {
      expect(path).toBe("/media/image.bin");
      expect(options?.flag).toBe("wx");
      for await (const chunk of chunks) {
        expect(pending++).toBe(0);
        largest = Math.max(largest, chunk.length);
        for (const byte of chunk) {if (byte !== Math.floor(bytes++ / 8192)) throw new Error("Borrowed bytes changed");}
        await Promise.resolve();
        pending--;
      }
    }
  };
  await convert([{bytes: new TextEncoder().encode("![image](image.bin)")}], {
    from: "commonmark", to: "html", extractMedia: "/media"
  }, {resourceFiles: fs, workingFiles: {fs: backing, directory: "/", cacheBytes: 16384}});
  expect(bytes).toBe(16 * 8192);
  expect(largest).toBeLessThanOrEqual(16384);
  expect(open).toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(await backing.readdir("/")).toEqual([]);
});


it.each(["source", "sink", "early return", "cancel"])("cleans retained extraction storage after %s failure", async mode => {
  const backing = new MemoryFileSystem();
  const closed = vi.fn();
  const controller = new AbortController();
  const open = backing.open.bind(backing);
  let handles = 0;
  vi.spyOn(backing, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    handles++;
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {handles--;}});
    return handle;
  });
  const fs: ResourceFileSystem = {
    async lstat(path) {
      if (path === "/") return {type: "directory"};
      if (path === "/image.bin") return {type: "file"};
      throw Object.assign(new Error("missing"), {code: "ENOENT"});
    },
    async *readStream() {
      try {
        const chunk = new Uint8Array(8192);
        for (let i = 0; i < 8; i++) yield chunk;
        if (mode === "source") throw new Error("Source failed");
      } finally {closed();}
    },
    async mkdir() {},
    async writeFile() {throw new Error("No whole writes");},
    async writeStream(_path, chunks) {
      if (mode === "early return") return;
      for await (const ignoredChunk of chunks) {
        if (mode === "cancel") controller.abort();
        else throw new Error("Sink failed");
      }
    }
  };
  await expect(convert([{bytes: new TextEncoder().encode("![image](image.bin)")}], {
    from: "commonmark", to: "html", extractMedia: "/media"
  }, {signal: controller.signal, resourceFiles: fs, workingFiles: {fs: backing, directory: "/", cacheBytes: 16384}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(closed).toHaveBeenCalledOnce();
  expect(handles).toBe(0);
  expect(await backing.readdir("/")).toEqual([]);
});

it("uses atomic streamed resource publication from the command", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document.md", new TextEncoder().encode("![image](image.bin)"));
  await fs.writeFile("/image.bin", new Uint8Array(32768).fill(73));
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  const writeFile = vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("Whole writes forbidden"));
  let received = 0;
  const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async (_path, chunks) => {
    for await (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(16384);
      for (const byte of chunk) {if (byte !== 73) throw new Error("Invalid resource bytes");}
      received += chunk.length;
      await Promise.resolve();
    }
    return {...await fs.stat("/"), type: "file", size: received};
  });
  const streamed = new Proxy(fs, {get(target, key) {
    if (key === "publishFileConditional") return publish;
    if (key === "capabilities") return {...target.capabilities, atomicFilePublication: true};
    if (key === "capabilitiesFor") return undefined;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  let error = "";
  expect(await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "--extract-media", "/media", "/document.md"],
    fs: streamed, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: {async write() {}},
    stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
  })).toEqual({exitCode: 0});
  expect(error).toBe("");
  expect(publish).toHaveBeenCalledOnce();
  expect(publish.mock.calls[0]?.[2]).toMatchObject({expected: null});
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(received).toBe(32768);
});
