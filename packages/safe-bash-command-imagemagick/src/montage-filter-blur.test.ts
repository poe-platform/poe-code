import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// RGB8 reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
  { inputs: ["tile.ppm", "-define", "filter:blur=0.5", "-resize", "5x2!"], pixels: "ff0000ff000000ff000000ff0000ffffff00ffff0000ffffff00ffff00ff" },
  { inputs: ["tile.ppm", "-define", "filter:blur=2", "-resize", "5x2!"], pixels: "ab9222819746608e714a769e4353c9acbc3689b561719f8e687eb96d54dd" },
  { inputs: ["tile.ppm", "-define", "filter:blur=2", "+define", "filter:blur", "-resize", "5x2!"], pixels: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" },
  { inputs: ["tile.ppm", "-define", "filter:blur=2", "-resize", "5x2!", "+define", "filter:blur"], pixels: "ab9222819746608e714a769e4353c9acbc3689b561719f8e687eb96d54dd" },
  { inputs: ["tile.ppm", "-resize", "5x2!"], pixels: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" }
])(`filters montage input resizing via ${mode}: $inputs`, async ({ inputs, pixels }) => {
  const width = 5, height = 2;
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
  { args: ["-define"], error: "missing argument for -define" },
  { args: ["+define"], error: "missing argument for +define" },
  { args: ["-define", "filter:blur=bad"], error: "Invalid filter define: filter:blur=bad" }
])(`rejects invalid montage filter defines via ${mode}: $args`, async ({ args, error }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
  expect(files.size).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});
