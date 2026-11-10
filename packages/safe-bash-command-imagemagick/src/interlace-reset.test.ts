import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

for (const mode of ["buffered", "command"] as const) for (const format of ["png", "gif", "jpg"]) {
  it(`${mode} distinguishes undefined interlace from None for ${format}`, async () => {
    const pixels = Uint8Array.from({ length: 81 }, (_, i) => (7 * i + 1) % 256);
    const source = await sharp(pixels, { raw: { width: 3, height: 9, channels: 3 } }).png().toBuffer();
    // Native ImageMagick: +interlace selects Undefined and enables these encoders.
    for (const [options, progressive] of [
      [[], false],
      [["+interlace"], true],
      [["-interlace", "None", "+interlace"], true],
      [["+interlace", "-interlace", "None"], false]
    ] as const) {
      const output = `/out.${format}`, copy = `/copy.${format}`;
      const files = new Map<string, Uint8Array>([["/in.png", source], [output, new TextEncoder().encode("KEEP")]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["/in.png", ...options, "-write", copy, output];
      let stderr = "";
      const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
      for (const path of [copy, output]) {
        const bytes = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
        expect(await sharp(bytes).metadata()).toMatchObject({ width: 3, height: 9, isProgressive: progressive });
        if (format !== "jpg") expect(await sharp(bytes).raw().toBuffer()).toEqual(Buffer.from(pixels));
      }
    }
  });
}
