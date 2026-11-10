import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: reset writes explicit unitless 72x72;
// omitting density leaves the pHYs chunk absent.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const fileOutput of [false, true]) {
    it.each([
      { inputs: ["-density", "150", "xc:red"], physical: [150, 150, 0] },
      { inputs: ["-density", "300x150", "xc:red"], physical: [300, 150, 0] },
      { inputs: ["xc:red", "-density", "300x150"], physical: [300, 150, 0] },
      { inputs: ["-density", "300x150", "+density", "xc:red"], physical: [72, 72, 0] },
      { inputs: ["+density", "xc:red"], physical: [72, 72, 0] },
      { inputs: ["xc:red"], physical: undefined },
    ])(`${mode} writes PNG montage density (file=${fileOutput}): $inputs`, async ({ inputs, physical }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, fileOutput ? "/sheet.png" : "png:-"];
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
      const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
      const bytes = fileOutput ? mode === "buffered" || mode === "sync" ? files.get("/sheet.png")! : await fs.readFile("/sheet.png") : stdout!;
      if (fileOutput) expect(stdout?.length ?? 0).toBe(0);
      const resolutions: number[][] = [];
      for (let offset = 8; offset < bytes.length;) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
        const length = view.getUint32(0);
        if (new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)) === "pHYs") {
          expect(length).toBe(9);
          resolutions.push([view.getUint32(8), view.getUint32(12), view.getUint8(16)]);
        }
        offset += length + 12;
      }
      expect(resolutions).toEqual(physical ? [physical] : []);
      expect(decodeImage(bytes)).toMatchObject({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255) });
    });
  }
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { options: ["-density"], error: "missing argument for -density" },
    { options: ["-density", "invalid", "/sheet.png"], error: "invalid argument for option '-density': invalid" }
  ])(`${mode} rejects invalid montage density before replacing output: $options`, async ({ options, error }) => {
    const original = new TextEncoder().encode("original");
    const files = new Map([["/sheet.png", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/sheet.png", original);
    const args = ["xc:red", ...options];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await filesystem.readFile("/sheet.png") : files.get("/sheet.png")).toEqual(original);
  });
}
