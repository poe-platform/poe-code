import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Independent bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const retained of [false, true]) {
  for (const write of [false, true]) {
    for (const rle of [false, true]) {
      for (const alpha of ["80", "40", ""]) {
        it.each([4, 5, 6, 8])(`writes depth %i (retained=${retained}, write=${write}, rle=${rle}, alpha=${alpha})`, async depth => {
          const files = new Map<string, Uint8Array>();
          const filesystem = new MemoryFileSystem();
          const result = await runConvertCli([`xc:#123456${alpha}`, "-depth", String(depth),
            "-compress", rle ? "RLE" : "None",
            ...(write ? ["-write", "/out.tga", "/final.png"] : ["/out.tga"])],
          retained ? { filesystem, cwd: "/" } : files);
          expect(result).toMatchObject({ exitCode: 0 });
          const bytes = retained ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
          const rgb = depth === 4 ? [0x55, 0x33, 0x11] : depth === 6 ? [0x55, 0x35, 0x10] : [0x56, 0x34, 0x12];
          const opacity = alpha === "80" ? { 4: 0x88, 6: 0x82, 8: 0x80 } : { 4: 0x44, 6: 0x41, 8: 0x40 };
          expect([...bytes.subarray(16)]).toEqual([
            depth === 5 ? 16 : alpha ? 32 : 24,
            0x20 | (alpha ? depth === 5 ? 1 : 8 : 0),
            ...(rle ? [0] : []),
            ...(depth === 5 ? [0xca, alpha === "80" ? 0x88 : 0x08] : [...rgb, ...(alpha ? [opacity[depth as 4 | 6 | 8]] : [])])
          ]);
        });
      }
    }
  }
}
