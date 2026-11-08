import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([false, true])(`preserves TIFF resolution presence through PNG conversion (${mode}, tags=%s)`, async tagged => {
    const pixels = Uint8Array.from([0, 255, 0, 255].flatMap(value => [value, value, value, 255]));
    const { data } = encodeImage({ width: 2, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "ushort", density: 144, hasAlpha: false }, { format: "tiff", tiffIntegerDepth: 16 });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ifd = view.getUint32(4, true);
    let count = view.getUint16(ifd, true);
    if (!tagged) {
      for (let i = count - 1; i >= 0; i--) {
        const entry = ifd + 2 + i * 12;
        if ([282, 283, 296].includes(view.getUint16(entry, true))) {
          data.copyWithin(entry, entry + 12, ifd + 2 + count * 12 + 4);
          view.setUint16(ifd, --count, true);
        }
      }
      expect(Array.from({ length: count }, (_, i) => view.getUint16(ifd + 2 + i * 12, true))).not.toEqual(expect.arrayContaining([282, 283, 296]));
    }
    const files = new Map([["/input.tif", data]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.tif", data);
    const args = ["/input.tif", "/output.png"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
    const chunks: string[] = [], png = new DataView(output.buffer, output.byteOffset, output.byteLength);
    for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
      chunks.push(new TextDecoder().decode(output.subarray(offset + 4, offset + 8)));
    }
    expect(chunks.includes("pHYs")).toBe(tagged);
    const decoded = decodeImage(output);
    expect(decoded).toMatchObject({ width: 2, height: 2, data: pixels, density: tagged ? 144 : 72 });
    expect(decoded.resolution?.unit).toBe(tagged ? "meter" : undefined);
  });
}
