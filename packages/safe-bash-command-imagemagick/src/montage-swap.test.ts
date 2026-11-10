import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { inputs: ["a.png", "b.png", "-swap", "0,1"], order: [1, 0] },
    { inputs: ["a.png", "b.png", "-swap", "0,0"], order: [0, 1] },
    { inputs: ["a.png", "b.png", "+swap"], order: [1, 0] },
    { inputs: ["a.png", "b.png", "-swap", "-1,-2"], order: [1, 0] },
    { inputs: ["a.png", "b.png", "-swap", "0"], order: [1, 0] },
    { inputs: ["a.png", "b.png", "+swap", "a.png"], order: [1, 0, 0] },
    { inputs: ["a.png", "b.png", "a.png", "-swap", "0,2"], order: [0, 1, 0] },
  ])(`swaps preceding montage inputs via ${mode}: $inputs`, async ({ inputs, order }) => {
    const pixels = [[255, 0, 0, 255, 0, 255, 0, 255], [0, 0, 255, 255, 255, 255, 255, 255]];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [index, name] of ["a.png", "b.png"].entries()) {
      const bytes = await sharp(new Uint8Array(pixels[index]!), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
      files.set(name, bytes);
      await fs.writeFile("/" + name, bytes);
    }
    const args = ["-geometry", "+0+0", "-tile", `${order.length}x1`, ...inputs, "png:-"];
    let output: Uint8Array;
    if (mode === "command") {
      const argumentValues = createCommandArguments(["montage", ...args.slice(0, -1), "sheet.png"]);
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = await fs.readFile("/sheet.png");
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const actual = decodeImage(output);
    expect([actual.width, actual.height]).toEqual([order.length * 2, 1]);
    expect(Array.from(actual.data)).toEqual(order.flatMap(index => pixels[index]!));
  });
}

it.each([
  ["+swap", "xc:red", "png:-"],
  ["xc:red", "+swap", "png:-"],
  ["xc:red", "xc:blue", "-swap"],
  ["xc:red", "xc:blue", "-swap", "no", "png:-"],
  ["xc:red", "xc:blue", "-swap", "0,8", "png:-"],
])("rejects invalid montage swaps: %j", (...args) => {
  expect(runMontageCliSync(args, new Map()).exitCode).toBe(1);
});

for (const mode of ["sync", "retained"] as const) {
  it.each([
    { tail: ["-swap", "0,2"], pixels: [0, 0, 255, 0, 255, 0, 255, 0, 0] },
    { tail: ["+swap"], pixels: [255, 0, 0, 0, 0, 255, 0, 255, 0] },
    { tail: ["+swap", "xc:black"], pixels: [255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255] },
    { tail: ["-reverse"], pixels: [0, 0, 255, 0, 255, 0, 255, 0, 0] },
  ])(`matches native montage RGB ordering via ${mode}: $tail`, async ({ tail, pixels }) => {
    const args = ["-background", "white", "-geometry", "1x1+0+0", "-tile", "3x", "xc:red", "xc:lime", "xc:blue", ...tail, "-depth", "8", "rgb:-"];
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Array.from(result.stdoutBytes!)).toEqual(pixels);
  });

  it(`keeps labels and sizes attached to swapped tiles via ${mode}`, async () => {
    const outputs = [];
    for (const inputs of [
      ["-size", "40x2", "-label", "A", "xc:red", "-size", "50x3", "-label", "B", "xc:blue", "+swap"],
      ["-size", "50x3", "-label", "B", "xc:blue", "-size", "40x2", "-label", "A", "xc:red"],
    ]) {
      const args = ["-geometry", "+0+0", "-tile", "2x1", ...inputs, "png:-"];
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      outputs.push(decodeImage(result.stdoutBytes!));
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
