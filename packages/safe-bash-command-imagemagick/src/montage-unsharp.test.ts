import { createHash } from "node:crypto";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sourceRow = "1e506e285a78326482a0968cb4aaa0b9afa5c8beb4";
const filteredRow = "1a4c6a215777135781bca089bfb1a4b8aea3cdc3b9";
const input = Buffer.concat([Buffer.from("P6\n7 3\n255\n"), Buffer.from(sourceRow.repeat(3), "hex")]);

// Complete PPM output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["in.ppm", "-unsharp", "0x1+1+0"], height: 3, pixels: filteredRow.repeat(3), hash: "83a3f8bf45f8e2d25daf3457d5e2d5daa6c72b5231c4c146d06746f518317c1d" },
    { inputs: ["(", "in.ppm", "-unsharp", "0x1+1+0", ")", "in.ppm"], height: 6, pixels: filteredRow.repeat(3) + sourceRow.repeat(3), hash: "afc22aaebea5011526ba721efee9e51910fd0c3a4cdd87f51d2bcfe09aed6e3e" },
    { inputs: ["in.ppm"], height: 3, pixels: sourceRow.repeat(3), hash: "c20d9afda814f6be7e9aaa18abb4ef9c4f53066ef74c13d31ce1034b68af3d7e" },
  ])(`${mode}: applies unsharp before montage layout: $inputs`, async ({ inputs, height, pixels, hash }) => {
    const args = [...inputs, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context);
      expect(stderr).toEqual([]);
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const files = new Map([["in.ppm", input]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(`P6\n7 ${height}\n255\n`), Buffer.from(pixels, "hex")]));
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
  });
}

for (const retained of [false, true]) {
  it.each([
    { args: ["in.ppm", "-unsharp"], error: "missing argument for -unsharp" },
    { args: ["in.ppm", "-unsharp", "invalid", "sheet.ppm"], error: "Invalid unsharp geometry" },
  ])(`rejects invalid unsharp without replacing output (retained=${retained}): $args`, async ({ args, error }) => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map<string, Uint8Array>([["in.ppm", input], ["sheet.ppm", original]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/sheet.ppm", original);
    const result = await runMontageCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(retained ? await fs.readFile("/sheet.ppm") : files.get("sheet.ppm")).toEqual(original);
  });
}
