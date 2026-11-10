import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-reverse", ")"], order: [0, 2, 1] },
    { inputs: ["xc:red", "xc:blue", "xc:lime"], order: [0, 2, 1] },
    { inputs: ["xc:red", "(", "xc:lime", "(", "xc:blue", "xc:red", "-reverse", ")", "-reverse", ")"], order: [0, 2, 0, 1] },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-reverse", ")", "-reverse"], order: [1, 2, 0] },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-reverse", ")", "xc:red"], order: [0, 2, 1, 0] },
    { inputs: ["(", "xc:red", "xc:lime", "-reverse", ")", "(", "xc:blue", "xc:red", "-reverse", ")"], order: [1, 0, 0, 2] },
    { inputs: ["xc:red", "(", "-reverse", ")", "xc:lime"], order: [0, 1] },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-reverse", "-reverse", ")"], order: [0, 1, 2] },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-duplicate", "1,0", ")"], order: [0, 1, 2, 1] },
    { inputs: ["xc:red", "(", "+clone", ")"], order: [0, 0] },
    { inputs: ["xc:red", "(", "xc:blue", "-clone", "0", ")"], order: [0, 2, 0] },
    { inputs: ["xc:red", "(", "xc:lime", "(", "xc:blue", "-clone", "0", "-reverse", ")", ")"], order: [0, 1, 1, 2] },
  ])(`scopes montage image lists via ${mode}: $inputs`, async ({ inputs, order }) => {
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "ppm:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      expect((await command.execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([order.length, 1]);
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    expect(Array.from(image.data)).toEqual(order.flatMap(index => colors[index]!));
  });
}

it.each([
  ["xc:red", ")", "out.ppm"],
  ["xc:red", "(", "xc:lime", "out.ppm"],
])("rejects unmatched montage parentheses before publishing output: %j", (...args) => {
  const files = new Map<string, Uint8Array>();
  expect(runMontageCliSync(args, files)).toMatchObject({ exitCode: 1, stdout: "", stderr: "montage: unbalanced parenthesis\n" });
  expect(files.has("out.ppm")).toBe(false);
});

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    {
      grouped: ["-label", "A", "xc:red", "(", "-label", "B", "xc:lime", "-label", "C", "xc:blue", "-reverse", ")"],
      flat: ["-label", "A", "xc:red", "-label", "C", "xc:blue", "-label", "B", "xc:lime"]
    },
    {
      grouped: ["-label", "A", "xc:red", "(", "xc:lime", "-set", "label", "B", ")"],
      flat: ["-label", "A", "xc:red", "-label", "B", "xc:lime"]
    }
  ])(`keeps montage labels in their group via ${mode}: $grouped`, async ({ grouped, flat }) => {
    const outputs = [];
    for (const inputs of [grouped, flat]) {
      const args = ["-geometry", "40x1+0+0", "-tile", "x1", ...inputs, "png:-"];
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      outputs.push(decodeImage(result.stdoutBytes!));
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
