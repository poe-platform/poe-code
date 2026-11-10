import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
for (const size of ["3x1", "1x3"])
it.each([
  { options: [], offset: 1 },
  { options: ["-gravity", "SouthEast"], offset: 2 },
  { options: ["-gravity", "None"], offset: 0 },
  { options: ["+gravity"], offset: 0 },
  { options: ["-gravity", "SouthEast", "+gravity"], offset: 0 },
  { options: ["+gravity", "-gravity", "SouthEast"], offset: 2 },
])(`positions ${size} montage strips via ${mode}: $options`, async ({ options, offset }) => {
  const args = ["-geometry", "3x3+0+0", "-tile", "1x1", ...options, "-size", size, "xc:red", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([3, 3]);
  const expected = new Uint8Array(3 * 3 * 4).fill(255);
  for (let i = 0; i < 3; i++) {
    const pixel = size === "3x1" ? offset * 3 + i : i * 3 + offset;
    expected.set([255, 0, 0, 255], pixel * 4);
  }
  expect(actual.data).toEqual(expected);
});
