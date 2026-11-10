import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red", "xc:lime", "-clone", "0"], order: [0, 1, 0] },
    { inputs: ["xc:red", "xc:lime", "+clone"], order: [0, 1, 1] },
    { inputs: ["xc:red", "xc:lime", "-duplicate", "1,0"], order: [0, 1, 0] },
    { inputs: ["xc:red", "-clone", "0", "xc:lime"], order: [0, 0, 1] },
    { inputs: ["xc:red", "xc:lime", "-clone", "-2"], order: [0, 1, 0] },
    { inputs: ["xc:red", "xc:lime", "-clone", "1,0"], order: [0, 1, 1, 0] },
    { inputs: ["xc:red", "xc:lime", "-clone", "0-1"], order: [0, 1, 0, 1] },
    { inputs: ["xc:red", "xc:lime", "-clone", "1-0"], order: [0, 1, 1, 0] },
    { inputs: ["xc:red", "xc:lime", "-clone", "-1,-2"], order: [0, 1, 1, 0] },
  ])(`clones preceding montage inputs via ${mode}: $inputs`, async ({ inputs, order }) => {
    const fs = new MemoryFileSystem();
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "ppm:-"];
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      expect((await command.execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([order.length, 1]);
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255]];
    expect(Array.from(image.data)).toEqual(order.flatMap(index => colors[index]!));
  });
}

it.each([
  ["-clone", "0", "xc:red", "ppm:-"],
  ["+clone", "xc:red", "ppm:-"],
  ["xc:red", "-clone"],
  ["xc:red", "-clone", "no", "ppm:-"],
  ["xc:red", "-clone", "", "ppm:-"],
  ["xc:red", "-clone", "0\n", "ppm:-"],
  ["xc:red", "-clone", "8", "ppm:-"],
  ["xc:red", "-clone", "-2", "ppm:-"],
])("rejects invalid montage cloning: %j", (...args) => {
  expect(runMontageCliSync(args, new Map())).toMatchObject({ exitCode: 1, stdout: "" });
});
