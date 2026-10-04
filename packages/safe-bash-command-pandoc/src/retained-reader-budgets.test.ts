import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createJsonFilterCapability} from "./json-filters.js";
import type {ConversionOptions} from "./types.js";

const encoder = new TextEncoder();
const filters = createJsonFilterCapability({
  async runStream({stdin, stdout}) {
    for await (const bytes of stdin) await stdout.write(bytes);
    return 0;
  }
});

it.each(["csv", "tsv", "json", "rtf"].flatMap(from => ["tableRows", "tableColumns", "tableFieldText", "tableCells", "attributes", "depth", "nodes", "text"].flatMap(key =>
  ["json", "plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].map(to => ({from, key, to})))))
("retains $from to $to with filters, metadata and finite $key", async ({from, key, to}) => {
  const delimited = from === "csv" || from === "tsv";
  const table = await convert([{bytes: encoder.encode("A,B\n😀,D")}], {from: "csv", to: "json"}, {});
  if (table.kind !== "text") throw new Error("Expected JSON table");
  const source = from === "rtf" ? String.raw`{\rtf1\trowd\cellx100\cellx200 A\cell B\cell\row\trowd\cellx100\cellx200 C\cell D\cell\row}`
    : from === "json" ? table.text : from === "csv" ? "A,B\n😀,D" : "A\tB\n😀\tD";
  for (const empty of [false, true]) for (const limit of ["nodes", "text"].includes(key) ? [0, 1, 4, 24, 48, 128, 512, 2048] : ["tableCells", "attributes", "depth"].includes(key) ? [0, 1, 2, 4, 8, 12, 24, 48] : [0, 1, 2, 4]) {
    const text = empty ? from === "rtf" ? String.raw`{\rtf1}` : from === "json" ? '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}' : "" : source;
    const inputs = Array.from({length: delimited ? 2 : 1}, (_, index) => ({bytes: encoder.encode(text), ...(key === "attributes" ? {source: `/input-${index}.${from}`} : {})}));
    const options: ConversionOptions = {from, to, lossy: true, metadata: {title: {t: "MetaString", c: "A title longer than the field limit"}}, filters: [{kind: "json", path: "identity"}]};
    const limits = {[key]: limit};
    const expected = await convert(inputs, options, {limits, filters}).catch(error => error);
    const fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
    const close = vi.fn(async () => {expect(await fs.readdir("/")).toEqual([]);});
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput(inputs, options, {limits, filters, workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {parts.push(bytes.slice());}, close, async abort() {}}}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) {
        expect(actual).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
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
