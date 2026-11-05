import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI, RGBA [100,150,200,160], -depth 8 rgba:-.
for (const mode of ["buffered", "retained", "sync"] as const) {
  // Native Q16: 50% is the quantum operand 32767.5, not the factor 0.5.
  for (const [operation, percentage, fractional] of [
    ["Multiply", [255, 255, 255], [9, 51, 120]],
    ["Divide", [0, 0, 0], [34, 202, 255]],
    ["Pow", [0, 0, 0], [66, 160, 247]],
    ["Log", [189, 232, 253], [21, 114, 242]],
  ] as const) {
    it.each(["50%", "32767.5", "0.5"])(`${mode}: ${operation} %s matches native Q16 operands`, async (operand) => {
      const pixels = new Uint8Array([17, 101, 239].flatMap(value => [value, value, value, 255]));
      const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", "-channel", "RGB", "-evaluate", operation, operand, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      const expected = operand === "0.5" ? fractional : percentage;
      expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
  }

  for (const [operation, value, expected] of [
    ["Multiply", "0.5", [50, 75, 100, 80]],
    ["Divide", "2", [50, 75, 100, 80]],
    ["Pow", "2", [39, 88, 157, 100]],
  ] as const) {
    it.each([
      [[], expected[3]],
      [["-channel", "RGB"], 160],
      [["-channel", "RGBA"], expected[3]],
      [["-channel", "RGB", "+channel"], expected[3]],
      [["-alpha", "off"], 255],
    ] as const)(`${mode}: ${operation} ${value} matches native channel selection %j`, async (channel, alpha) => {
      const bytes = await sharp(new Uint8Array([100, 150, 200, 160]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const filesystem = createMemoryFileSystem();
      await filesystem.writeFile("/in.png", bytes);
      const args = ["/in.png", ...channel, "-evaluate", operation, value, "/out.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual([...expected.slice(0, 3), alpha]);
    });
  }
}

for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    ["Add", "0", 9],
    ["Add", "0.5", 9],
    ["Add", "1", 9],
    ["Add", "10", 9],
    ["Add", "254", 10],
    ["Add", "255", 10],
    ["Add", "256", 10],
    ["Add", "257", 10],
    ["Add", "-10", 9],
    ["Add", "-257", 8],
    ["Add", "10%", 35],
    ["Multiply", "0.5", 5],
  ])(`${mode}: evaluates %s %s in Q16 units or operation factors`, async (operation, value, red) => {
    const pixels = new Uint8Array([9, 15, 21, 255, 109, 115, 121, 255]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    const args = ["/in.png", "-channel", "R", "-evaluate", operation, value, "+channel", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual([red, 15, 21, 255, operation === "Multiply" ? 55 : red + 100, 115, 121, 255]);
  });
}
