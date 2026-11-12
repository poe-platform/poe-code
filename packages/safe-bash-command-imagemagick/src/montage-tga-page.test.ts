import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: page dimensions do not resize the raster.
for (const mode of ["magick", "montage", "buffered", "retained", "sync"] as const) {
  for (const fileOutput of [false, true]) {
    it.each([
      { page: [], x: 0, y: 0 },
      { page: ["-page", "4x4+1+2"], x: 1, y: 2 },
      { page: ["-page", "4x4+4+7"], x: 4, y: 7 },
      { page: ["-page", "4x4+4+7", "+page"], x: 0, y: 0 }
    ])(`preserves TGA origin and pixels via ${mode} (file=${fileOutput}): $page`, async ({ page, x, y }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-tile", "2x2", "-geometry", "+0+0",
        ...page, `tga:${fileOutput ? "/sheet.tga" : "-"}`];
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
      const bytes = fileOutput ? mode === "buffered" || mode === "sync" ? files.get("/sheet.tga")! : await fs.readFile("/sheet.tga") : stdout;
      if (fileOutput) expect(stdout.length).toBe(0);
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(bytes[2]).toBe(2);
      expect([header.getUint16(8, true), header.getUint16(10, true)]).toEqual([x, y]);
      expect([header.getUint16(12, true), header.getUint16(14, true), bytes[16], bytes[17]]).toEqual([2, 2, 24, 0x20]);
      const image = decodeImage(bytes);
      expect([image.width, image.height]).toEqual([2, 2]);
      expect(Buffer.from(image.data).toString("hex")).toBe("ff0000ff00ff00ff0000ffffffffffff");
    });
  }
}
