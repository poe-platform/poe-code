import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";

it.each(["", "function Str(el) return pandoc.Str(string.upper(el.text)) end", "function Meta(meta) meta.title=pandoc.MetaString(\"Title\"); return meta end"])("retains Lua reference budgets for %s", async source => {
  const to = "json";
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body"},{"t":"Quoted","c":[{"t":"DoubleQuote"},[{"t":"Str","c":"quote"}]]}]}]}')};
  for (const {outputBytes, references} of [{references: 0}, {references: 40}, {references: 60}, {references: 80}, {references: 200}, {references: 200, outputBytes: 0}]) {
    const filters = createLuaFilterCapability({readStream: async function* () {yield new TextEncoder().encode(source);}});
    const options = {from: "json", to, filters: [{kind: "lua" as const, path: "/filter"}]}, limits = {references, inputBytes: input.bytes.length + new TextEncoder().encode(source).length, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits, filters}).catch(error => error);
    if (references === 200 && outputBytes === undefined) expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, filters, workingFiles: {fs, directory: "/", cacheBytes: 1048576}, output: {
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
