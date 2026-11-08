import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions, FilterCapability} from "./types.js";

const encoder = new TextEncoder();
const hex = "89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082";
const filters: FilterCapability = {
  async apply(document) {return document;},
  async applyJsonStream({stdin, stdout}) {for await (const bytes of stdin) await stdout.write(bytes);}
};
it.each([1, 2].flatMap(count => [0, 1, 2].flatMap(generations => ["none", "typed", "layers"].flatMap(metadata => ["plain", "json", "html", "rtf", "odt"].flatMap(to =>
  ["resources", "resourceBytes"].map(key => ({count, generations, metadata, to, key})))))))
("accounts for $count RTF resources through $generations filters to $to ($key, metadata=$metadata)", async ({count, generations, metadata, to, key}) => {
  const picture = String.raw`{\pict\pngblip\picw1\pich1 ` + hex + "}";
  const input = {bytes: encoder.encode(String.raw`{\rtf1 ` + picture.repeat(count) + "}"), source: "/input.rtf"};
  const options: ConversionOptions = {from: "rtf", to, filters: Array.from({length: generations}, () => ({kind: "lua", path: "identity"})), ...(metadata === "typed" ? {metadata: {title: {t: "MetaString", c: "title"}}} : metadata === "layers" ? {metadataFiles: [{bytes: encoder.encode('{"title":"first"}')}], metadataJson: [{title: "second"}, {title: "title"}]} : {}), ...(to === "html" ? {embedResources: true} : {})};
  const n = hex.length / 2;
  for (const limit of key === "resources" ? [0, 1, 2, 3, 4, 6, 8] : [n - 1, n, n + 1, 2*n - 1, 2*n, 3*n, 4*n, 8*n, 100000]) {
    const fs = new MemoryFileSystem(), limits = {[key]: limit};
    const expected = await convert([input], options, {limits, filters, resourceFiles: fs}).catch(error => error);
    const parts: Uint8Array[] = [], close = vi.fn(async () => {expect(await fs.readdir("/")).toEqual([]);});
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, filters, resourceFiles: fs, workingFiles: {fs, directory: "/", cacheBytes: 16384},
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


it.each([false, true].flatMap(resolver => ["rtf", "odt", "html"].flatMap(to => ["resources", "resourceBytes"].map(key => ({resolver, to, key})))))
("preserves repeated external-image $key accounting to $to (resolver=$resolver)", async ({resolver, to, key}) => {
  const bytes = Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  const image = {t: "Image", c: [["", [], []], [], ["a.png", ""]]};
  const input = {base: "/", bytes: encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image, image]}]}))};
  const options = {from: "json", to, ...(to === "html" ? {embedResources: true} : {})};
  for (const limit of key === "resources" ? [0, 1, 2, 3, 4, 8] : [0, bytes.length - 1, bytes.length, 2*bytes.length - 1, 2*bytes.length, 3*bytes.length, 4*bytes.length, 100000]) {
    const fs = new MemoryFileSystem(); await fs.writeFile("/a.png", bytes);
    const resources = resolver ? {async resolve() {return bytes;}} : undefined;
    const context = {limits: {[key]: limit}, resourceFiles: fs, ...(resources ? {resources} : {})};
    const expected = await convert([input], options, context).catch(error => error);
    const parts: Uint8Array[] = [], close = vi.fn(async () => {});
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {...context, workingFiles: {fs, directory: "/", cacheBytes: 16384},
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
    expect(await fs.readdir("/")).toEqual([{name: "a.png", type: "file"}]);
  }
});
