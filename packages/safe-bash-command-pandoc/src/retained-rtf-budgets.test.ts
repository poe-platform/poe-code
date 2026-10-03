import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["json", "rtf"].flatMap(from => ["images", "binaryBytes", "layoutWork", "parts", "compressedBytes", "expandedBytes"].flatMap(key => ["plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt", "json"].map(to => ({from, key, to})))))
("keeps $from to $to retained with a finite $key budget", async ({from, key, to}) => {
  const hex = "89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082";
  const target = "data:image/png;base64," + btoa(String.fromCharCode(...Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))));
  const source = from === "rtf" ? String.raw`{\rtf1{\pict\pngblip\picw1\pich1 ` + hex + "}text}" : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [], [target, ""]]}]}]});
  const input = {bytes: new TextEncoder().encode(source)}, fs = new MemoryFileSystem();
  for (const limit of key === "parts" ? [0, 1, 2, 3, 4, 5, 6, 7, 100000] : key === "expandedBytes" ? [0, 1, 7, 8, 38, 39, 40, 108, 109, 110, 1000, 100000] : [0, 1, 7, 8, 100000]) {
    const limits = {[key]: limit}, options = {from, to};
    const expected = await convert([input], options, {limits, resourceFiles: fs}).catch(error => error);
    if (limit === 100000 && (from === "rtf" ? to !== "json" : !["html", "latex"].includes(to))) expect(expected).not.toBeInstanceOf(Error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    const parts: Uint8Array[] = [];
    try {
      const result = await convertToOutput([input], options, {limits, resourceFiles: fs, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}}).catch(error => error);
      if (expected instanceof Error) expect(result).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message});
      else {expect(result).not.toBeInstanceOf(Error); expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);}
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});


it.each(["json", "rtf", "csv", "tsv"].flatMap(from => ["plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt", "json"].map(to => ({from, to}))))("keeps $from to $to retained with finite font budgets", async ({from, to}) => {
  const fixtures = from === "rtf" ? [
    String.raw`{\rtf1{\fonttbl{\f0 Arial;}{\f1 Courier;}}text}`,
    String.raw`{\rtf1{\fonttbl{\f0 Arial;}{\f1 Arial;}}text}`
  ] : [[], ["Arial"], ["Arial", "Arial"], ["Arial", "Courier"], ["Arial", "bad;name"], ["bad;name"]].map(names => JSON.stringify({
    "pandoc-api-version": [1, 23, 1, 2], meta: {"rtf-fonts": {t: "MetaList", c: names.map(c => ({t: "MetaString", c}))}}, blocks: []
  }));
  for (const text of fixtures) for (const fonts of [0, 1, 2, 4]) {
    const delimited = from === "csv" || from === "tsv";
    const input = {bytes: new TextEncoder().encode(delimited ? "head\nvalue" : text)}, options = {from, to, ...(delimited ? {metadata: JSON.parse(text).meta} : {})}, limits = {fonts};
    const expected = await convert([input], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const result = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}}).catch(error => error);
      if (expected instanceof Error) expect(result).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message});
      else {expect(result).not.toBeInstanceOf(Error); expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);}
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});


it.each([{parts: 0}, {expandedBytes: 0}, {parts: 0, expandedBytes: 0, binaryBytes: 0}])("preserves ODT document errors before package budgets %j", async limits => {
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "RawBlock", c: ["html", "<aside/>"]}]}))};
  const options = {from: "json", to: "odt"}, expected = await convert([input], options, {limits}).catch(error => error);
  expect(expected).toBeInstanceOf(Error);
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {}), close = vi.fn(async () => {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    await expect(convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message});
    expect(acquire).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
