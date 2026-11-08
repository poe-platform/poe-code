import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";

const attr: [string, string[], [string, string][]] = ["", [], []];
const layers: Pick<ConversionOptions, "metadata" | "metadataJson" | "metadataFiles">[] = [
  {metadata: {title: {t: "MetaString", c: "Title"}, nested: {t: "MetaMap", c: {list: {t: "MetaList", c: [{t: "MetaBool", c: true}]}}}}},
  {metadata: {table: {t: "MetaBlocks", c: [{t: "Table", c: [attr, [null, []], [["AlignLeft", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignLeft", 1, 1, []]]]]]], [attr, []]]}]}}},
  {metadataJson: [{title: "Title", nested: {list: [true, "text"]}}, {nested: {extra: 3}, removed: null}]},
  {metadataFiles: [{bytes: new TextEncoder().encode('{"title":"Title","nested":{"list":[true,"text"]}}')}]}
];
it.each(["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].flatMap(to => layers.map(layer => ({to, layer}))))("retains metadata reference limits for $to $layer", async ({to, layer}) => {
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{"nested":{"t":"MetaMap","c":{"old":{"t":"MetaString","c":"kept"}}}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body"}]}]}')};
  for (const outputBytes of [undefined, 0, 50]) for (const references of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 40, 80]) {
    const options = {from: "json", to, ...layer}, limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    if (references === 80 && outputBytes === undefined) expect(expected).not.toBeInstanceOf(Error);
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

it.each(["json", "plain", "html5", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].flatMap(to => layers.map(layer => ({to, layer}))))("retains metadata byte quotas for $to $layer", async ({to, layer}) => {
  const input = {source: "/input.json", bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{"nested":{"t":"MetaMap","c":{"old":{"t":"MetaString","c":"kept"}}}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body"}]}]}')};
  const options = {from: "json", to, ...layer}, ceiling = 2000000;
  const boundaries = new Set<number>([0, ceiling]), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === "retainedBytes") {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used - 1);}
    return result;
  });
  try {await convert([input], options, {limits: {retainedBytes: ceiling}, output: sink([])});}
  finally {trace.mockRestore();}
  const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 48) === 0 || index >= values.length - 32)) {
    const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [];
    const expected = await convert([input], options, {limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {retainedBytes}, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire, String(retainedBytes)).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each([1, 4095, 16384])("retains chunked metadata file quotas at chunk size %i", async chunkSize => {
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}')};
  const file = new TextEncoder().encode(JSON.stringify({title: "😀é".repeat(6000)}));
  const options = () => ({from: "json", to: "json", metadataFiles: [{source: "/metadata.json", chunks: (async function* () {
    for (let offset = 0; offset < file.length; offset += chunkSize) yield file.subarray(offset, offset + chunkSize);
  })()}]});
  for (const retainedBytes of [10000, 32768, 65536, 100000, 200000, 1000000]) {
    const limits = {retainedBytes, references: 100000};
    const expected = await convert([input], options(), {limits}).catch(error => error);
    if (retainedBytes === 1000000) expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options(), {limits, workingFiles: {fs, directory: "/"}, output: {
        async write(chunk) {bytes.push(...chunk);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
      else {expect(actual).not.toBeInstanceOf(Error); expect(new TextDecoder().decode(Uint8Array.from(bytes))).toBe(expected.text);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
