import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { input: ["-size", "1x2", "gradient:red-blue", "-flip"], tile: "1x1", width: 1, height: 2, colors: ["blue", "red"] },
    { input: ["-size", "2x1", "xc:red"], tile: "1x1", width: 2, height: 1, colors: ["red", "red"] },
    { input: ["xc:red"], tile: "1x1", width: 1, height: 1, colors: ["red"] },
    { input: ["-size", "2x1", "xc:red", "-size", "1x1", "xc:blue"], tile: "2x1", width: 3, height: 1, colors: ["red", "red", "blue"] },
    { input: ["-size", "2x1", "xc:red", "+size", "xc:blue", "-reverse"], tile: "2x1", width: 3, height: 1, colors: ["blue", "red", "red"] },
    { input: ["-size", "2x1", "xc:red", "+size", "xc:blue", "-duplicate", "1,0"], tile: "3x1", width: 5, height: 1, colors: ["red", "red", "blue", "red", "red"] },
  ])(`${mode}: sizes montage inputs $input`, async ({ input, tile, width, height, colors }) => {
    const args = [...input, "-tile", tile, "-geometry", "+0+0", "png:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "command") {
      const argumentValues = createCommandArguments(["montage", ...args]);
      const stdout: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      expect((await createMagickCommand().execute(context)).exitCode, String(stderr)).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(stdout);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const header = new DataView(output.buffer, output.byteOffset, output.byteLength);
    expect([header.getUint32(16), header.getUint32(20)]).toEqual([width, height]);
    expect([...decodeImage(output).data]).toEqual(colors.flatMap(color => color === "red" ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  });
}
