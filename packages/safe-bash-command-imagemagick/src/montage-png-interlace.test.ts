import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

// ImageMagick 7.1.2-35 Q16-HDRI: PNG32 IHDR and decoded big-endian RGBA16 samples.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const output of ["png32:-", "png32:/sheet.png"]) {
    it.each([
      { options: ["-interlace", "PNG"], interlace: 1 },
      { options: ["-interlace", "plane"], interlace: 1 },
      { options: ["-interlace", "none"], interlace: 0 },
      { options: [], interlace: 0 },
      { options: ["-interlace", "PNG", "-interlace", "none"], interlace: 0 }
    ])(`${mode} writes ${output} with $options`, async ({ options, interlace }) => {
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      const args = ["-background", "none", "-size", "9x9", "xc:red", "xc:blue", "-geometry", "+0+0", "-tile", "2x1", ...options, output];
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
      const bytes = Buffer.from(output === "png32:/sheet.png"
        ? mode === "buffered" || mode === "sync" ? files.get("/sheet.png")! : await fs.readFile("/sheet.png")
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks));
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[24], bytes[25], bytes[28]])
        .toEqual([18, 9, 8, 6, interlace]);
      const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
      const rgba16 = Buffer.alloc(pixels.length * 2);
      for (let index = 0; index < pixels.length; index++) rgba16.writeUInt16BE(pixels[index]! * 257, index * 2);
      expect(createHash("sha256").update(rgba16).digest("hex"))
        .toBe("21bc375516eeb80cad5e6252d6f4cda56045cf7ea9968482bf25a8932e811cf2");
    });
  }
}
