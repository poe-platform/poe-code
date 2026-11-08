import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["csv", "tsv"].flatMap(from => ["zero", "empty", "ragged", "words", "quoted", "malformed", "multiple", "long", "invalid"].map(kind => ({from, kind}))))
("retains $from byte quotas for $kind input", async ({from, kind}) => {
  const separator = from === "csv" ? "," : "\t";
  const source = kind === "empty" ? "" : kind === "ragged" ? `one${separator}two\nthree\nfour${separator}five${separator}six`
    : kind === "words" ? `one 😀${separator}three  four\n${separator}` : kind === "quoted" ? `"one\r\ntwo"${separator}"three"`
    : kind === "malformed" ? '"unclosed' : kind === "long" ? "😀".repeat(5000) : `one${separator}two\nthree${separator}four`;
  const bytes = kind === "invalid" ? Uint8Array.of(255) : new TextEncoder().encode(source);
  const chunks = Array.from({length: Math.ceil(bytes.length / 127)}, (_, index) => bytes.subarray(index * 127, (index + 1) * 127));
  const inputs = Array.from({length: kind === "zero" ? 0 : kind === "multiple" ? 2 : 1}, (_, index) => ({chunks, source: `/input-${index}.${from}`}));
  for (const to of kind === "words" ? ["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"] : ["json"]) {
    const options = {from, to, lossy: true}, ceiling = 2000000;
    const boundaries = new Set<number>([0, 1, ceiling]), original = ExecutionContext.prototype.charge;
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
      const result = original.apply(this, args);
      if (args[0] === "retainedBytes") {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used - 1);}
      return result;
    });
    try {await convert(inputs, options, {limits: {retainedBytes: ceiling}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => {expect(kind === "invalid" ? error.code === "E_ENCODING" : kind === "malformed" && from === "csv" ? error.code === "E_PARSE" : to === "commonmark" && error.code === "E_UNSUPPORTED_FEATURE").toBe(true);});}
    finally {trace.mockRestore();}
    const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
    for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 40) === 0 || index >= values.length - 24)) {
      const expectedBytes: number[] = [], actualBytes: number[] = [], fs = new MemoryFileSystem();
      const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
      const expected = await convert(inputs, options, {limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
      try {
        const actual = await convertToOutput(inputs, options, {limits: {retainedBytes}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: sink(actualBytes)}).catch(error => error);
        expect(acquire, JSON.stringify({retainedBytes, to})).not.toHaveBeenCalled();
        if (expected instanceof Error) expect(actual, JSON.stringify({retainedBytes, to})).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        else {expect(actual, JSON.stringify({retainedBytes, to})).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
        expect(actualBytes, JSON.stringify({retainedBytes, to})).toEqual(expectedBytes);
      } finally {acquire.mockRestore();}
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
});

it.each(["csv", "tsv"].flatMap(from => [
  {inputBytes: 0}, {inputBytes: 10}, {inputBytes: 50}, {references: 8}, {references: 64},
  {nodes: 8}, {depth: 3}, {text: 20}, {attributes: 3}, {tableCells: 2}, {tableRows: 1}, {tableColumns: 1}, {tableFieldText: 2}, {outputBytes: 16}
].map(limits => ({from, limits}))))("preserves $from combined byte quotas with $limits", async ({from, limits}) => {
  const bytes = new TextEncoder().encode("one 😀" + (from === "csv" ? "," : "\t") + "three\nfour");
  const inputs = [0, 1].map(index => ({chunks: [bytes.subarray(0, 5), bytes.subarray(5)], source: `/input-${index}`}));
  const options = {from, to: "json", eol: "crlf" as const};
  for (const retainedBytes of [0, 100, 4095, 4096, 5000, 8000, 15000, 50000]) {
    const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [];
    const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
    const expected = await convert(inputs, options, {limits: {...limits, retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput(inputs, options, {limits: {...limits, retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error);
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
