import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-border", "1"], width: 3, color: [0, 0, 0, 255] },
  { options: ["-border", "1", "-bordercolor", "#dfdfdf"], width: 3, color: [223, 223, 223, 255] },
  { options: ["-border", "1", "+bordercolor"], width: 3, color: [223, 223, 223, 255] },
  { options: ["-border", "2", "+bordercolor"], width: 5, color: [223, 223, 223, 255] },
  { options: ["-border", "1", "+bordercolor", "+bordercolor"], width: 3, color: [223, 223, 223, 255] },
  { options: ["-border", "1", "+bordercolor", "-bordercolor", "blue"], width: 3, color: [0, 0, 255, 255] },
  { options: ["-border", "0", "+bordercolor"], width: 1, color: [223, 223, 223, 255] },
])(`resets montage border color without changing width via ${mode}: $options`, async ({ options, width, color }) => {
  const args = ["-geometry", "1x1+0+0", "-tile", "1x1", "-bordercolor", "black", ...options,
    "xc:red", "-depth", "8", "ppm:-"];
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
  expect([actual.width, actual.height]).toEqual([width, width]);
  const expected = new Uint8Array(width * width * 4);
  for (let i = 0; i < expected.length; i += 4) expected.set(color, i);
  expected.set([255, 0, 0, 255], (Math.floor(width / 2) * width + Math.floor(width / 2)) * 4);
  expect(actual.data).toEqual(expected);
});
