import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

import {createJsonFilterCapability} from "./json-filters.js";
import {createLuaFilterCapability} from "./lua-filters.js";

it.each(([{kind: "json", file: false}, {kind: "lua", file: false}, {kind: "lua", file: true}] as const).flatMap(({kind, file}) => (kind === "json" ? ["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"] : ["json", "html5"]).map(to => ({kind, to, file}))))("retains $kind filter byte quotas to $to file=$file", async ({kind, to, file}) => {
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body 😀é"}]}]}')};
  const filters = kind === "json" ? createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes); return 0;}}) : createLuaFilterCapability(file ? {readFile: async () => new TextEncoder().encode("function Str(el) return pandoc.Str(string.upper(el.text)) end")} : {readStream: async function* () {yield new TextEncoder().encode("function Str(el) return pandoc.Str(string.upper(el.text)) end");}});
  const options = {from: "json", to, filters: [{kind, path: "/filter"}]}, ceiling = 2000000;
  const boundaries = new Set<number>([0, ceiling]), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === "retainedBytes") {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used - 1);}
    return result;
  });
  try {await convert([input], options, {filters, limits: {retainedBytes: ceiling}, output: sink([])});}
  finally {trace.mockRestore();}
  const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / (kind === "lua" ? 12 : 48)) === 0 || index >= values.length - (kind === "lua" ? 4 : 32))) {
    const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [];
    const expected = await convert([input], options, {filters, limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {filters, limits: {retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire, String(retainedBytes)).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it("preserves JSON filter write boundaries while replaying decoder quotas", async () => {
  const text = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "x".repeat(20000)}]}]});
  const input = {bytes: new TextEncoder().encode(text)}, ceiling = 2000000;
  const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const bytes of stdin) void bytes; await stdout.write(input.bytes); return 0;}});
  const options = {from: "json", to: "json", filters: [{kind: "json" as const, path: "/filter"}]};
  const output = {async write() {}, async close() {}, async abort() {}};
  const boundaries = new Set<number>(), original = ExecutionContext.prototype.charge;
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === "retainedBytes" && args[1] > 10000) {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used - 1); boundaries.add(used - args[1] + 1);}
    return result;
  });
  try {await convert([input], options, {filters, output, limits: {retainedBytes: ceiling}});} finally {trace.mockRestore();}
  for (const retainedBytes of boundaries) {
    const limits = {retainedBytes};
    const expected = await convert([input], options, {filters, output, limits}).catch(error => error);
    const fs = new MemoryFileSystem();
    const actual = await convertToOutput([input], options, {filters, limits, workingFiles: {fs, directory: "/"}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => error);
    expect(actual, String(retainedBytes)).toMatchObject({code: expected.code, message: expected.message});
    expect(await fs.readdir("/")).toEqual([]);
  }
});
