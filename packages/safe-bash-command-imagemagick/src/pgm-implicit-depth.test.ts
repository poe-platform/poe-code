import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI uses source bit depth, rounded up from MAXVAL.
for (const mode of ["buffered", "sync", "command"] as const) for (const format of ["pgm", "ppm", "pam"] as const) {
  it.each([
    { maxval: 511, raster: "0000000100ff01ff", options: [], maximum: 511, expected: "0000000100ff01ff" },
    { maxval: 1000, raster: "0000000100ff03e8", options: [], maximum: 1023, expected: "00000001010503ff" },
    { maxval: 511, raster: "0000000100ff01ff", options: ["-depth", "9"], maximum: 511, expected: "0000000100ff01ff" },
    { maxval: 511, raster: "0000000100ff01ff", options: ["-depth", "16"], maximum: 65535, expected: "000000807fbfffff" }
  ])(`${mode}: writes ${format} MAXVAL=$maxval with options $options`, async ({ maxval, raster, options, maximum, expected }) => {
    const input = Buffer.concat([Buffer.from(`P5\n4 1\n${maxval}\n`), Buffer.from(raster, "hex")]);
    const header = format === "pam" ? `P7\nWIDTH 4\nHEIGHT 1\nDEPTH 1\nMAXVAL ${maximum}\nTUPLTYPE GRAYSCALE\nENDHDR\n` : `${format === "pgm" ? "P5" : "P6"}\n4 1\n${maximum}\n`;
    const samples = Buffer.from(expected, "hex");
    const output = Buffer.concat([Buffer.from(header), format === "ppm"
      ? Buffer.concat([0, 2, 4, 6].flatMap(offset => Array(3).fill(samples.subarray(offset, offset + 2)))) : samples]);
    const args = ["/in.pnm", ...options, mode === "command" ? `${format}:-` : `/out.${format}`];
    if (mode !== "command") {
      const files = new Map<string, Uint8Array>([["/in.pnm", input]]);
      const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(Buffer.from(files.get(`/out.${format}`)!)).toEqual(output);
      return;
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(Buffer.concat(stdout)).toEqual(output);
  });
}
