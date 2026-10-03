import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import {readRetainedJson} from "./retained-json.js";
import {prepareRetainedImageResources} from "./retained-image-resources.js";
it("does not collect a streamed data URI for an unrelated embedded-resource lookup", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {resourceFiles: fs});
  const working = {fs, directory: "/", cacheBytes: 16384}, id = "rtf-picture-1.png";
  const get = vi.fn(async (name: string) => {
    expect(name.length).toBeLessThanOrEqual(id.length);
    return name === id ? {identity: 1, chunks: async function* () {yield Uint8Array.of(137, 80, 78, 71);}} : undefined;
  });
  const bag = {count: 1, maxIdLength: id.length, get};
  const image = (url: string) => ({t: "Image", c: [["", [], []], [], [url, ""]]});
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image(id), image("data:image/png;base64," + btoa("x".repeat(65537)))]}]}))};
  const document = await readRetainedJson(input, context, working);
  try {
    const resources = await prepareRetainedImageResources(document.tree, document.order, context, working, {from: "json", to: "odt"}, {}, bag);
    try {expect(get).toHaveBeenCalledExactlyOnceWith(id);} finally {await resources.close();}
  } finally {await document.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it("reads one retained resource once across distinct image origins", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), working = {fs, directory: "/", cacheBytes: 16384};
  const id = "rtf-picture-1.png", image = {t: "Image", c: [["", [], []], [], [id, ""]]};
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image, image]}]}))};
  const chunks = vi.fn(async function* () {yield Uint8Array.of(137, 80, 78, 71);});
  const bag = {count: 1, maxIdLength: id.length, async get(name: string) {return name === id ? {identity: 1, chunks} : undefined;}};
  const document = await readRetainedJson(input, context, working), bases = new Map<number, string>();
  try {
    const resources = await prepareRetainedImageResources(document.tree, document.order, context, working, {from: "json", to: "odt"}, async node => {
      if (!bases.has(node)) bases.set(node, "/origin-" + bases.size);
      return {base: bases.get(node)!};
    }, bag);
    try {expect(bases.size).toBe(2); expect(chunks).toHaveBeenCalledOnce(); await resources.assertReferenced();}
    finally {await resources.close();}
  } finally {await document.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
