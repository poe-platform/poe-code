import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// ImageMagick 7.1.2 Q16-HDRI: a white 4x3 tile with two black center pixels.
it.each([
  { inputs: ["in.ppm", "-trim"], width: 2, height: 1, pixels: [0, 0], warnings: 0 },
  { inputs: ["-trim", "in.ppm"], width: 2, height: 1, pixels: [0, 0], warnings: 0 },
  { inputs: ["in.ppm", "-trim", "-trim"], width: 1, height: 1, pixels: [255], warnings: 1 },
  { inputs: ["in.ppm", "-trim", "-trim", "-trim"], width: 1, height: 1, pixels: [255], warnings: 2 },
  { inputs: ["in.ppm", "-scale", "4x2!", "-trim"], width: 2, height: 2, pixels: [170, 170, 170, 170], warnings: 0 },
  { inputs: ["in.ppm", "-trim", "-scale", "4x2!"], width: 4, height: 2, pixels: Array(8).fill(0), warnings: 0 },
  { inputs: ["(", "in.ppm", "-trim", ")", "(", "in.ppm", ")", "-gravity", "northwest"], width: 6, height: 3,
    pixels: [0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 255, 255], warnings: 0 }
])(`runs montage trims in order via ${mode}: $inputs`, async ({ inputs, width, height, pixels, warnings }) => {
  const bytes = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from(
    Array.from({ length: 12 }, (_, index) => Array(3).fill(index === 5 || index === 6 ? 0 : 255)).flat()
  )]);
  const files = new Map([["in.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", bytes);
  const args = [...inputs, "-tile", "x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  let output: Uint8Array;
  let diagnostic: string;
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
      stderr: { async write(chunk) { stderr.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }, registerCleanup() {}
    };
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    expect((await command.execute(context)).exitCode).toBe(0);
    output = Buffer.concat(stdout);
    diagnostic = Buffer.concat(stderr).toString();
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    output = result.stdoutBytes!;
    diagnostic = result.stderr;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([width, height]);
  expect(actual.data).toEqual(Uint8Array.from(pixels.flatMap(value => [value, value, value, 255])));
  expect(diagnostic).toBe("montage: geometry does not contain image 'in.ppm'\n".repeat(warnings));
});
