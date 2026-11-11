import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: 16x12 gradient:red-blue, 4:2:2 sampling.
const sources = new Map<number, string>([
  [67, "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAsHCAkIBwsJCQkMCwsNEBoREA8PECAXGBMaJiIoKCYiJSQqMD0zKi05LiQlNUg1OT9BREVEKTNLUEpCTz1DREH/2wBDAQsMDBAOEB8RER9BLCUsQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUH/wAARCAAMABADASEAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAUG/8QAGRAAAQUAAAAAAAAAAAAAAAAAAAITFFFh/8QAFgEBAQEAAAAAAAAAAAAAAAAABwQG/8QAGREAAQUAAAAAAAAAAAAAAAAAAAMUFVFh/9oADAMBAAIRAxEAPwDHStErSiHw3UppKcVYcVYmNk6D1wpZ/9k="],
  [83, "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAUEAwUFBAUGBgUGCA4JCAcHCBEMDQoOFBEVFBMRExMWGB8bFhceFxMTGyUcHiAhIyMjFRomKSYiKR8iIyL/2wBDAQYGBggHCBAJCRAiFhMWIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiL/wAARCAAMABADASEAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAYH/8QAGRAAAQUAAAAAAAAAAAAAAAAAAAMUFVFi/8QAFgEBAQEAAAAAAAAAAAAAAAAABwQI/8QAGhEAAQUBAAAAAAAAAAAAAAAAAAQVFlFiUv/aAAwDAQACEQMRAD8AxSU0JTRfEMjXKdEi4UsOFLNFtqbkBnBRZ//Z"],
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { name: "source quality 67", args: ["67.jpg"], qualities: [67] },
    { name: "source quality 83", args: ["83.jpg"], qualities: [83] },
    { name: "cropped source", args: ["67.jpg", "-crop", "8x6+2+2"], qualities: [67] },
    { name: "resized source", args: ["83.jpg", "-resize", "8x6!"], qualities: [83] },
    { name: "override before input", args: ["-quality", "45", "67.jpg"], qualities: [45] },
    { name: "override after input", args: ["83.jpg", "-quality", "45"], qualities: [45] },
    { name: "unknown source quality", args: ["-size", "16x12", "xc:red"], qualities: [92] },
    { name: "per-image quality", args: ["67.jpg", "83.jpg"], qualities: [67, 83] },
    { name: "scoped quality", args: ["-respect-parentheses", "(", "67.jpg", "-quality", "45", ")", "83.jpg"], qualities: [45, 83] },
    { name: "quality property does not override encoding", args: ["67.jpg", "-set", "quality", "45"], qualities: [67] },
  ])(`${mode}: $name`, async ({ args, qualities }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (const [quality, source] of sources) {
      const bytes = Buffer.from(source, "base64");
      files.set(`${quality}.jpg`, bytes);
      await fs.writeFile(`/${quality}.jpg`, bytes);
    }
    const argv = [...args, "-write", "copy-%d.jpg", "out-%d.jpg"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    for (const prefix of ["copy", "out"]) for (const [index, quality] of qualities.entries()) {
      const path = `${prefix}-${index}.jpg`;
      const bytes = mode === "command" || mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path)!;
      expect(decodeImage(bytes).quality, path).toBe(quality);
    }
  });

  it(`${mode}: inherits source quality for ordinary writes and stdout`, async () => {
    const bytes = Buffer.from(sources.get(67)!, "base64");
    const fs = new MemoryFileSystem(), files = new Map([["in.jpg", bytes]]);
    await fs.writeFile("/in.jpg", bytes);
    const argv = ["in.jpg", "-write", "copy.jpg", "jpeg:-"];
    const argumentValues = createCommandArguments(argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const copy = mode === "command" || mode === "retained" ? await fs.readFile("/copy.jpg") : files.get("copy.jpg")!;
    expect(decodeImage(copy).quality).toBe(67);
    const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(decodeImage(stdout).quality).toBe(67);
  });
}
