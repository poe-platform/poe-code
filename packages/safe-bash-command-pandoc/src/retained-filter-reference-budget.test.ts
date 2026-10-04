import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createJsonFilterCapability} from "./json-filters.js";

it.each(["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"])("retains JSON filter reference budgets to %s", async to => {
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body"}]}]}')};
  for (const outputBytes of [undefined, 0, 30, 300]) for (let references = 0; references < 85; references++) {
    const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes); return 0;}});
    const options = {from: "json", to, filters: [{kind: "json" as const, path: "/filter"}]}, limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits, filters}).catch(error => error);
    if (references === 84 && outputBytes === undefined) expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
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

it("charges filter writes before splitting, ignores empty writes and preserves cancellation", async () => {
  const context = Object.assign(new ExecutionContext("convert", {limits: {references: 1}}), {to: "json"});
  let emitted = 0;
  const filters = createJsonFilterCapability({async runStream({stdout, signal}) {
    await stdout.write(new Uint8Array());
    await stdout.write(new Uint8Array(32769));
    expect(emitted).toBe(32769);
    await expect(stdout.write(new Uint8Array(1))).rejects.toMatchObject({code: "E_LIMIT", message: "references: 2 exceeds 1"});
    expect(signal.aborted).toBe(true);
    return 0;
  }});
  try {
    await expect(filters.applyJsonStream!({stdin: (async function* () {})(), stdout: {async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); emitted += bytes.length;}}, signal: new AbortController().signal}, {kind: "json", path: "/filter"}, context)).rejects.toMatchObject({code: "E_LIMIT", message: "references: 2 exceeds 1"});
    expect(emitted).toBe(32769);
  } finally {await context.close();}
});
