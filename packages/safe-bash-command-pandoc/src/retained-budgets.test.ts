import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const encoder = new TextEncoder();
const json = (text: string) => encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: text}]}]}));

it.each(["json", "csv", "tsv"].flatMap(from => ["json", "plain", "html", "commonmark", "gfm", "rst", "latex", "rtf", "odt"].filter(to => from === "json" || to !== "commonmark").map(to => ({from, to}))))("keeps $from to $to retained with finite work and diagnostics budgets", async ({from, to}) => {
  const fs = new MemoryFileSystem();
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let pending = 0, size = 0;
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  try {
    await convertToOutput([{bytes: from === "json" ? json("x".repeat(65536)) : encoder.encode("head\n" + "x".repeat(65536))}], {from, to}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {work: 100000000, diagnostics: 10},
      output: {async write(bytes) {
        expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384);
        size += bytes.length; await Promise.resolve(); pending--;
      }, close, abort}
    });
    expect(size).toBeGreaterThan(65536); expect(close).toHaveBeenCalledOnce(); expect(abort).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["json", "csv", "tsv"])("enforces a finite work budget while retaining %s input", async from => {
  const fs = new MemoryFileSystem();
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  const write = vi.fn(async () => {}), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  try {
    await expect(convertToOutput([{bytes: from === "json" ? json("x".repeat(65536)) : encoder.encode("head\n" + "x".repeat(65536))}], {from, to: "json"}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {work: 100}, output: {write, close, abort}
    })).rejects.toMatchObject({code: "E_LIMIT"});
    expect(acquire).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("enforces a finite diagnostics budget before retained HTML publication", async () => {
  const fs = new MemoryFileSystem();
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  const write = vi.fn(async () => {}), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const bytes = encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "RawBlock", c: ["latex", "ignored"]}]}));
  try {
    await expect(convertToOutput([{bytes}], {from: "json", to: "html", lossy: true}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384}, limits: {diagnostics: 0}, output: {write, close, abort}
    })).rejects.toMatchObject({code: "E_LIMIT"});
    expect(acquire).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
