import { describe, expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI validates geometry before reading a decimal integer.
describe.each(["command", "retained", "buffered", "sync"] as const)("scene geometry (%s)", mode => {
  it.each([
    { value: "7.5", names: ["z07.png", "z08.png"] },
    { value: "7x2", names: ["z07.png", "z08.png"] },
    { value: "1e1", names: ["z01.png", "z02.png"] },
    { value: "0x10", names: ["z00.png", "z01.png"] },
    { value: "(7)", names: ["z00.png", "z01.png"] },
    { value: "0xA", names: [] },
    { value: "7", names: ["z07.png", "z08.png"] },
    { value: "garbage", names: [] }
  ])("validates and numbers $value", async ({ value, names }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:red", "xc:blue", "-scene", value, "z%02d.png"];
    const argumentValues = createCommandArguments(args);
    const sink = { async write() {} };
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(names.length ? 0 : 1);
    expect(mode === "command" || mode === "retained"
      ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].sort()).toEqual(names);
    for (const [index, name] of names.entries()) {
      const image = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(`/${name}`) : files.get(name)!);
      expect([image.width, image.height]).toEqual([1, 1]);
      expect([...image.data]).toEqual(index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    }
  });
});
