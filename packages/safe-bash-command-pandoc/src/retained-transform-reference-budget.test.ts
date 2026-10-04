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
