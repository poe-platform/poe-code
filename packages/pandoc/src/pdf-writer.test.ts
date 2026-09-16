import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { convert, writeDocument, createFormatRegistry, createPandocCommand } from "./index.js";
import type { Document } from "./index.js";
import { Volume } from "memfs";
const document: Document = {blocks: [{t: "Para", c: [{t: "Str", c: "Hello PDF"}]}], resources: [], metadata: {}};
it("delivers built-in PDF bytes without an injected writer", async () => {
  expect(createFormatRegistry().resolve("pdf", "write").writer).toBeDefined();
  const result = await convert([{bytes: new TextEncoder().encode("# Title\n\nHello [link](https://example.com).") }], {from: "commonmark", to: "pdf"}, {});
  expect(result.kind).toBe("binary");
  if (result.kind === "binary") expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
});
it("uses shared PDF budgets and reports unsupported AST rather than projection", async () => {
  await expect(writeDocument(document, {to: "pdf"}, {limits: {glyphs: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(writeDocument(document, {to: "pdf"}, {limits: {fonts: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(writeDocument({...document, blocks: [{t: "RawBlock", c: ["html", "<b>x</b>"]}]}, {to: "pdf"}, {})).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("publishes PDF through the thin safe-bash adapter into memfs", async () => {
  const volume = Volume.fromJSON({"/input.md": "Hello PDF"});
  const stdout: Uint8Array[] = []; const stderr: Uint8Array[] = [];
  const result = await createPandocCommand().execute({args: ["-f", "commonmark", "-t", "pdf", "/input.md", "-o", "/output.pdf"], signal: new AbortController().signal, cwd: "/", stdin: [], stdout: {write: async b => {stdout.push(b);}}, stderr: {write: async b => {stderr.push(b);}}, readFile: async path => new Uint8Array(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => {volume.writeFileSync(path, bytes);}});
  expect(result.exitCode).toBe(0); expect(stderr).toHaveLength(0); expect(stdout).toHaveLength(0);
  expect((await PDFDocument.load(new Uint8Array(volume.readFileSync("/output.pdf") as Buffer))).getPageCount()).toBe(1);
});
it("adapts rectangular tables and rejects spanning cells", async () => {
  const cell = [ ["", [], []], "AlignLeft", 1, 1, document.blocks ] as const;
  const table = {t: "Table", c: [["", [], []], [null, []], [["AlignLeft", {t: "ColWidthDefault"}]], [["", [], []], [[["", [], []], [cell]]]], [], [["", [], []], []]]} as const;
  const result = await writeDocument({...document, blocks: [table]}, {to: "pdf"}, {});
  expect(result.kind).toBe("binary");
  const spanning = {...table, c: [...table.c.slice(0, 3), [["", [], []], [[["", [], []], [[cell[0], cell[1], 2, 1, cell[4]]]]]], table.c[4], table.c[5]]} as unknown as Document["blocks"][number];
  await expect(writeDocument({...document, blocks: [spanning]}, {to: "pdf"}, {})).rejects.toMatchObject({code: "E_AST"});
});
