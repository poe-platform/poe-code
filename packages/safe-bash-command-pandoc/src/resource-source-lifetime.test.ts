import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import type {ResourceFileSystem} from "./types.js";

it.each(["rtf", "odt", "extract"].flatMap(to =>
  ["factory-cancel", "pending-cancel", "factory-throw"].map(mode => ({to, mode}))))(
  "owns filesystem image streams for $to during $mode", async ({to, mode}) => {
    const backing = new MemoryFileSystem(), controller = new AbortController();
    let releasePull: ((part: IteratorResult<Uint8Array>) => void) | undefined;
    const next = vi.fn(() => {
      controller.abort();
      return new Promise<IteratorResult<Uint8Array>>(resolve => {releasePull = resolve;});
    });
    const returned = vi.fn(async () => {
      releasePull?.({done: true, value: undefined});
      return {done: true as const, value: undefined};
    });
    const readStream = vi.fn(() => {
      if (mode === "factory-throw") throw new Error("Source factory failed");
      if (mode === "factory-cancel") controller.abort();
      return {[Symbol.asyncIterator]: () => ({next, return: returned})};
    });
    const readFile = vi.fn(async () => {throw new Error("Full image reads forbidden");});
    const write = vi.fn(async () => {}), close = vi.fn(async () => {});
    const writeStream = vi.fn(async () => {});
    const fs: ResourceFileSystem = {
      async lstat(path) {
        if (path === "/") return {type: "directory"};
        if (path === "/image.png") return {type: "file"};
        throw Object.assign(new Error("missing"), {code: "ENOENT"});
      },
      readStream, readFile, writeStream, async mkdir() {}, async writeFile() {}
    };
    const input = {bytes: new TextEncoder().encode(JSON.stringify({
      "pandoc-api-version": [1,23,1,2], meta: {},
      blocks: [{t: "Para", c: [{t: "Image", c: [["",[],[]], [], ["image.png", ""]]}]}]
    }))};
    const context = {
      signal: controller.signal, resourceFiles: fs,
      workingFiles: {fs: backing, directory: "/", cacheBytes: 16384},
      output: {write, close, async abort() {}}
    };
    const pending = to === "extract"
      ? convert([input], {from: "json", to: "html5", extractMedia: "/media"}, context)
      : convertToOutput([input], {from: "json", to}, context);
    await expect(pending).rejects.toMatchObject({code: mode === "factory-throw" ? "E_IO" : "E_CANCELLED"});
    expect(readStream).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(mode === "pending-cancel" ? 1 : 0);
    expect(returned).toHaveBeenCalledTimes(mode === "factory-throw" ? 0 : 1);
    expect(readFile).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(writeStream).not.toHaveBeenCalled();
    expect(await backing.readdir("/")).toEqual([]);
  }
);
