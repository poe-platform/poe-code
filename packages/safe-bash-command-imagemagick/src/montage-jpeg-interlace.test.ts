import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const pixels = new Uint8Array(24 * 16 * 3);
for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
  pixels.set([(x * 23) % 256, (y * 29) % 256, ((x + y) * 37) % 256], (y * 24 + x) * 3);
}
const input = Buffer.concat([Buffer.from("P6\n24 16\n255\n"), pixels]);

// ImageMagick 7.1.2-35 Q16-HDRI emits SOF2 for JPEG/plane/line and SOF0 for none/default.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const output of ["jpeg:-", "/sheet.jpg"]) {
    it.each([
      { options: ["-interlace", "JPEG"], marker: 0xc2 },
      { options: ["-interlace", "plane"], marker: 0xc2 },
      { options: ["-interlace", "line"], marker: 0xc2 },
      { options: ["-interlace", "none"], marker: 0xc0 },
      { options: [], marker: 0xc0 },
      { options: ["-interlace", "JPEG", "-interlace", "none"], marker: 0xc0 }
    ])(`${mode} writes ${output} with $options`, async ({ options, marker }) => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.ppm", input);
      const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
      const args = ["/in.ppm", "-geometry", "+0+0", "-tile", "1x1", ...options, output];
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
      const bytes = output === "/sheet.jpg"
        ? mode === "buffered" || mode === "sync" ? files.get(output)! : await fs.readFile(output)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
      expect(Array.from(bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
      let offset = 2;
      while (offset < bytes.length && bytes[offset + 1] !== 0xc0 && bytes[offset + 1] !== 0xc2) {
        offset += 2 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
      }
      expect(bytes[offset + 1]).toBe(marker);
      expect(bytes[offset + 9]).toBe(3);
      expect([bytes[offset + 11], bytes[offset + 14], bytes[offset + 17]]).toEqual([0x11, 0x11, 0x11]);
      const decoded = decodeImage(bytes);
      expect([decoded.width, decoded.height, decoded.space, decoded.channels]).toEqual([24, 16, "srgb", 3]);
    });
  }
}
