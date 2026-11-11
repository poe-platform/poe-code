import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const interlace of [false, true]) {
    for (const explicitDepth of [false, true]) {
      it.each([[2, 1], [3, 2], [5, 4], [17, 8]])(`packs %i colors, retained=${retained}, interlace=${interlace}, explicitDepth=${explicitDepth}`, async (colors, depth) => {
        // Odd rows exercise padding; wide rows cross the storage encoder's chunks.
        const width = 1031, height = 3;
        const rgb = Uint8Array.from({ length: width * height * 3 }, (_, i) => Math.floor(i / 3) % colors! + 2 - i % 3);
        const source = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]);
        const args = ["/input.ppm", "-define", "png:color-type=3", ...(explicitDepth ? ["-define", "png:bit-depth=8"] : []), ...(interlace ? ["-interlace", "PNG"] : []), "png:-"];
        let bytes: Uint8Array;
        if (retained) {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input.ppm", source);
          const output: Uint8Array[] = [], errors: Uint8Array[] = [];
          const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { output.push(chunk.slice()); } },
            stderr: { async write(chunk) { errors.push(chunk.slice()); } }
          });
          expect(result.exitCode).toBe(0);
          expect(Buffer.concat(errors).toString()).toBe("");
          bytes = Buffer.concat(output);
        } else {
          const result = await runConvertCli(args, new Map([["/input.ppm", source]]));
          expect(result.exitCode).toBe(0);
          expect(result.stderr).toBe("");
          bytes = result.stdoutBytes!;
        }
        expect([bytes[24], bytes[25], bytes[28]]).toEqual([explicitDepth ? 8 : depth, 3, interlace ? 1 : 0]);
        expect(decodeImage(bytes).data).toEqual(Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : rgb[Math.floor(i / 4) * 3 + i % 4]!));
      });
    }
  }
}
