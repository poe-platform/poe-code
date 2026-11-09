import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const format of ["tiff", "tiff64"]) {
    for (const endian of ["LSB", "MSB"]) {
      it.each([40, 0, -40])(`writes TIFF page positions (${mode}, ${format}, ${endian}, x=%s)`, async x => {
        const pixels = Uint8Array.from([16, 32, 48, 255, 64, 80, 96, 255, 112, 128, 144, 255, 160, 176, 192, 255]);
        const input = encodeImage({ width: 2, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 80, resolution: { x: 80, y: 40, unit: "inch" }, hasAlpha: false }, { format: "tiff" }).data;
        const files = new Map([["/in.tif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", input);
        const args = ["/in.tif", "-repage", `2x2${x < 0 ? "" : "+"}${x}${x === 0 ? "+0" : "+30"}`, "-define", `tiff:endian=${endian.toLowerCase()}`, "-set", "comment", "position regression", "-define", "tiff:rows-per-strip=1", `${format}:/out.tif`];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength), little = endian === "LSB", big = format === "tiff64";
        const ifd = big ? Number(view.getBigUint64(8, little)) : view.getUint32(4, little);
        const count = big ? Number(view.getBigUint64(ifd, little)) : view.getUint16(ifd, little);
        const positions = new Map<number, number>();
        for (let i = 0; i < count; i++) {
          const at = ifd + (big ? 8 : 2) + i * (big ? 20 : 12), tag = view.getUint16(at, little);
          if (tag !== 286 && tag !== 287) continue;
          expect(view.getUint16(at + 2, little)).toBe(5);
          const valueAt = big ? at + 12 : view.getUint32(at + 8, little);
          positions.set(tag, view.getUint32(valueAt, little) / view.getUint32(valueAt + 4, little));
        }
        expect(positions).toEqual(new Map(x === 0 ? [] : [[286, Math.max(0, x) / 80], [287, 0.75]]));
        const decoded = decodeImage(output);
        expect(decoded.data).toEqual(pixels);
        expect(decoded.properties?.comment).toBe("position regression");
      });
    }
  }
}
