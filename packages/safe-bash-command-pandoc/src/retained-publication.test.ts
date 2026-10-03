import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import type {FileSystem} from "@poe-code/safe-fs/core";
import {convertToOutput} from "./engine.js";
import {createFileOutput} from "./file-output.js";
const encoder = new TextEncoder();

it.each([["json", "rst"], ["csv", "rst"], ["json", "gfm"], ["json", "commonmark"], ["json", "json"], ["json", "plain"], ["json", "html"], ["csv", "json"], ["csv", "plain"], ["csv", "html"], ["csv", "html5"]]
  .flatMap(([from, to]) => ["failure", "cancel"].map(mode => ({from: from!, to: to!, mode}))))(
  "keeps atomic $from to $to output uncommitted on source retirement $mode", async ({from, to, mode}) => {
    const fs = new MemoryFileSystem(), controller = new AbortController();
    await fs.mkdir("/spill"); await fs.writeFile("/result", encoder.encode("original"));
    const expected = await fs.stat("/result"), parent = await fs.stat("/");
    let emitted = false, opened = 0, live = 0, cleanupFailures = 0;
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), ordinal = ++opened; live++;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async options => {
        try {await close(options);} finally {live--;}
        if (ordinal === 1 && emitted) {
          cleanupFailures++;
          if (mode === "cancel") controller.abort();
          else throw new Error("Retained source retirement failed");
        }
      });
      return handle;
    });
    // A contract-faithful test publisher: private staging becomes visible only at
    // EOF. Aborting the byte pipe rejects iteration and leaves the old file intact.
    const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async (path, source) => {
      let staged = "";
      for await (const bytes of source) staged += new TextDecoder().decode(bytes);
      await fs.writeFile(path, encoder.encode(staged));
      return fs.stat(path);
    });
    const files = new Proxy(fs, {get(target, key) {
      if (key === "capabilities") return {...target.capabilities, atomicFilePublication: true};
      if (key === "capabilitiesFor") return undefined;
      if (key === "publishFileConditional") return publish;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    const output = createFileOutput(files, "/result", {expected, parent, maxBytes: 1048576});
    const write = output.write.bind(output);
    vi.spyOn(output, "write").mockImplementation(async (...args) => {await write(...args); emitted = true;});
    const commit = vi.spyOn(output, "close"), abort = vi.spyOn(output, "abort");
    const text = "x".repeat(65536);
    const bytes = encoder.encode(from === "csv" ? "head\n" + text : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "CodeBlock", c: [["",[],[]], text]}]}));
    await expect(convertToOutput([{bytes}], {from, to, ...(to === "html5" ? {standalone: true} : {})}, {signal: controller.signal, workingFiles: {fs, directory: "/spill", cacheBytes: 16384}, output}))
      .rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
    expect(emitted).toBe(true); expect(cleanupFailures).toBe(1);
    expect(commit).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(await fs.readFile("/result"))).toBe("original");
    expect(live).toBe(0); expect(await fs.readdir("/spill")).toEqual([]);
  }
);
