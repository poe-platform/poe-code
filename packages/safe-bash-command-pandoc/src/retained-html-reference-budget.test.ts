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
const fixtures: Block[][] = [
  [para(str("<&😀".repeat(100)))],
  [{t: "Header", c: [1, attr, [str("title")]]}, {t: "Header", c: [2, attr, [str("title")]]}, para({t: "Math", c: ["InlineMath", "x<y"]})],
  [para({t: "Span", c: [["id", ["wide", "x"], [["data-name", "\"&"]]], [str("value")]]})],
  [], [para(str("one two")), {t: "Plain", c: []}, para(str("last"))],
  [para({t: "Quoted", c: ["DoubleQuote", [{t: "Emph", c: [str("quoted")]}]]}, {t: "Image", c: [attr, [], ["pic", "title"]]}, {t: "Note", c: [para(str("note"))]})],
  [{t: "BulletList", c: [[{t: "Plain", c: [str("outer")]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[para(str("inner"))], []]]}], []]}],
  [{t: "CodeBlock", c: [attr, "\n a\n\tb \n"]}, {t: "BlockQuote", c: [para(str("quoted")), {t: "Div", c: [attr, [para(str("div"))]]}]}],
  [{t: "LineBlock", c: [[str("one")], [], [str("three")]]}, {t: "DefinitionList", c: [[[str("term")], [[para(str("first")), para(str("second"))], []]]]}],
  [{t: "Figure", c: [attr, [[str("short")], [para(str("long"))]], [para(str("body"))]]}],
  [{t: "Table", c: [attr, [[str("short")], [para(str("long"))]], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, [row("head")]], [[attr, 0, [row("body-head")], [row("body")]]], [attr, [row("foot")]]]}],
  [{t: "Table", c: [attr, [null, []], [], [attr, [[attr, []]]], [[attr, 0, [], [[attr, []]]]], [attr, [[attr, []]]]]}],
  [para({t: "RawInline", c: ["html", ""]}), {t: "RawBlock", c: ["html", "raw\n"]}]
];
it.each(fixtures.map((blocks, index) => ({blocks, index})))("retains HTML reference thresholds for fixture $index", async ({blocks}) => {
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  for (const options of [{}, {ascii: true}, {standalone: true, toc: true, numberSections: true, eol: "crlf"}] as Partial<ConversionOptions>[]) {
    const conversion = {from: "json", to: "html5", rawContent: "retain", ...options} as ConversionOptions;
    const input = {bytes: new TextEncoder().encode(wire.text), source: "/input.json"};
    for (let references = 0; ; references++) {
      expect(references).toBeLessThan(4096);
      const limits = {references};
      const expected = await convert([input], conversion, {limits}).catch(error => error);
      const fs = new MemoryFileSystem(); let text = "";
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
      try {
        const actual = await convertToOutput([input], conversion, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
          async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
        }}).catch(error => error);
        expect(acquire.mock.calls.length, JSON.stringify({references, options})).toBe(0);
        if (expected instanceof Error) {
          expect(actual, JSON.stringify({references, options})).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
          expect(text).toBe("");
        } else {expect(actual, JSON.stringify({references, options})).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
      } finally {acquire.mockRestore();}
      expect(await fs.readdir("/")).toEqual([]);
      if (!(expected instanceof Error)) break;
    }
  }
});

it.each(["json", "rtf", "csv", "tsv"].flatMap(from => [undefined, 0, 5, 20, 128].map(outputBytes => ({from, outputBytes}))))
("preserves $from-to-HTML reference and output error order at $outputBytes", async ({from, outputBytes}) => {
  const value = "one 😀 two\nthree";
  const source = from === "json" ? JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: value}]}]})
    : from === "rtf" ? String.raw`{\rtf1 one two\par three}` : '"' + value + '"';
  for (const eol of ["lf", "crlf"] as const) for (let references = 0; references < 100; references++) {
    const input = {bytes: new TextEncoder().encode(source), source: "/input"};
    const options: ConversionOptions = {from, to: "html5", ascii: true, eol};
    const limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(); let text = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) {
        expect(actual, JSON.stringify({eol, references})).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
        expect(text).toBe("");
      } else {expect(actual).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["json", "csv", "tsv"].flatMap(from => (from === "json" ? ["nul", "warning", "uri"] : ["nul"]).map(kind => ({from, kind}))))("preserves $from HTML reference-limit precedence before $kind errors", async ({from, kind}) => {
  const blocks = kind === "uri" ? [{t: "Para", c: [{t: "Link", c: [["", [], []], [], ["javascript:alert(1)", ""]]}]}]
    : kind === "warning" ? [{t: "RawBlock", c: ["html", "<b>x</b>"]}]
    : [{t: "Para", c: [{t: "Str", c: "&".repeat(600) + "\0"}]}];
  const input = {bytes: new TextEncoder().encode((from === "json" ? JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks}) : "&".repeat(600) + "\0"))};
  const options: ConversionOptions = {from, to: "html5", rawContent: "retain", failIfWarnings: true, eol: "crlf"};
  for (let references = 0; references < 100; references++) {
    const expected = await convert([input], options, {limits: {references}}).catch(error => error);
    const fs = new MemoryFileSystem();
    const actual = await convertToOutput([input], options, {limits: {references}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write() {throw new Error("Output forbidden");}, async close() {}, async abort() {}
    }}).catch(error => error);
    expect(actual, String(references)).toMatchObject({code: expected.code, message: expected.message, location: expected.location});
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(fixtures.map((blocks, index) => ({blocks, index})))("retains HTML byte thresholds for fixture $index", async ({blocks}) => {
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  for (const outputBytes of [undefined, 0, 256]) for (const writerOptions of [{}, {ascii: true}, {standalone: true, toc: true, numberSections: true, eol: "crlf"}] as Partial<ConversionOptions>[]) {
    const options = {from: "json", to: "html5", rawContent: "retain", ...writerOptions} as ConversionOptions;
    const input = {bytes: new TextEncoder().encode(wire.text), source: "/input.json"};
    const boundaries = new Set<number>([0, 1, 1000000]), original = ExecutionContext.prototype.charge;
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
      const result = original.apply(this, args);
      if (args[0] === "retainedBytes") {const used = 1000000 - this.remaining("retainedBytes"); if (Number.isFinite(used)) {boundaries.add(used); boundaries.add(used - 1);}}
      return result;
    });
    try {await convert([input], options, {limits: {retainedBytes: 1000000, ...(outputBytes === undefined ? {} : {outputBytes})}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => {if (outputBytes === undefined) throw error; expect(error.code).toBe("E_LIMIT");});}
    finally {trace.mockRestore();}
    const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
    for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 24) === 0 || index >= values.length - 32)) {
      const expectedBytes: number[] = [], actualBytes: number[] = [], fs = new MemoryFileSystem();
      const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
      const expected = await convert([input], options, {limits: {retainedBytes, ...(outputBytes === undefined ? {} : {outputBytes})}, output: sink(expectedBytes)}).catch(error => error);
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
      try {
        const actual = await convertToOutput([input], options, {limits: {retainedBytes, ...(outputBytes === undefined ? {} : {outputBytes})}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
        expect(acquire.mock.calls.length).toBe(0);
        if (expected instanceof Error) expect(actual, JSON.stringify({retainedBytes, writerOptions})).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        else {expect(actual).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
        expect(actualBytes).toEqual(expectedBytes);
      } finally {acquire.mockRestore();}
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
});
