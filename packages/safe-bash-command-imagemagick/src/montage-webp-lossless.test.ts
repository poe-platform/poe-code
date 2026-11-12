import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  for (const destination of ["webp:-", "/sheet.webp"]) {
    it.each([
      { quality: 80, options: ["-define", "webp:lossless=true"], lossless: true },
      { quality: 100, options: ["-define", "webp:lossless=false"], lossless: false },
      { quality: 80, options: [], lossless: false },
      { quality: 100, options: [], lossless: true },
      { quality: 80, options: ["-define", "webp:lossless=true", "+define", "webp:lossless"], lossless: false },
      { quality: 100, options: ["-define", "webp:lossless=false", "+define", "webp:lossless"], lossless: true }
    ])(`honors montage WebP mode via ${mode} to ${destination}: $quality $options`, async ({ quality, options, lossless }) => {
      const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-quality", String(quality), ...options, destination];
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      let output: Uint8Array;
      if (mode === "magick" || mode === "montage") {
        const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
        const stdout: Uint8Array[] = [];
        const stderr: unknown[] = [];
        const context: CommandContext = {
          command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
          stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
        };
        const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
        expect((await command.execute(context)).exitCode).toBe(0);
        expect(stderr).toEqual([]);
        output = destination === "webp:-" ? Buffer.concat(stdout) : await fs.readFile(destination);
      } else {
        const result = mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        output = destination === "webp:-" ? result.stdoutBytes!
          : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
      }
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      expect(new TextDecoder().decode(output.subarray(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(output.subarray(8, 12))).toBe("WEBP");
      expect(view.getUint32(4, true) + 8).toBe(output.length);
      const chunks: string[] = [];
      let offset = 12;
      while (offset < output.length) {
        chunks.push(new TextDecoder().decode(output.subarray(offset, offset + 4)));
        const size = view.getUint32(offset + 4, true);
        offset += 8 + size + (size & 1);
      }
      expect(offset).toBe(output.length);
      expect(chunks).toEqual([lossless ? "VP8L" : "VP8 "]);
      const decoded = decodeImage(output);
      expect(decoded).toMatchObject({ width: 2, height: 1 });
      // Native ImageMagick preserves exact RGBA8 pixels only in lossless mode.
      if (lossless) expect(Buffer.from(decoded.data).toString("hex")).toBe("ff0000ff0000ffff");
    });
  }
}
