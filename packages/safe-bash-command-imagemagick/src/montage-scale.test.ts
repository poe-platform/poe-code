import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// Reported ImageMagick 7.1.2 Q16-HDRI averages, plus operation order and input scope checks.
it.each([
  { inputs: ["tile.ppm", "-scale", "3x1!"], width: 3, height: 1, pixels: "80008080804080ff00" },
  { inputs: ["tile.ppm", "-scale", "1x1"], width: 1, height: 1, pixels: "808040" },
  { inputs: ["tile.ppm", "-thumbnail", "1x1"], width: 1, height: 1, pixels: "808040" },
  { inputs: ["-scale", "3x1!", "tile.ppm"], width: 3, height: 1, pixels: "80008080804080ff00" },
  { inputs: ["tile.ppm", "-scale", "1x1", "-scale", "3x1!"], width: 3, height: 1, pixels: "808040808040808040" },
  { inputs: ["tile.ppm", "-scale", "3x1!", "-rotate", "90"], width: 1, height: 3, pixels: "80008080804080ff00" },
  { inputs: ["tile.ppm", "-rotate", "90", "-scale", "3x1!"], width: 3, height: 1, pixels: "808080808040808000" },
  { inputs: ["(", "tile.ppm", "-scale", "1x1", ")", "(", "tile.ppm", "-scale", "3x1!", ")"], width: 4, height: 1, pixels: "80804080008080804080ff00" }
])(`scales montage inputs via ${mode}: $inputs`, async ({ inputs, width, height, pixels }) => {
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
it(`reports a missing montage scale geometry via ${mode}`, async () => {
  const args = ["-scale"];
  const result = mode === "sync" ? runMontageCliSync(args, new Map())
    : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stderr: "montage: missing argument for -scale\n" });
});
