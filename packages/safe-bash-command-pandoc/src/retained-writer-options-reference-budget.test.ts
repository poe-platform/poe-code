import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import type {ConversionOptions} from "./types.js";
import {ExecutionContext} from "./execution.js";

const cases: {to: string; writerOptions: Partial<ConversionOptions>}[] = [
  ...["commonmark", "gfm", "rst", "latex"].map(to => ({to, writerOptions: {standalone: true, toc: true, ascii: true, wrap: to === "rst" || to === "latex" ? "none" as const : "auto" as const, columns: 12, rawContent: "retain" as const}})),
  ...["rtf", "odt"].map(to => ({to, writerOptions: {standalone: true}}))
];
it.each(cases)("retains remaining $to writer options", async ({to, writerOptions}) => {
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "😀é body"}]}]}))};
  for (const outputBytes of [undefined, 0, 50, 150, 1000]) for (const references of [0, 1, 10, 20, 40, 80, 120, 160, 200, 1000]) {
    const options = {from: "json", to, ...writerOptions}, limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    if (references === 1000 && outputBytes === undefined) expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(chunk) {bytes.push(...chunk);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire.mock.calls.length).toBe(0);
      if (expected instanceof Error) {
        expect(actual, JSON.stringify(limits)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        expect(bytes).toEqual([]);
      } else {
        expect(actual, JSON.stringify(limits)).not.toBeInstanceOf(Error);
        expect(actual.diagnostics).toEqual(expected.diagnostics);
        expect(Uint8Array.from(bytes)).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
      }
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
