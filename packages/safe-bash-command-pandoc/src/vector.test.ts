import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {readDocument, writeDocument, convert, convertToOutput} from "./engine.js";
import {normalizeDocument} from "./ast.js";
import type {Document} from "./types.js";
import type {VectorScene} from "@poe-code/document-converter-rust";

const scene: VectorScene = {width: 100, height: 50, nodes: [{id: "custom-shape", bounds: [0, 0, 100, 50], transform: [1, 0, 0, 1, 0, 0], opacity: 1, kind: "path", path: {rule: "nonzero", segments: [["M", 0, 0], ["L", 100, 0], ["L", 100, 50], ["Z"]]}, fill: [255, 0, 0, 255]}]};
const document: Document = {blocks: [{t: "Vector", c: scene}], metadata: {}, resources: []};
const wire = {"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: document.blocks};
const input = {bytes: new TextEncoder().encode(JSON.stringify(wire))};
it("preserves custom scene JSON through legacy normalization and JSON readers/writers", async () => {
  expect(normalizeDocument(document)).toEqual(document);
  const read = await readDocument(input, {from: "json"}, {});
  expect(read).toEqual(document);
  const output = await writeDocument(read, {to: "json"}, {});
  expect(output.kind).toBe("text");
  if (output.kind === "text") expect(JSON.parse(output.text)).toEqual(wire);
});
it.each(["plain", "html", "commonmark", "rst", "latex", "rtf", "odt"])("rejects Vector explicitly for legacy %s output", async to => {
  await expect(writeDocument(document, {to}, {})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", message: expect.stringContaining("Vector requires JSON, DOCX, or PDF output")});
});
it("retains Vector JSON in the storage-backed conversion path", async () => {
  const fs = new MemoryFileSystem();
  const chunks: Uint8Array[] = [];
  await convertToOutput([input], {from: "json", to: "json"}, {workingFiles: {fs, directory: "/"}, output: {write: async bytes => {chunks.push(bytes);}, async close() {}, async abort() {}}});
  expect(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))).toEqual(wire);
});
it.each(["docx", "pdf"])("defers detailed Vector geometry validation to the shared Rust %s exporter", async to => {
  const invalid = {...document, blocks: [{t: "Vector" as const, c: {...scene, nodes: [{...scene.nodes[0]!, opacity: 2}]}}]};
  expect(normalizeDocument(invalid)).toEqual(invalid);
  await expect(writeDocument(invalid, {to}, {})).rejects.toMatchObject({code: "E_AST"});
});
it("rejects Vector for storage-backed text output before publishing", async () => {
  const fs = new MemoryFileSystem();
  let writes = 0;
  await expect(convertToOutput([input], {from: "json", to: "plain"}, {
    workingFiles: {fs, directory: "/"},
    output: {async write() {writes++;}, async close() {}, async abort() {}},
  })).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", message: expect.stringContaining("Vector requires JSON, DOCX, or PDF output")});
  expect(writes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["docx", "pdf"])("passes valid custom scenes through the legacy %s writer", async to => {
  const output = await writeDocument(document, {to}, {});
  expect(output.kind).toBe("binary");
  if (output.kind === "binary") expect(output.bytes.byteLength).toBeGreaterThan(100);
});


it.each(["docx", "pdf"])("lets a registered embed filter lower standard file-image syntax to %s vectors", async to => {
  const source = "Before\n\n![Board](design.whiteboard#page=page1&frame=overview)\n\nAfter";
  const output = await convert([{bytes:new TextEncoder().encode(source)}], {from:"commonmark",to,filters:[{kind:"json",path:"embeds"}]}, {
    filters:{apply:async input=>{
      expect(input.blocks[1]).toEqual({t:"Para",c:[{t:"Image",c:[["",[],[]],[{t:"Str",c:"Board"}],["design.whiteboard#page=page1&frame=overview",""]]}]});
      return {...input,blocks:[input.blocks[0]!,{t:"Vector",c:scene},input.blocks[2]!]};
    }}
  });
  expect(output.kind).toBe("binary");
  if(output.kind==="binary")expect(output.bytes.length).toBeGreaterThan(100);
});
