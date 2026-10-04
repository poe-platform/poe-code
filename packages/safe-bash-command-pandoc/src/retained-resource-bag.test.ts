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


it.each([4097, 65537])("does not reread or recopy a %i-unit target on repeated lookup", async units => {
  const fs = new MemoryFileSystem(), resolveSource = vi.fn(async function* () {yield Uint8Array.of(1, 2, 3);});
  const context = new ExecutionContext("convert", {resources: {resolveSource}}), working = {fs, directory: "/", cacheBytes: 16384};
  const id = "x".repeat(units), image = {t: "Image", c: [["", [], []], [], [id, ""]]};
  const document = await readRetainedJson({bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image, image]}]}))}, context, working);
  try {
    const targets: number[] = [];
    for (let node = document.tree.rootPosition, end = (await document.tree.describe(node)).end; node < end;) {
      const header = await document.tree.describe(node);
      if (header.kind === "string" && header.end - node - 32 === units * 2) targets.push(node);
      node = header.kind === "array" || header.kind === "object" ? node + 32 : header.end;
    }
    expect(targets).toHaveLength(2);
    const resources = await prepareRetainedImageResources(document.tree, document.order, context, working, {from: "json", to: "odt"});
    try {
      const first = await resources.image(targets[0]!), second = await resources.image(targets[1]!);
      expect(first.identity).toBe(second.identity);
      const extent = first.storage.allocate(0), chunks = vi.spyOn(document.tree, "scalarChunks");
      for (let repeat = 0; repeat < 4; repeat++) for (const target of targets) {
        expect((await resources.image(target)).identity).toBe(first.identity);
        expect(first.storage.allocate(0)).toBe(extent);
      }
      expect(chunks).not.toHaveBeenCalled();
      expect(resolveSource).toHaveBeenCalledOnce();
      chunks.mockRestore();
    } finally {await resources.close();}
  } finally {await document.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
