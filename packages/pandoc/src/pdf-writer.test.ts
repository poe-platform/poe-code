import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { convert, writeDocument, createFormatRegistry, createPandocCommand } from "./index.js";
import type { Document } from "./index.js";
import { Volume } from "memfs";
import {suppliedDefaultFont} from "@poe-code/pdf";
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
it("advertises only applicable PDF writer options", () => {
  expect(() => createFormatRegistry().validateOptions("pdf", "write", ["pdf"])).toThrowError(expect.objectContaining({code: "E_OPTION"}));
});
it("adapts nested lists, figures and numbered notes near page boundaries", async () => {
  const result = await writeDocument({...document, blocks: [
    {t: "Header", c: [1, ["", [], []], [{t: "Str", c: "Lists and notes"}]]},
    {t: "BulletList", c: [[{t: "Para", c: [{t: "Str", c: "outer"}]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[{t: "Para", c: [{t: "Str", c: "nested"}]}]]]}]]},
    {t: "Figure", c: [["", [], []], [null, [{t: "Para", c: [{t: "Str", c: "Caption"}]}]], [{t: "Para", c: [{t: "Str", c: "Owned figure content"}]}]]},
    ...Array.from({length: 45}, () => document.blocks[0]!),
    {t: "Para", c: [{t: "Str", c: "Boundary note"}, {t: "Note", c: [{t: "Para", c: [{t: "Str", c: "Readable numbered endnote"}]}]}]}
  ]}, {to: "pdf"}, {});
  expect(result.kind).toBe("binary");
  if (result.kind === "binary") expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(1);
});
it("fails math strictly and diagnoses explicit readable source under lossy", async () => {
  const math: Document = {...document, blocks: [{t: "Para", c: [{t: "Math", c: ["InlineMath", "x^2 + y^2"]}]}]};
  await expect(writeDocument(math, {to: "pdf"}, {})).rejects.toMatchObject({code: "E_CAPABILITY"});
  const result = await writeDocument(math, {to: "pdf", lossy: true}, {});
  expect(result.kind).toBe("binary");
  expect(result.diagnostics.some(d => d.message.includes("math source"))).toBe(true);
});
it("exposes supplied font fallback resources and point page options in SDK and CLI", async () => {
  const page = {width: 220, height: 300, margin: 20}; const font = suppliedDefaultFont();
  const sdk = await writeDocument(document, {to: "pdf", pdfPage: page, pdfFonts: [{bytes: font.bytes, source: "owned.ttf"}]}, {});
  expect(sdk.kind).toBe("binary");
  if (sdk.kind === "binary") expect((await PDFDocument.load(sdk.bytes)).getPages()[0]!.getSize()).toEqual({width: 220, height: 300});
  const volume = Volume.fromJSON({"/in.md": "Hello PDF"}); volume.writeFileSync("/owned.ttf", font.bytes);
  const errors: string[] = [];
  const result = await createPandocCommand().execute({args: ["-f", "commonmark", "-t", "pdf", "--pdf-page", "220,300,20", "--pdf-font", "/owned.ttf", "/in.md", "-o", "/out.pdf"], signal: new AbortController().signal, cwd: "/", stdin: [], stdout: {write: async () => {}}, stderr: {write: async b => {errors.push(new TextDecoder().decode(b));}}, readFile: async path => new Uint8Array(volume.readFileSync(path) as Buffer), writeFile: async (path, b) => {volume.writeFileSync(path, b);}});
  expect(errors).toEqual([]); expect(result.exitCode).toBe(0);
  expect((await PDFDocument.load(new Uint8Array(volume.readFileSync("/out.pdf") as Buffer))).getPages()[0]!.getSize()).toEqual({width: 220, height: 300});
});
it("validates PDF options and font count before lazy resource acquisition", async () => {
  let acquired = false;
  const input = {chunks: (async function* () {acquired = true; yield new Uint8Array();})()};
  await expect(writeDocument(document, {to: "pdf", pdfFonts: [input]}, {limits: {fonts: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(acquired).toBe(false);
  const excess = Array.from({length: 9}, () => ({chunks: (async function* () {acquired = true; yield new Uint8Array();})()}));
  await expect(writeDocument(document, {to: "pdf", pdfFonts: excess}, {})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(acquired).toBe(false);
  await expect(writeDocument(document, {to: "pdf", pdfPage: {width: 10, height: 10, margin: 20}}, {})).rejects.toMatchObject({code: "E_OPTION"});
  await expect(writeDocument(document, {to: "plain", pdfPage: {width: 200, height: 200, margin: 20}}, {})).rejects.toMatchObject({code: "E_OPTION"});
});
it("admits shared font bytes while streaming before retaining further chunks", async () => {
  const font = suppliedDefaultFont(); let continued = false;
  const source = {chunks: (async function* () {yield font.bytes; continued = true; yield new Uint8Array([0]);})()};
  await expect(writeDocument(document, {to: "pdf", pdfFonts: [source]}, {limits: {binaryBytes: font.bytes.length - 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(continued).toBe(false);
});
