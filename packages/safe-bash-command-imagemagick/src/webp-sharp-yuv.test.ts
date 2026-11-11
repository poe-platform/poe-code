import { expect, it } from "vitest";
import { decodeImage, encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const animated of [false, true]) {
  for (const retained of [false, true]) {
    for (const write of [false, true]) {
      it(`applies WebP sharp YUV color conversion (retained=${retained}, write=${write}, animated=${animated})`, async () => {
        const data = Uint8Array.from(Array.from({ length: 64 * 48 }, (_, i) => {
          const x = i % 64, y = Math.floor(i / 64);
          return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256];
        }).flat());
        const input = encodeImage({ format: "png", width: 64, height: 48, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const payloads: Uint8Array[] = [];
        const decoded: Uint8Array[] = [];
        for (const defines of [["-define", "webp:use-sharp-yuv=false"], ["-define", "webp:use-sharp-yuv=true"], [], ["-define", "webp:use-sharp-yuv=false", "+define", "webp:use-sharp-yuv"]]) {
          const result = await runConvertCli(["/in.png", ...(animated ? ["(", "-delay", "20", "/in.png", "-channel", "RGB", "-negate", "+channel", ")", "-loop", "3"] : []), ...defines, ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
          expect(result).toMatchObject({ exitCode: 0 });
          const output = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
          payloads.push(output);
          const image = decodeImage(output);
          if (animated) {
            const second = decodeImage(output, { page: 1 });
            expect(second.data).not.toEqual(image.data);
            expect(readImageMetadata(output)).toMatchObject({ pages: 2, loop: 3 });
          }
          expect(image).toMatchObject({ width: 64, height: 48 });
          expect(image.data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
          decoded.push(image.data);
        }
        expect(payloads[1]).not.toEqual(payloads[0]);
        expect(decoded[1]).not.toEqual(decoded[0]);
        expect(payloads[0]).toEqual(payloads[2]);
        expect(payloads[3]).toEqual(payloads[2]);
      });
    }
  }
}
