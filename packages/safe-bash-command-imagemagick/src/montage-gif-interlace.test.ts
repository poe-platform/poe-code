import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

// ImageMagick 7.1.2-35 Q16-HDRI: image descriptor interlace bit and decoded RGBA hash.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const output of ["gif:-", "gif:/sheet.gif"]) {
    it.each([
      { options: ["-interlace", "GIF"], interlace: 1 },
      { options: ["-interlace", "plane"], interlace: 1 },
      { options: ["-interlace", "none"], interlace: 0 },
      { options: [], interlace: 0 },
      { options: ["-interlace", "GIF", "-interlace", "none"], interlace: 0 }
    ])(`${mode} writes ${output} with $options`, async ({ options, interlace }) => {
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      const args = [...Array.from({ length: 4 }, () => ["xc:red", "xc:blue", "xc:lime", "xc:black"]).flat(), "-tile", "1x16", "-geometry", "+0+0", ...options, output];
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
      const bytes = Buffer.from(output === "gif:/sheet.gif"
        ? mode === "buffered" || mode === "sync" ? files.get("/sheet.gif")! : await fs.readFile("/sheet.gif")
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks));
      let at = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
      while (bytes[at] === 33) {
        at += 2;
        while (bytes[at]) at += bytes[at]! + 1;
        at++;
      }
      expect(bytes[at]).toBe(44);
      expect(bytes[at + 9]! & 64).toBe(interlace * 64);
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 1, height: 16 });
      const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
      expect(createHash("sha256").update(pixels).digest("hex"))
        .toBe("51bcd5aa6206dcbd1d0af66ab7aa8d5b2af259b200e8d690ffb4e1161e6f4c48");
    });
  }
}
