import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Block, Inline, Attr} from "./ast-types.js";
import type {ConversionOptions} from "./types.js";
const attr: Attr = ["", [], []];
const str = (c: string): Inline => ({t: "Str", c});
const para = (...c: Inline[]): Block => ({t: "Para", c});
const row = (text: string): [Attr, [Attr, "AlignDefault", number, number, Block[]][]] => [attr, [[attr, "AlignDefault", 1, 1, [para(str(text)), para(str("tail"))]]]];
const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
const picture = new Uint8Array([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array<number>(15).fill(0),0,16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
const fontFixture: Block[] = [para({t: "Span", c: [["", [], [["font-family", "Zeta"], ["color", "#Ff0000"]]], [str("styled")]]})];
const metadata = (blocks: Block[]) => blocks === fontFixture ? {"rtf-fonts": {t: "MetaList" as const, c: ["Zeta", "Alpha", "Zeta"].map(c => ({t: "MetaString" as const, c}))}} : {};
const fixtures: Block[][] = [
  fontFixture,
  [para({t: "Image", c: [attr, [str("one &"), {t: "Space"}, str("two 😀")], ["data:image/jpeg;base64," + btoa(String.fromCharCode(...picture)), "Title & 😀"]]})],
  [{t: "Header", c: [1, ["target", [], []], [str("heading")]]}, para({t: "Link", c: [attr, [str("jump")], ["#target", ""]]})],
  [para({t: "Note", c: [para(str("outer"), {t: "Note", c: [para(str("inner"))]})]})],
  [para(str("#$%&~^{}\\😀"), {t: "Code", c: [attr, "a|b\r\nc"]})],
  [para({t: "Link", c: [attr, [str("one")], ["https://example.test", "title"]]}, {t: "Space"}, {t: "Link", c: [attr, [str("two")], ["https://example.test", "title"]]})],
  [], [para(str("one two")), {t: "Plain", c: []}, para(str("last"))],
  [para({t: "Quoted", c: ["DoubleQuote", [{t: "Emph", c: [str("quoted")]}]]}, {t: "Image", c: [attr, [], ["pic", "title"]]}, {t: "Note", c: [para(str("note"))]})],
  [{t: "BulletList", c: [[{t: "Plain", c: [str("outer")]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[para(str("inner"))], []]]}], []]}],
  [{t: "CodeBlock", c: [attr, "\n a\n\tb \n"]}, {t: "BlockQuote", c: [para(str("quoted")), {t: "Div", c: [attr, [para(str("div"))]]}]}],
  [{t: "LineBlock", c: [[str("one")], [], [str("three")]]}, {t: "DefinitionList", c: [[[str("term")], [[para(str("first")), para(str("second"))], []]]]}],
  [{t: "Figure", c: [attr, [[str("short")], [para(str("long"))]], [para(str("body"))]]}],
  [{t: "Table", c: [attr, [[str("short")], [para(str("long"))]], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, [row("head")]], [[attr, 0, [row("body-head")], [row("body")]]], [attr, [row("foot")]]]}],
  [{t: "Table", c: [attr, [null, []], [], [attr, [[attr, []]]], [[attr, 0, [], [[attr, []]]]], [attr, [[attr, []]]]]}],
  [para({t: "RawInline", c: ["html", ""]}), {t: "RawBlock", c: ["latex", "raw\n"]}]
];
it.each(fixtures.map((blocks, index) => ({blocks, index})))("retains ODT reference thresholds for fixture $index", async ({blocks}) => {
  const wire = await writeDocument({blocks, metadata: metadata(blocks), resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  for (const options of [{}] as Partial<ConversionOptions>[]) {
    const conversion = {from: "json", to: "odt", lossy: true, ...options} as ConversionOptions;
    const input = {bytes: new TextEncoder().encode(wire.text), source: "/input.json"};
    for (let references = 0; ; references += 1) {
      expect(references).toBeLessThan(4096);
      const limits = {references};
      const expected = await convert([input], conversion, {limits}).catch(error => error);
      const fs = new MemoryFileSystem(); const text: number[] = [];
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
      try {
        const actual = await convertToOutput([input], conversion, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
          async write(bytes) {text.push(...bytes);}, async close() {}, async abort() {}
        }}).catch(error => error);
        expect(acquire.mock.calls.length, JSON.stringify({references, options})).toBe(0);
        if (expected instanceof Error) {
          expect(actual, JSON.stringify({references, options})).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
          expect(text).toEqual([]);
        } else {expect(actual, JSON.stringify({references, options})).not.toBeInstanceOf(Error); expect(Uint8Array.from(text)).toEqual(expected.bytes);}
      } finally {acquire.mockRestore();}
      expect(await fs.readdir("/")).toEqual([]);
      if (!(expected instanceof Error) || !expected.message.startsWith("references:")) break;
    }
  }
});

it.each(["json", "rtf", "csv", "tsv"].flatMap(from => [undefined, 0, 5, 20].map(outputBytes => ({from, outputBytes}))))
("preserves $from-to-ODT reference and output error order at $outputBytes", async ({from, outputBytes}) => {
  const value = "one 😀 two\nthree";
  const source = from === "json" ? JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: value}]}]})
    : from === "rtf" ? String.raw`{\rtf1 one two\par three}` : '"' + value + '"';
  for (const eol of ["lf", "crlf"] as const) for (let references = 0; references < 100; references++) {
    const input = {bytes: new TextEncoder().encode(source), source: "/input"};
    const options: ConversionOptions = {from, to: "odt", eol};
    const limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(); const text: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {text.push(...bytes);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) {
        expect(actual, JSON.stringify({eol, references})).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
        expect(text).toEqual([]);
      } else {expect(actual).not.toBeInstanceOf(Error); expect(Uint8Array.from(text)).toEqual(expected.bytes);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(fixtures.map((blocks, index) => ({blocks, index})))("preserves ODT expansion and output error order for fixture $index", async ({blocks}) => {
  const wire = await writeDocument({blocks, metadata: metadata(blocks), resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, options = {from: "json", to: "odt", lossy: true};
  for (const outputBytes of [0, 5, 20, 128, 300, 600, 800, 1000, 3000, 6000]) for (const references of [0, 4, 8, 16, 32, 64, 128, 256, 1024]) {
    const limits = {outputBytes, references}, expected = await convert([input], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(); const text: number[] = [];
    const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {text.push(...bytes);}, async close() {}, async abort() {}
    }}).catch(error => error);
    if (expected instanceof Error) {
      expect(actual, JSON.stringify(limits)).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
      expect(text).toEqual([]);
    } else {expect(actual).not.toBeInstanceOf(Error); expect(Uint8Array.from(text)).toEqual(expected.bytes);}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(fixtures.map((blocks, index) => ({blocks, index})))("retains ODT byte thresholds for fixture $index", async ({blocks}) => {
  const wire = await writeDocument({blocks, metadata: {...metadata(blocks), title: {t: "MetaString", c: "Title & 😀"}}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  for (const outputBytes of [undefined, 0, 256]) for (const writerOptions of [{}, {standalone: true}, {eol: "crlf"}] as Partial<ConversionOptions>[]) {
    const resourceFiles = new MemoryFileSystem();
    const options = {from: "json", to: "odt", lossy: true, ...writerOptions} as ConversionOptions;
    const input = {bytes: new TextEncoder().encode(wire.text), source: "/input.json"};
    const boundaries = new Set<number>([0, 1, 1000000]), original = ExecutionContext.prototype.charge;
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
      const result = original.apply(this, args);
      if (args[0] === "retainedBytes") {const used = 1000000 - this.remaining("retainedBytes"); if (Number.isFinite(used)) {boundaries.add(used); boundaries.add(used - 1);}}
      return result;
    });
    try {await convert([input], options, {resourceFiles, limits: {retainedBytes: 1000000, ...(outputBytes === undefined ? {} : {outputBytes})}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => {expect(["E_LIMIT", "E_UNSUPPORTED_FEATURE", "E_CAPABILITY", "E_RESOURCE"]).toContain(error.code);});}
    finally {trace.mockRestore();}
    const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
    for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 24) === 0 || index >= values.length - 32)) {
      const expectedBytes: number[] = [], actualBytes: number[] = [], fs = new MemoryFileSystem();
      const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
      const expected = await convert([input], options, {resourceFiles, limits: {retainedBytes, ...(outputBytes === undefined ? {} : {outputBytes})}, output: sink(expectedBytes)}).catch(error => error);
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
      try {
        const actual = await convertToOutput([input], options, {resourceFiles, limits: {retainedBytes, ...(outputBytes === undefined ? {} : {outputBytes})}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
        expect(acquire.mock.calls.length).toBe(0);
        if (expected instanceof Error) expect(actual, JSON.stringify({retainedBytes, writerOptions})).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        else {expect(actual).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
        expect(actualBytes).toEqual(expectedBytes);
      } finally {acquire.mockRestore();}
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
});
