import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const encoder = new TextEncoder();
const sources = {
  json: JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [{t: "Str", c: "image"}], ["missing.png", ""]]}]}]}),
  rtf: String.raw`{\rtf1 A paragraph.}`,
  mediawiki: "A paragraph with [[File:missing.png|image]].",
  csv: "name,value\nA,B",
  tsv: "name\tvalue\nA\tB"
};
const targets = ["json", "plain", "html", "commonmark", "gfm", "rst", "latex"];

it.each(Object.entries(sources).flatMap(([from, source]) => targets.map(to => ({from, source, to}))))
("retains $from to $to when resource search paths are supplied", async ({from, source, to}) => {
  const resourcePath = Array.from({length: 128}, (_, index) => `/missing-${index}//./images`);
  const options = {from, to, resourcePath, lossy: true};
  const limits = {references: 1000000, retainedBytes: 10000000};
  const expected = await convert([{bytes: encoder.encode(source)}], options, {limits}).catch(error => error);
  const fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const resolve = vi.fn(async () => {throw new Error("Text writers must not resolve images");});
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  const close = vi.fn(async () => {expect(await fs.readdir("/")).toEqual([]);});
  try {
    const bytes = encoder.encode(source);
    const chunks = async function* () {const buffer = new Uint8Array(7); for (let offset = 0; offset < bytes.length; offset += buffer.length) {const part = bytes.subarray(offset, offset + buffer.length); buffer.set(part); yield buffer.subarray(0, part.length);}};
    const result = await convertToOutput([{chunks: chunks()}], options, {
      limits, resources: {resolve}, workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(65536); await Promise.resolve(); parts.push(bytes.slice());}, close, async abort() {}}
    }).catch(error => error);
    expect(acquire).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); expect(readFile).not.toHaveBeenCalled();
    if (expected instanceof Error) {
      expect(result).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message});
      expect(parts).toEqual([]); expect(close).not.toHaveBeenCalled();
    } else {
      expect(result).not.toBeInstanceOf(Error);
      expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes);
      expect(result.diagnostics).toEqual(expected.diagnostics); expect(close).toHaveBeenCalledOnce();
    }
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(targets)("retains empty %s output with resource paths", async to => {
  const options = {from: "json", to, resourcePath: ["/images"], lossy: true};
  const expected = await convert([], options, {}), fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
  const mapped = vi.spyOn(options.resourcePath, "map").mockImplementation(() => {throw new Error("Resident directory copy forbidden");});
  try {
    await convertToOutput([], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}});
    expect(mapped).not.toHaveBeenCalled();
    expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes);
  } finally {mapped.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(Object.entries(sources).flatMap(([from, source]) => [[], ["../escape"], ["/images/../escape"]].map(resourcePath => ({from, source, resourcePath}))))
("validates $from search paths before acquiring input: $resourcePath", async ({from, source, resourcePath}) => {
  const options = {from, to: "plain", resourcePath};
  const expected = await convert([{bytes: encoder.encode(source)}], options, {}).catch(error => error);
  expect(expected).toBeInstanceOf(Error);
  const fs = new MemoryFileSystem(), next = vi.fn(async () => ({done: true as const, value: undefined})), write = vi.fn();
  await expect(convertToOutput([{chunks: {[Symbol.asyncIterator]: () => ({next})}}], options, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: expected.code, message: expected.message});
  expect(next).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["cancel", "sink"])("cleans retained search-path conversions after %s failure", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), abort = vi.fn(), close = vi.fn(); let writes = 0;
  const result = convertToOutput([{bytes: encoder.encode(sources.json)}], {from: "json", to: "plain", resourcePath: ["/images"]}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write() {writes++; if (mode === "cancel") controller.abort(); else throw new Error("Sink failed");}, close, abort}
  });
  await expect(result).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(writes).toBe(1); expect(close).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledOnce();
  expect(await fs.readdir("/")).toEqual([]);
});
