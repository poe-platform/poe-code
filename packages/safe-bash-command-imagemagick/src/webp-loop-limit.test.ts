import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2 caps positive WebP loop counts at the ANIM uint16 limit.
const cases = [[0, 0], [1, 1], [65534, 65534], [65535, 65535], [65536, 65535], [65537, 65535], [100000, 65535]] as const;

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    for (const lossless of [false, true]) {
      it.each(cases)(`writes loop %i as %i (retained=${retained}, write=${write}, lossless=${lossless})`, async (loop, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const result = await runConvertCli([
          "-delay", "2", "xc:red", "-delay", "3", "xc:blue", "-loop", String(loop),
          "-define", `webp:lossless=${lossless}`,
          ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])
        ], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
        expect(readImageMetadata(bytes)).toMatchObject({ pages: 2, delay: [20, 30], loop: expected });
        for (const [page, color] of [[255, 0, 0, 255], [0, 0, 255, 255]].entries()) {
          const frame = decodeImage(bytes, { page });
          expect([frame.width, frame.height]).toEqual([1, 1]);
          for (const [channel, value] of color.entries()) {
            expect(Math.abs(frame.data[channel]! - value)).toBeLessThanOrEqual(lossless ? 0 : 10);
          }
        }
      });
    }
  }
}
