import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete PPM output verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { depth: "16", options: ["-endian", "MSB"], width: 1, maxval: 65535, pixels: "123456789abc" },
    { depth: "16", options: ["-endian", "LSB"], width: 1, maxval: 65535, pixels: "34127856bc9a" },
    { depth: "8", options: [], width: 2, maxval: 255, pixels: "123456789abc" },
  ])(`${mode}: reads raw montage pixels at depth $depth with $options`, async ({ depth, options, width, maxval, pixels }) => {
    const args = ["-geometry", "+0+0", "-tile", "x1", "-size", "1x1", "-depth", depth, ...options, "rgb:one", "ppm:-"];
    const input = Buffer.from("123456789abc", "hex");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/one", input);
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const result = await command.execute(context);
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
      output = Buffer.concat(chunks);
    } else {
      const files = new Map([["one", input]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output)).toEqual(Buffer.concat([
      Buffer.from(`P6\n${width} 1\n${maxval}\n`), Buffer.from(pixels, "hex")
    ]));
  });
}

it.each([
  { args: ["-endian"], error: "missing argument for -endian" },
  { args: ["-endian", "invalid", "rgb:one", "sheet.ppm"], error: "unrecognized endian type 'invalid'" },
])("rejects invalid montage byte order before writing output: $args", ({ args, error }) => {
  const files = new Map([["sheet.ppm", new Uint8Array([42])]]);
  expect(runMontageCliSync(args, files)).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
  expect(files.get("sheet.ppm")).toEqual(new Uint8Array([42]));
});
