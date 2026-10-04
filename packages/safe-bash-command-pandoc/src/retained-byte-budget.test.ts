import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["empty", "text", "unicode", "long", "invalid"].flatMap(kind => ["json", "plain", "html5", "rst", "commonmark", "gfm", "latex"].flatMap(to => ["lf", "crlf"].map(eol => ({kind, to, eol: eol as "lf" | "crlf"}))))) ("retains JSON-to-$to byte budgets for $kind with $eol", async ({kind, to, eol}) => {
  const text = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: ["html5", "latex"].includes(to) ? {title: {t: "MetaInlines", c: [{t: "Strong", c: [{t: "Str", c: "Title 😀"}]}]}} : {}, blocks: kind === "empty" ? [] : [{t: "Para", c: [{t: "Str", c: kind === "long" ? "😀".repeat(5000) : kind === "unicode" ? "😀é" : "hello"}]}]});
  const bytes = new TextEncoder().encode(kind === "invalid" ? text.slice(0, -3) : text);
  const input = {source: "/input.json", chunks: [bytes.subarray(0, 17), bytes.subarray(17)]};
  const options = {from: "json", to, eol, ...(["html5", "latex"].includes(to) ? {standalone: true} : {}), lossy: eol === "lf"};
  const boundaries = new Set<number>([0, 1, 1000000]);
  const original = ExecutionContext.prototype.charge;
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === "retainedBytes") {const used = 1000000 - this.remaining("retainedBytes"); if (Number.isFinite(used)) {boundaries.add(used); boundaries.add(used - 1);}}
    return result;
  });
  try {await convert([input], options, {limits: {retainedBytes: 1000000}, output: {async write() {}, async close() {}, async abort() {}}}).catch(() => {});}
  finally {trace.mockRestore();}
  // Cover allocation/phase boundaries and representative positions within long strings.
  const limits = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  const selected = kind === "long" ? limits.filter((_, index) => index < 12 || index >= limits.length - 12 || index % 2000 === 0) : limits;
  for (const retainedBytes of selected) {
    const expectedBytes: number[] = [], actualBytes: number[] = [];
    const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
    const expected = await convert([input], options, {limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    if (retainedBytes === 1000000 && kind !== "invalid") expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem();
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire.mock.calls.length, String(retainedBytes)).toBe(0);
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes, String(retainedBytes)).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each([0, 20, 4096, 10000].flatMap(inputBytes => [0, 40, 10000].flatMap(references => [0, 10000].map(outputBytes => ({inputBytes, references, outputBytes})))))("combines retained bytes with input=$inputBytes references=$references output=$outputBytes", async limits => {
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "é".repeat(2200)}]}]}));
  const input = {source: "/input.json", chunks: [bytes.subarray(0, 100), bytes.subarray(100)]}, options = {from: "json", to: "json", eol: "crlf" as const};
  for (const retainedBytes of [0, 4096, 10000, 100000]) {
    const expectedBytes: number[] = [], actualBytes: number[] = [], fs = new MemoryFileSystem();
    const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
    const expected = await convert([input], options, {limits: {...limits, retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {...limits, retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire.mock.calls.length).toBe(0);
      if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else expect(actual).not.toBeInstanceOf(Error);
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
