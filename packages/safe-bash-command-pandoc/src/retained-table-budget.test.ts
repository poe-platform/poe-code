import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Block} from "./ast-types.js";
import type {ConversionOptions, FilterCapability} from "./types.js";
const encoder = new TextEncoder();
const table: Block = {t: "Table", c: [["", [], []], [null, []], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]], [["", [], []], []], [[["", [], []], 0, [], [
  [["", [], []], [[["", [], []], "AlignDefault", 2, 2, [{t: "Plain", c: [{t: "Str", c: "cell"}]}]]]], [["", [], []], []]
]]], [["", [], []], []]]};
const filters: FilterCapability = {async apply(document) {return document;}, async applyJsonStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes);}};

async function compare(source: string, options: ConversionOptions, limits: {tableCells?: number; attributes?: number; depth?: number}) {
  const input = {bytes: encoder.encode(source), source: "/document.json"};
  const expected = await convert([input], options, {limits, filters}).catch(error => error);
  const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [], close = vi.fn(async () => {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput([input], options, {limits, filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {chunks.push(bytes.slice());}, close, async abort() {}
    }}).catch(error => error);
    expect(acquire).not.toHaveBeenCalled();
    if (expected instanceof Error) {
      expect(actual).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
      expect(chunks).toEqual([]); expect(close).not.toHaveBeenCalled();
    } else {
      expect(actual).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);
      expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes);
      expect(close).toHaveBeenCalledOnce();
    }
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each([0, 1, 2].flatMap(generations => [false, true].flatMap(metadata => ["json", "gfm"].map(to => ({generations, metadata, to})))))
("counts spanning cells through $generations filters to $to (metadata=$metadata)", async ({generations, metadata, to}) => {
  const wire = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const options: ConversionOptions = {from: "json", to, lossy: true, filters: Array.from({length: generations}, () => ({kind: "lua", path: "identity"})), ...(metadata ? {metadata: {t: {t: "MetaBlocks", c: [table]}}} : {})};
  for (const tableCells of [0, 3, 4, 7, 8, 15, 16, 23, 24, 31, 32, 40]) await compare(wire.text, options, {tableCells});
});

it.each(["geometry", "unknown-block", "unicode", "late-unicode", "tuple", "enum", "span", "unsafe-key", "version", "version-string", "pseudo-cell", "geometry-before-schema", "unknown-enum", "header-level", "code-tuple"])("preserves table-budget and malformed-document precedence: %s", async invalid => {
  const wire = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const document = JSON.parse(wire.text);
  if (invalid === "geometry") document.blocks[0].c[4][0][3][0][1][0][2] = 3;
  if (invalid === "unknown-block") document.blocks.unshift({t: "Unknown"});
  if (invalid === "unicode") document.blocks.unshift({t: "Para", c: [{t: "Str", c: "\ud800"}]});
  if (invalid === "late-unicode") document.blocks.push({t: "Para", c: [{t: "Str", c: "\ud800"}]});
  if (invalid === "tuple") document.blocks.push({t: "Math", c: []});
  if (invalid === "enum") document.blocks.push({t: "Math", c: [{t: "InlineMath", extra: true}, "x"]});
  if (invalid === "span") document.blocks[0].c[4][0][3][0][1][0][2] = 0;
  if (invalid === "unsafe-key") document.blocks.unshift(JSON.parse('{"t":"Unknown","constructor":true}'));
  if (invalid === "geometry-before-schema") {
    document.blocks[0].c[4][0][3][0][1][0][2] = 3;
    document.blocks.push({t: "Unknown"});
  }
  if (invalid === "unknown-enum") document.blocks[0].c[4][0][3][0][1][0][1].t = "UnknownAlignment";
  if (invalid === "header-level") document.blocks.push({t: "Header", c: [0, ["", [], []], []]});
  if (invalid === "code-tuple") document.blocks.push({t: "CodeBlock", c: []});
  if (invalid === "version-string") document["pandoc-api-version"][0] = "1";
  if (invalid === "version") document["pandoc-api-version"][0] = 2;
  if (invalid === "pseudo-cell") document.blocks.unshift({t: "Unknown", c: [[], "anything", 1, 1, []]});
  for (const tableCells of [0, 4, 100]) await compare(JSON.stringify(document), {from: "json", to: "plain"}, {tableCells});
});

it.each(["geometry", "unknown-block", "late-unicode"])("preserves typed metadata budget precedence: %s", async invalid => {
  const malformed = structuredClone(table);
  const blocks: unknown[] = [malformed];
  if (invalid === "geometry") Object.defineProperty(malformed.c[4][0]![3][0]![1][0]!, "2", {value: 3});
  if (invalid === "unknown-block") blocks.unshift({t: "Unknown"});
  if (invalid === "late-unicode") blocks.push({t: "Para", c: [{t: "Str", c: "\ud800"}]});
  const source = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: []});
  for (const tableCells of [0, 4, 100]) await compare(source, {from: "json", to: "plain", metadata: {value: {t: "MetaBlocks", c: blocks as Block[]}}}, {tableCells});
});


it.each([false, true])("counts identifier, classes and pairs with attribute budgets (typed=%s)", async typed => {
  const attributed = structuredClone(table);
  Object.defineProperty(attributed.c, "0", {value: ["id", ["a", "b"], [["k", "v"], ["other", "value"]]]});
  const wire = await writeDocument({blocks: typed ? [] : [attributed], metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  for (const attributes of [0, 1, 4, 5, 8, 10, 20, 40, 100]) await compare(wire.text, {from: "json", to: "json", filters: [{kind: "lua", path: "identity"}], ...(typed ? {metadata: {value: {t: "MetaBlocks", c: [attributed]}}} : {})}, {attributes});
});

it.each(["unicode", "span", "unknown"])("preserves attribute budget error precedence: %s", async invalid => {
  const wire = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const document = JSON.parse(wire.text);
  if (invalid === "span") document.blocks[0].c[4][0][3][0][1][0][2] = 0;
  if (invalid === "unicode") document.blocks.unshift({t: "Para", c: [{t: "Str", c: "\ud800"}]});
  if (invalid === "unknown") document.blocks.unshift({t: "Unknown"});
  for (const attributes of [0, 1, 4, 5, 6, 7, 8, 100]) await compare(JSON.stringify(document), {from: "json", to: "plain"}, {attributes});
});

it.each(["csv", "tsv"])("retains direct %s HTML output with generated attribute budgets", async from => {
  for (const source of ["", "head", from === "csv" ? "a,b\nc" : "a\tb\nc"])
    for (const attributes of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) await compare(source, {from, to: "html"}, {attributes});
});


it.each(["nested", "unicode", "unknown", "invalid-value", "empty"])("preserves JSON depth admission and error order: %s", async kind => {
  let block: unknown = {t: "Para", c: [{t: "Str", c: kind === "unicode" ? "\ud800" : "text"}]};
  for (let i = 0; i < 4; i++) block = {t: "BlockQuote", c: [block]};
  const document = {"pandoc-api-version": [1,23,1,2], meta: {}, blocks: kind === "empty" ? [] : [kind === "unknown" ? {t: "Unknown"} : block]};
  const source = kind === "invalid-value" ? '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[[[?]]]}' : JSON.stringify(document);
  for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20]) await compare(source, {from: "json", to: "plain"}, {depth});
});

it.each(["file", "json", "variables"])("preserves depth admission for %s metadata", async mode => {
  const source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}';
  const value = {a: {b: {c: {d: {e: {f: "value"}}}}}};
  const options: ConversionOptions = {from: "json", to: "plain", ...(mode === "file" ? {metadataFiles: [{bytes: encoder.encode(JSON.stringify(value)), source: "/meta.json"}]} : mode === "json" ? {metadataJson: [value]} : {variables: value})};
  for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20]) await compare(source, options, {depth});
});


it.each(["csv", "tsv"])("retains %s depth checks before direct output", async from => {
  for (const source of ["", " ", "head", from === "csv" ? "a,b\nc" : "a\tb\nc"])
    for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) await compare(source, {from, to: "html"}, {depth});
});

it.each([
  String.raw`{\rtf1 {\b {\i nested}} text}`,
  String.raw`{\rtf1 text{\footnote nested note}}`,
  String.raw`{\rtf1{\pict\pngblip\picw1\pich1 89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082}}`
])("preserves RTF syntax and normalized depth for %s", async source => {
  for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16]) await compare(source, {from: "rtf", to: "plain", filters: [{kind: "lua", path: "identity"}]}, {depth});
});

it.each(["csv", "json", "rtf"])("preserves combined structural budget order for %s", async from => {
  const wire = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const source = from === "csv" ? "a,b\nc,d" : from === "json" ? wire.text : String.raw`{\rtf1\trowd\cellx100\cellx200 a\cell b\cell\row}`;
  for (const limits of [{depth: 2, attributes: 0, tableCells: 100}, {depth: 8, attributes: 100, tableCells: 0}, {depth: 12, attributes: 0, tableCells: 100}, {depth: 20, attributes: 100, tableCells: 100}])
    await compare(source, {from, to: "plain"}, limits);
});

it.each(["sparse", "accessor"])("checks typed array %s descriptors before child depth", async kind => {
  const values = new Array<import("./ast-types.js").MetaValue>(1);
  if (kind === "accessor") Object.defineProperty(values, "0", {enumerable: true, get() {throw new Error("Accessor must not run");}});
  const source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}';
  await compare(source, {from: "json", to: "plain", metadata: {value: {t: "MetaList", c: values}}}, {depth: 3});
});
