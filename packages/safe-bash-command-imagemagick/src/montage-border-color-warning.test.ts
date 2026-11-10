import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { colors: ["black", "banana"], blue: 0, warning: true },
  { colors: ["black", "blue", "banana"], blue: 0, warning: true },
  { colors: ["black", "blue"], blue: 255, warning: false },
  { colors: ["black", "banana", "blue"], blue: 255, warning: true },
])(`renders montage borders after invalid colors via ${mode}: $colors`, async ({ colors, blue, warning }) => {
  const args = ["-geometry", "1x1+0+0", "-tile", "1x1", "-border", "1",
    ...colors.flatMap(color => ["-bordercolor", color]), "xc:red", "ppm:-"];
  const fs = new MemoryFileSystem();
  const expectedStderr = warning ? "montage: unrecognized color `banana'\n" : "";
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
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: expectedStderr });
    output = Buffer.concat(stdout);
  } else {
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: expectedStderr });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([3, 3]);
  // Native ImageMagick 7: an unrecognized color resets the border to opaque black.
  expect(actual.data).toEqual(new Uint8Array(Array.from({ length: 9 }, (_, pixel) =>
    pixel === 4 ? [255, 0, 0, 255] : [0, 0, blue, 255]).flat()));
});
