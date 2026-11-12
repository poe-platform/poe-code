import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference rows for a six-color 3x2 input.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-filter", "Point", "-resize", "5x2!"], rows: "ff0000ff000000ff000000ff0000ffffff00ffff0000ffffff00ffff00ff" },
  { options: ["-filter", "Triangle", "-resize", "5x2!"], rows: "ff000099660000ff000066990000ffffff0099ff6600ffff9966ffff00ff" },
  { options: ["-filter", "Lanczos", "-resize", "5x2!"], rows: "ff0008ab6e0000ff00006eab0800fffff70091ff5400ffff9154ffff00f7" },
  { options: ["-filter", "Point", "+filter", "-resize", "5x2!"], rows: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" },
  { options: ["-resize", "5x2!"], rows: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" },
  { options: ["-filter", "Point", "-resize", "5x2!", "+filter"], rows: "ff0000ff000000ff000000ff0000ffffff00ffff0000ffffff00ffff00ff" },
  { options: ["-resize", "5x2!", "-filter", "Point"], rows: "ff0b009e71000fe41c0267a40f00fffff00098fd5b1cf0e48e61fff400ff" },
])(`selects and resets montage resize filters via ${mode}: $options`, async ({ options, rows }) => {
  const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...Buffer.from("ff000000ff000000ffffff0000ffffff00ff", "hex")]);
  const files = new Map([["/in.ppm", input]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  const args = ["/in.ppm", ...options, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
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
  expect([actual.width, actual.height]).toEqual([5, 2]);
  const rgb = Buffer.from(rows, "hex");
  expect(actual.data).toEqual(new Uint8Array(Array.from({ length: 10 }, (_, pixel) => [...rgb.subarray(pixel * 3, pixel * 3 + 3), 255]).flat()));
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { args: ["/out.ppm", "-filter"], error: "missing argument for -filter" },
  { args: ["-filter", "banana", "/out.ppm"], error: "unrecognized image filter 'banana'" },
])(`rejects invalid montage filter settings via ${mode}: $args`, async ({ args, error }) => {
  const original = new TextEncoder().encode("existing output");
  const files = new Map([["/out.ppm", original]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out.ppm", original);
  const argv = ["xc:red", ...args];
  const result = mode === "sync" ? runMontageCliSync(argv, files)
    : await runMontageCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
  expect(mode === "retained" ? await fs.readFile("/out.ppm") : files.get("/out.ppm")).toEqual(original);
});
