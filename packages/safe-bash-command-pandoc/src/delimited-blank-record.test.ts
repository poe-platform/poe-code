import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

const encoder = new TextEncoder();
const input = (text: string) => [{chunks: Array.from(encoder.encode(text), byte => Uint8Array.of(byte))}];

it.each(["csv", "tsv"])("ends buffered and retained %s tables at blank records", async from => {
  const d = from === "csv" ? "," : "\t";
  for (const eol of ["\n", "\r\n", "\r"]) {
    const source = `a${d}b${eol}1${d}2${eol}`;
    for (const to of ["plain", "json"]) {
      const expected = await convert(input(source), {from, to}, {});
      expect(await convert(input(source + eol + eol), {from, to}, {limits: {tableRows: 2}})).toEqual(expected);
      const fs = new MemoryFileSystem();
      let output = "";
      await convertToOutput(input(source + eol + eol), {from, to}, {
        limits: {tableRows: 2}, workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
      });
      expect(expected).toMatchObject({kind: "text", text: output});
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
});

it.each(["csv", "tsv"])("rejects %s content after a blank record without publishing output", async from => {
  const d = from === "csv" ? "," : "\t";
  for (const to of ["plain", "json"]) {
    const source = `a${d}b\n1${d}2\n\n3${d}4\n`;
    const error = {code: "E_PARSE", location: "4:1", message: expect.stringContaining("expecting end of input")};
    await expect(convert(input(source), {from, to}, {})).rejects.toMatchObject(error);
    const fs = new MemoryFileSystem();
    const write = vi.fn(async (_bytes: Uint8Array) => {});
    await expect(convertToOutput(input(source), {from, to}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {write, async close() {}, async abort() {}}
    })).rejects.toMatchObject(error);
    expect(write).not.toHaveBeenCalled();
    expect(await fs.readdir("/")).toEqual([]);
    const stderr = vi.fn(async (_bytes: Uint8Array) => {});
    const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => {});
    for (const output of [[], ["-o", "/existing.txt"]]) {
      expect(await createStandalonePandocCommand().execute({
        args: ["-f", from, "-t", to, ...output], stdin: input(source)[0]!.chunks,
        stdout: {write}, stderr: {write: stderr}, writeFile, signal: new AbortController().signal
      })).toEqual({exitCode: 4});
      expect(write).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(new TextDecoder().decode(stderr.mock.lastCall![0])).toContain("4:1:");
    }
  }
});

it("keeps quoted blank lines and explicitly empty CSV records", async () => {
  const source = 'h\n"x\n\ny"\n""\n,\n';
  const expected = await convert(input(source), {from: "csv", to: "json"}, {});
  expect(await convert(input(source + "\n"), {from: "csv", to: "json"}, {})).toEqual(expected);
  let output = "";
  await convertToOutput(input(source + "\n"), {from: "csv", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(expected).toMatchObject({kind: "text", text: output});
  expect(JSON.parse(output).blocks[0].c[4][0][3]).toHaveLength(3);
});
