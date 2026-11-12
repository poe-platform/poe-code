import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// RGB8 reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
  { inputs: ["-virtual-pixel", "tile", "tile.ppm", "-distort", "AffineProjection", "1,0,0,1,1,0"], width: 3, height: 2, pixels: "2000efef200000ef20df10ffffdf1010ffdf" },
  { inputs: ["tile.ppm", "-virtual-pixel", "white", "-distort", "AffineProjection", "1,0,0,1,1,0", "-virtual-pixel", "edge"], width: 3, height: 2, pixels: "ffeff7f7200000e718fffff7f7ef1818ffe7" },
  { inputs: ["tile.ppm", "-virtual-pixel", "tile", "-distort", "AffineProjection", "1,0,0,1,1,0"], width: 3, height: 2, pixels: "2000efef200000ef20df10ffffdf1010ffdf" },
  { inputs: ["tile.ppm", "-virtual-pixel", "white", "-distort", "AffineProjection", "1,0,0,1,1,0"], width: 3, height: 2, pixels: "ffeff7f7200000e718fffff7f7ef1818ffe7" },
  { inputs: ["tile.ppm", "-virtual-pixel", "edge", "-distort", "AffineProjection", "1,0,0,1,1,0"], width: 3, height: 2, pixels: "ff0000ff080000f710ffff00fff70808ffef" },
  { inputs: ["tile.ppm", "-distort", "AffineProjection", "1,0,0,1,1,0"], width: 3, height: 2, pixels: "ff0000ff080000f710ffff00fff70808ffef" },
  { inputs: ["tile.ppm", "-virtual-pixel", "edge", "-resize", "5x2!"], width: 5, height: 2, pixels: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" },
  { inputs: ["tile.ppm", "-resize", "5x2!"], width: 5, height: 2, pixels: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" }
])(`samples montage virtual pixels via ${mode}: $inputs`, async ({ inputs, width, height, pixels }) => {
  const bytes = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ffffff0000ffffff00ff", "hex")]);
  const files = new Map([["tile.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.ppm", bytes);
  const args = ["-geometry", "+0+0", "-tile", "x1", ...inputs, "-depth", "8", "ppm:-"];
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
      stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    expect((await command.execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([width, height]);
  const rgb = Buffer.from(pixels, "hex");
  expect(actual.data).toEqual(Uint8Array.from(Array.from({ length: width * height }, (_, index) =>
    [...rgb.subarray(index * 3, index * 3 + 3), 255]).flat()));
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { args: ["-virtual-pixel"], error: "missing argument for -virtual-pixel" },
  { args: ["-virtual-pixel", "invalid"], error: "Unsupported virtual-pixel method: invalid" },
  { args: ["-distort"], error: "missing argument for -distort" },
  { args: ["-distort", "AffineProjection"], error: "missing argument for -distort" }
])(`rejects invalid montage sampling options via ${mode}: $args`, async ({ args, error }) => {
  const original = Uint8Array.of(1, 2, 3);
  const files = new Map([["out.ppm", original]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out.ppm", original);
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
  expect(files.get("out.ppm")).toEqual(original);
  expect(await fs.readFile("/out.ppm")).toEqual(original);
});
