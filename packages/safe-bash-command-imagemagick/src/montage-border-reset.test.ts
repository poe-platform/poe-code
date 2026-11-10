import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-border", "0"], width: 1 },
  { options: ["-border", "2"], width: 5 },
  { options: ["+border"], width: 1 },
  { options: ["-border", "1", "+border"], width: 1 },
  { options: ["-border", "1", "+border", "-border", "2"], width: 5 },
])(`resets montage border width via ${mode}: $options`, async ({ options, width }) => {
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
  for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
  expected[(Math.floor(width / 2) * width + Math.floor(width / 2)) * 4] = 255;
  expect(actual.data).toEqual(expected);
});
