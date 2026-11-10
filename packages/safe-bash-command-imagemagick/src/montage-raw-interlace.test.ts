import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete P6 samples from ImageMagick 7.1.2-35 Q16-HDRI for the same raw bytes.
const samples = "102030405060708090a0b0c0";
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { options: [], expected: samples },
    { options: ["-interlace", "None"], expected: samples },
    { options: ["-interlace", "Line"], expected: "1030502040607090b080a0c0" },
    { options: ["-interlace", "Plane"], expected: "1050902060a03070b04080c0" },
    { options: ["-interlace", "pLaNe"], expected: "1050902060a03070b04080c0" },
    { options: ["-interlace", "Plane", "-interlace", "None"], expected: samples },
    { options: ["-interlace", "Line", "+interlace"], expected: samples }
  ])(`${mode} decodes raw RGB with $options`, async ({ options, expected }) => {
    const bytes = Buffer.from(samples, "hex"), fs = new MemoryFileSystem();
    await fs.writeFile("/colors", bytes);
    const files = new Map([["/colors", bytes]]);
    const args = ["-geometry", "+0+0", "-tile", "x1", "-size", "2x2", "-depth", "8",
      ...options, "rgb:/colors", "ppm:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const result = mode === "magick" || mode === "montage" ? await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(output!).toString("hex")).toBe("50360a3220320a3235350a" + expected);
  });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([
    { options: ["-interlace"], error: "missing argument for -interlace" },
    { options: ["-interlace", "invalid", "/sheet.ppm"], error: "unsupported interlace type 'invalid'" }
  ])(`${mode} rejects invalid interlace without replacing output: $options`, async ({ options, error }) => {
    const original = new TextEncoder().encode("original"), files = new Map([["/sheet.ppm", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/sheet.ppm", original);
    const args = ["xc:black", ...options];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await filesystem.readFile("/sheet.ppm") : files.get("/sheet.ppm")).toEqual(original);
  });
}
