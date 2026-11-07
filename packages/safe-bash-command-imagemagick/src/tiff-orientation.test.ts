import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained"] as const) {
  for (const format of ["jpeg", "png"] as const) {
    it.each([false, true])(`converts TIFF directory orientation to ${format} without EXIF (${mode}, auto-orient=%s)`, async autoOrient => {
      const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160].flatMap(value => [value, value, value, 255]));
      const { data } = encodeImage({ width: 3, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6 }, { format: "tiff" });
      const files = new Map([["/input.tif", data]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/input.tif", data);
      const output = `/output.${format}`;
      expect(await runConvertCli(["/input.tif", ...(autoOrient ? ["-auto-orient"] : []), output], mode === "buffered" ? files : { filesystem, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const bytes = mode === "buffered" ? files.get(output)! : await filesystem.readFile(output);
      const metadata = readImageMetadata(bytes);
      expect([metadata.width, metadata.height]).toEqual(autoOrient ? [2, 3] : [3, 2]);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBe(format === "jpeg" ? undefined : autoOrient ? 1 : 6);
      if (format === "png") {
        const expected = autoOrient ? Uint8Array.from([3, 0, 4, 1, 5, 2].flatMap(index => Array.from(pixels.subarray(index * 4, index * 4 + 4)))) : pixels;
        expect(decodeImage(bytes).data).toEqual(expected);
        const chunks: string[] = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let offset = 8; offset < bytes.length; offset += view.getUint32(offset) + 12) chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
        expect(chunks).toContain("orNT");
        expect(chunks).not.toContain("eXIf");
      }
    });
  }
}
