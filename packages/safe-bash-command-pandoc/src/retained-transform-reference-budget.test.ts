import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Block} from "./ast-types.js";

it.each(["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"])
("retains reference budgets during heading/comment transforms to %s", async to => {
  const blocks: Block[] = [
    {t: "Header", c: [2, ["heading", [], []], [{t: "Str", c: "Heading"}]]},
    {t: "RawBlock", c: ["html", "<!-- removed -->"]},
    {t: "Para", c: [{t: "Str", c: "before"}, {t: "RawInline", c: ["html", "<!-- removed -->"]}, {t: "Str", c: "after"}]},
    {t: "Header", c: [6, ["", [], []], [{t: "Str", c: "Last"}]]}
  ];
  const wire = await writeDocument({blocks, metadata: {untouched: {t: "MetaBlocks", c: [{t: "RawBlock", c: ["html", "<!-- metadata -->"]}]}}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)};
  for (const shiftHeadingLevelBy of [-3, 0, 3]) for (const outputBytes of [undefined, 0, 50, 1000]) for (const references of [0, 1, 5, 20, 80, 160, 400, 2000]) {
    const options = {from: "json", to, shiftHeadingLevelBy, stripComments: true, lossy: true};
    const limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(chunk) {bytes.push(...chunk);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire.mock.calls.length).toBe(0);
      if (expected instanceof Error) {
        expect(actual, JSON.stringify({shiftHeadingLevelBy, limits})).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        expect(bytes).toEqual([]);
      } else {
        expect(actual).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);
        expect(Uint8Array.from(bytes)).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
      }
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].flatMap(to => [-3, 0, 3].flatMap(shiftHeadingLevelBy => [false, true].map(retainRaw => ({to, shiftHeadingLevelBy, retainRaw})))))
("retains byte budgets during transforms to $to with shift $shiftHeadingLevelBy and raw=$retainRaw", async ({to, shiftHeadingLevelBy, retainRaw}) => {
  const input = {source: "/input.json", bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [
    {t: "Header", c: [2, ["heading", [], []], [{t: "Str", c: "Heading"}]]},
    {t: "RawBlock", c: ["html", "<!--removed-->"]},
    {t: "Div", c: [["", [], []], [{t: "RawBlock", c: ["html", retainRaw ? "α<!--removed-->β<!--unclosed" : "<!--removed-->"]}]]},
    {t: "Para", c: [{t: "Str", c: "before"}, {t: "RawInline", c: ["html", retainRaw ? "<!--removed-->😀" : "<!--removed-->"]}, {t: "RawInline", c: ["html", "<!--removed-->"]}, {t: "Str", c: "after"}]},
    {t: "Header", c: [6, ["", [], []], [{t: "Str", c: "Last"}]]}
  ]}))};
  const options = {from: "json", to, shiftHeadingLevelBy, stripComments: true, lossy: true};
  const ceiling = 2000000, boundaries = new Set<number>([0, ceiling]), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === "retainedBytes") {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used - 1);}
    return result;
  });
  try {await convert([input], options, {limits: {retainedBytes: ceiling}, output: sink([])}).catch(error => {expect(retainRaw).toBe(true); expect(["plain", "rtf", "odt"]).toContain(to); expect(["E_UNSUPPORTED_FEATURE", "E_CAPABILITY"]).toContain(error.code);});}
  finally {trace.mockRestore();}
  const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 40) === 0 || index >= values.length - 24)) {
    const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [];
    const expected = await convert([input], options, {limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire, String(retainedBytes)).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
