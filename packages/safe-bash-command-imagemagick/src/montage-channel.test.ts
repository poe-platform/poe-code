import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels for the 7x3 color edge.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-channel", "R", "-resize", "4x3!"], row: "1b5a784e968cb6aaa0c1beb4" },
  { options: ["-channel", "R", "+channel", "-resize", "4x3!"], row: "1b51724e6f82b6a89bc1b8ae" },
  { options: ["-resize", "4x3!"], row: "1b51724e6f82b6a89bc1b8ae" },
  { options: ["-channel", "R", "-resize", "4x3!", "+channel"], row: "1b5a784e968cb6aaa0c1beb4" },
])(`resizes selected montage channels via ${mode}: $options`, async ({ options, row }) => {
  const edge = [30, 80, 110, 40, 90, 120, 50, 100, 130, 160, 150, 140, 180, 170, 160, 185, 175, 165, 200, 190, 180];
  const input = new Uint8Array([...new TextEncoder().encode("P6\n7 3\n255\n"), ...edge, ...edge, ...edge]);
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
  expect([actual.width, actual.height]).toEqual([4, 3]);
  const rgb = Buffer.from(row.repeat(3), "hex");
  expect(actual.data).toEqual(new Uint8Array(Array.from({ length: 12 }, (_, pixel) => [...rgb.subarray(pixel * 3, pixel * 3 + 3), 255]).flat()));
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { args: ["/out.ppm", "-channel"], error: "missing argument for -channel" },
  { args: ["-channel", "banana", "/out.ppm"], error: "unrecognized channel type 'banana'" },
])(`rejects invalid montage channel settings via ${mode}: $args`, async ({ args, error }) => {
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
