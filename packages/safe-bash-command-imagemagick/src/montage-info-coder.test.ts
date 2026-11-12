import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reports a coder only on the first sheet.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { inputs: ["xc:red", "/in.ppm"], tile: "2x1", format: "%m|%[magick];", stdout: "XC|XC;" },
    { inputs: ["/in.ppm", "xc:red"], tile: "2x1", format: "%m|%[magick];", stdout: "PPM|PPM;" },
    { inputs: ["/in.ppm", "xc:red"], tile: "1x1", format: "%m|%[magick];", stdout: "PPM|PPM;|;" },
    { inputs: ["xc:red", "/in.ppm"], tile: "1x1", format: "%m|%[magick];", stdout: "XC|XC;|;" },
    { inputs: ["/in.ppm", "/in.ppm"], tile: "1x1", format: "%m|%[magick];", stdout: "PPM|PPM;|;" },
    { inputs: ["/in.ppm", "xc:red"], tile: "2x1", format: "%wx%h", stdout: "3x1" }
  ])(`${mode}: formats montage $inputs with $tile and $format`, async ({ inputs, tile, format, stdout }) => {
    const bytes = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", bytes);
    const args = [...inputs, "-tile", tile, "-geometry", "+0+0", "-format", format, "info:"];
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { errors.push(bytes.slice()); } }
      });
      expect(result.exitCode).toBe(0);
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(Buffer.concat(output).toString()).toBe(stdout);
    } else {
      const files = new Map([["/in.ppm", bytes]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stdout, stderr: "" });
    }
  });
}
