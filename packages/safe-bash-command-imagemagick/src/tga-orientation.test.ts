import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const descriptor of [0, 0x10, 0x20, 0x30]) {
    for (const rle of [false, true]) {
      for (const alpha of [false, true]) {
        it(`exposes normalized TGA orientation (${mode}, origin=${descriptor}, rle=${rle}, alpha=${alpha})`, async () => {
          // Six distinct pixels in display order; encode the descriptor's scan order directly.
          const pixels = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 238, 0], [153, 17, 119], [36, 83, 132]];
          const expected = Uint8Array.from(pixels.flatMap((pixel, i) => [...pixel, alpha ? i * 51 : 255]));
          const header = new Uint8Array(18);
          header[2] = rle ? 10 : 2; header[12] = 3; header[14] = 2;
          header[16] = alpha ? 32 : 24; header[17] = descriptor | (alpha ? 8 : 0);
          const payload: number[] = rle ? [5] : [];
          for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
              const y = descriptor & 0x20 ? row : 1 - row;
              const x = descriptor & 0x10 ? 2 - col : col;
              const i = y * 3 + x, [r, g, b] = pixels[i]!;
              payload.push(b!, g!, r!);
              if (alpha) payload.push(i * 51);
            }
          }
          const bytes = Uint8Array.from([...header, ...payload]);
          const files = new Map([["/input.tga", bytes]]), filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/input.tga", bytes);
          const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
          const args = ["/input.tga", "-format", "%[orientation]", "info:"];
          const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
          expect(result).toEqual({ exitCode: 0, stdout: "TopLeft", stderr: "" });
          expect(await runIdentifyCli(["-format", "%[orientation]", "/input.tga"], input))
            .toEqual({ exitCode: 0, stdout: "TopLeft", stderr: "" });
          const convert = ["/input.tga", "-auto-orient", "/output.png"];
          expect(mode === "sync" ? runConvertCliSync(convert, files) : await runConvertCli(convert, input))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
          const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
          expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, orientation: 1, data: expected });
        });
      }
    }
  }
}
