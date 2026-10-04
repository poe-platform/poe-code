import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createJsonFilterCapability} from "./json-filters.js";

it.each(["json", "rtf", "commonmark", "html", "csv"])('keeps zero-input %s conversions in caller storage', async from => {
  const fs = new MemoryFileSystem();
  const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {
    for await (const bytes of stdin) await stdout.write(bytes);
    return 0;
  }});
  const options = {from, to: "html5", metadata: {title: {t: "MetaString" as const, c: "Empty"}}, standalone: true, filters: [{kind: "json" as const, path: "/filter"}]};
  const output = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const expectedBytes: number[] = [], actualBytes: number[] = [];
  const expected = await convert([], options, {filters, output: output(expectedBytes)});
  const acquire = vi.spyOn(ExecutionContext.prototype, "decodeUtf8").mockRejectedValue(new Error("Whole filter response forbidden"));
  try {
    const actual = await convertToOutput([], options, {filters, output: output(actualBytes), workingFiles: {fs, directory: "/"}});
    expect(acquire).not.toHaveBeenCalled();
    expect(actualBytes).toEqual(expectedBytes);
    expect(actual.diagnostics).toEqual(expected.diagnostics);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"])("preserves zero-input byte and reference quotas to %s", async to => {
  const options = {from: "commonmark", to, metadata: {title: {t: "MetaString" as const, c: "Empty 😀"}}};
  const ceiling = 1000000, boundaries = new Set<number>([0, ceiling]);
  const original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  for (const budget of ["retainedBytes", "references"] as const) {
    boundaries.clear(); boundaries.add(0); boundaries.add(ceiling);
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
      const result = original.apply(this, args);
      if (args[0] === budget) {const used = ceiling - this.remaining(budget); boundaries.add(used); boundaries.add(used - 1);}
      return result;
    });
    try {await convert([], options, {limits: {[budget]: ceiling}, output: sink([])});} finally {trace.mockRestore();}
    for (const limit of boundaries) {
      if (limit < 0) continue;
      const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [];
      const limits = {[budget]: limit};
      const expected = await convert([], options, {limits, output: sink(expectedBytes)}).catch(error => error);
      const actual = await convertToOutput([], options, {limits, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      if (expected instanceof Error) expect(actual, `${budget}=${limit}`).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
      else {expect(actual, `${budget}=${limit}`).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes);
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
});
