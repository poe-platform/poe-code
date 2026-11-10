import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// RGB8 reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
  { inputs: ["tile.ppm", "-resize", "3x1!"], width: 3, height: 1, pixels: "80008f80804080ff00" },
  { inputs: ["-resize", "3x1!", "tile.ppm"], width: 3, height: 1, pixels: "80008f80804080ff00" },
  { inputs: ["tile.ppm", "-resize", "1x1"], width: 1, height: 1, pixels: "808040" },
  { inputs: ["-resize", "1x1", "tile.ppm"], width: 1, height: 1, pixels: "808040" },
  { inputs: ["tile.ppm", "-thumbnail", "1x1"], width: 1, height: 1, pixels: "808040" },
  { inputs: ["tile.ppm", "-resize", "3x1!", "-flop"], width: 3, height: 1, pixels: "80ff0080804080008f" }
])(`filters montage input resizing via ${mode}: $inputs`, async ({ inputs, width, height, pixels }) => {
  const bytes = Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.from("ff000000ff000000ffffff00", "hex")]);
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
it(`rejects a missing montage resize geometry via ${mode}`, async () => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const args = ["-resize"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: "montage: missing argument for -resize\n" });
  expect(files.size).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});
