import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { inputs: ["a.png", "-duplicate", "1"], order: [0, 0] },
    { inputs: ["a.png", "b.png", "-duplicate", "1,"], order: [0, 1] },
    { inputs: ["a.png", "b.png", "-duplicate", "1,,"], order: [0, 1, 0] },
    { inputs: ["a.png", "b.png", "-duplicate", "1,,1"], order: [0, 1, 1] },
    { inputs: ["a.png", "-duplicate", "0"], order: [0] },
    { inputs: ["a.png", "b.png", "-duplicate", "-1"], order: [0, 1] },
    { inputs: ["a.png", "b.png", "-duplicate", "-2,0"], order: [0, 1] },
    { inputs: ["a.png", "-duplicate", "2", "b.png"], order: [0, 0, 0, 1] },
    { inputs: ["a.png", "b.png", "-duplicate", "1,0"], order: [0, 1, 0] },
    { inputs: ["a.png", "b.png", "+duplicate"], order: [0, 1, 1] },
  ])(`duplicates preceding montage inputs via ${mode}: $inputs`, async ({ inputs, order }) => {
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
  ["-duplicate", "1", "a.png", "png:-"],
  ["a.png", "-duplicate"],
  ["a.png", "-duplicate", "1,no", "png:-"],
  ["a.png", "-duplicate", "1,8", "png:-"],
])("rejects invalid montage duplication: %j", (...args) => {
  expect(runMontageCliSync(args, new Map()).exitCode).toBe(1);
});
