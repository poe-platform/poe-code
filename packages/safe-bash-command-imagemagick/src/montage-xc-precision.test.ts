import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete Netpbm output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { input: "xc:#123412341234", geometry: ["-geometry", "+0+0"], depth: "16", format: "pgm", hex: "50350a3120310a36353533350a1234" },
    { input: "xc:#123412341234", geometry: [], depth: "16", format: "ppm", hex: "50360a3120310a36353533350a123412341234" },
    { input: "xc:#121212", geometry: [], depth: "16", format: "pgm", hex: "50350a3120310a36353533350a1212" },
    { input: "xc:#123412341234", geometry: [], depth: "8", format: "pgm", hex: "50350a3120310a3235350a12" },
    { input: "canvas:#123456789abc", geometry: [], depth: "16", format: "ppm", hex: "50360a3120310a36353533350a123456789abc" },
  ])(`${mode}: preserves montage color precision: $input $geometry $depth $format`, async ({ input, geometry, depth, format, hex }) => {
    const args = ["-tile", "x1", "-geometry", "1x1+0+0", ...geometry, input, "-depth", depth, `${format}:-`];
    const fs = new MemoryFileSystem();
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
      expect((await command.execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
