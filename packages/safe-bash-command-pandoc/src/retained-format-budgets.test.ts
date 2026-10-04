import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions, FilterCapability} from "./types.js";

const encoder = new TextEncoder();
const filters: FilterCapability = {
  async apply(document) {return document;},
  async applyJsonStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes);}
};

it.each(["json", "rtf", "csv", "tsv"].flatMap(from =>
  ["json", "plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].map(to => ({from, to}))))
("retains $from to $to when unrelated format budgets are zero", async ({from, to}) => {
  const text = "<&amp;> λ";
  const source = from === "json" ? JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: text}]}]})
    : from === "rtf" ? String.raw`{\rtf1 <&amp;> \u955?}` : "head\n" + text;
  const input = {bytes: encoder.encode(source)};
  const limits = {glyphs: 0, pages: 0, objects: 0, xmlDepth: 0, xmlNodes: 0, macros: 0, directives: 0, entities: 0, entityBytes: 0, yamlAliases: 0};
  for (const filtered of [false, true]) {
    const options: ConversionOptions = {from, to, lossy: true, metadata: {title: {t: "MetaString", c: text}}, ...(filtered ? {filters: [{kind: "json", path: "identity"}]} : {})};
    const expected = await convert([input], options, {limits, filters}).catch(error => error);
    const fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
    const close = vi.fn(async () => {expect(await fs.readdir("/")).toEqual([]);});
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, filters, workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {parts.push(bytes.slice());}, close, async abort() {}}}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) {
        expect(actual).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message});
        expect(parts).toEqual([]); expect(close).not.toHaveBeenCalled();
      } else {
        expect(actual).not.toBeInstanceOf(Error);
        expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes);
        expect(actual.diagnostics).toEqual(expected.diagnostics); expect(close).toHaveBeenCalledOnce();
      }
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
