import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command", "montage-command"] as const) {
  for (const target of ["info:", "info:-", "info:/sheet.txt"]) {
    it.each([
      { inputs: ["xc:red"], tile: "1x1", options: ["-format", "%wx%h"], expected: "1x1" },
      { inputs: ["xc:red", "xc:blue"], tile: "2x1", options: ["-format", "%wx%h"], expected: "2x1" },
      { inputs: ["xc:red", "xc:blue"], tile: "1x1", options: ["-format", "%wx%h\\n"], expected: "1x1\n1x1\n" },
      { inputs: ["xc:red"], tile: "1x1", options: ["-format", ""], expected: "" },
      { inputs: ["xc:red"], tile: "1x1", options: [], expected: "1x1 sRGB 8-bit\n" },
      { inputs: ["xc:red"], tile: "1x1", options: ["-format", "ignored", "+format"], expected: "1x1 sRGB 8-bit\n" },
      { inputs: ["xc:red", "xc:blue"], tile: "2x1", options: ["-geometry", "3x2+1+1!", "-format", "%wx%h"], expected: "10x4" },
    ])(`${mode} writes completed montage geometry to ${target}: $expected`, async ({ inputs, tile, options, expected }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = [...inputs, "-tile", tile, "-geometry", "+0+0", ...options, target];
      let result;
      if (mode === "command" || mode === "montage-command") {
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
        const command = mode === "command" ? createMagickCommand() : createMontageCommand();
        const status = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      } else result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      const fileOutput = target === "info:/sheet.txt";
      expect(result).toEqual({ exitCode: 0, stdout: fileOutput ? "" : expected, stderr: "" });
      if (fileOutput) expect(new TextDecoder().decode(mode === "buffered" || mode === "sync"
        ? files.get("/sheet.txt") : await fs.readFile("/sheet.txt"))).toBe(expected);
    });
  }
}

for (const mode of ["buffered", "sync", "retained"] as const) {
  it.each(["png", "rgb"])(`preserves %s montage output with -format via ${mode}`, async format => {
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-format", "%wx%h", `${format}:-`];
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    if (format === "png") {
      const image = decodeImage(result.stdoutBytes!);
      expect([image.width, image.height]).toEqual([2, 1]);
      expect(Array.from(image.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    } else expect(Array.from(result.stdoutBytes!)).toEqual([255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255]);
  });
}

it("rejects a missing montage format argument", async () => {
  expect(await runMontageCli(["xc:red", "-format"], new Map())).toEqual({
    exitCode: 1, stdout: "", stderr: "montage: missing argument for -format\n"
  });
});
