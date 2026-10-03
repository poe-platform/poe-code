import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["images", "binaryBytes", "layoutWork"].flatMap(key => ["plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt", "json"].map(to => ({key, to}))))("keeps RTF to $to retained with a finite $key budget", async ({key, to}) => {
  const input = {bytes: new TextEncoder().encode(String.raw`{\rtf1{\pict\pngblip\picw1\pich1 89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082}text}`)}, fs = new MemoryFileSystem();
  for (const limit of [0, 1, 7, 8, 100000]) {
    const limits = {[key]: limit}, options = {from: "rtf", to};
    const expected = await convert([input], options, {limits}).catch(error => error);
    if (limit === 100000 && to !== "json") expect(expected).not.toBeInstanceOf(Error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    const parts: Uint8Array[] = [];
    try {
      const result = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}}).catch(error => error);
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
