import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// IHDR and RGBA16 samples verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "sync", "buffered", "retained"] as const) {
  it.each([
    { coder: "png32", colors: ["123456789abc7654", "1011202130314012"], depth: 8, hex: "121256569a9a76761010202030304040" },
    { coder: "png64", colors: ["dc502080", "2060c040"], depth: 16, hex: "dcdc50502020808020206060c0c04040" },
    { coder: "png32", colors: ["dc502080", "2060c040"], depth: 8, hex: "dcdc50502020808020206060c0c04040" },
    { coder: "png64", colors: ["123456789abc7654", "1011202130314012"], depth: 16, hex: "123456789abc76541011202130314012" }
  ])(`${mode}: forces $coder depth for $colors`, async ({ coder, colors, depth, hex }) => {
    const args = ["-background", "none", ...colors.map(color => `xc:#${color}`), "-geometry", "+0+0", "-tile", "2x1", `${coder}:-`];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(stdout);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const header = new DataView(output.buffer, output.byteOffset);
    expect([header.getUint32(16), header.getUint32(20), output[24], output[25], output[28]]).toEqual([2, 1, depth, 6, 0]);
    const image = decodeImage(output);
    const samples = image.data16 ?? Uint16Array.from(image.data, value => value * 257);
    const rgba = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => rgba.writeUInt16BE(value, index * 2));
    expect(rgba.toString("hex")).toBe(hex);
  });
}
