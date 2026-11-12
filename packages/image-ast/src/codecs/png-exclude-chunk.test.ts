import { expect, it } from "vitest";
import { encodeImage } from "./index.js";
import { decodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

for (const stored of [false, true]) {
  it.each(["cHRM", "bKGD", "gAMA", "pHYs", "iTXt", "eXIf", "caNv", "IHDR", "IDAT", "IEND", "all"])(`excludes only optional PNG chunks (stored=${stored}): %s`, async excluded => {
    const data = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
    const image = {
      format: "png" as const, space: "srgb" as const, channels: 4 as const, depth: "uchar" as const, density: 72, hasAlpha: false, width: 2, height: 1, data, gamma: 0.45455, chromaticity: {}, orientation: 1,
      resolution: { x: 72, y: 96, unit: "inch" as const },
      virtualCanvas: { width: 4, height: 4, x: 1, y: 1 },
      backgroundColor: { r: 255, g: 255, b: 255, a: 255 }, properties: { comment: "keep me" }
    };
    const options = { format: "png" as const, pngCoder: "png24" as const, pngExcludeChunks: [excluded] };
    const parts: Uint8Array[] = [];
    if (stored) {
      const storage = { allocate() { return 0; }, async write() {}, async read(offset: number, length: number) { return data.slice(offset, offset + length); } };
      for await (const part of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) parts.push(part);
    } else parts.push(encodeImage(image, options).data);
    const encoded = Buffer.concat(parts);
    const types: string[] = [];
    for (let offset = 8; offset < encoded.length; offset += encoded.readUInt32BE(offset) + 12) types.push(encoded.toString("ascii", offset + 4, offset + 8));
    const optional = ["cHRM", "bKGD", "gAMA", "pHYs", "iTXt", "eXIf", "caNv"];
    expect([...new Set(types)].sort()).toEqual(["IHDR", "IDAT", "IEND", ...optional.filter(type => excluded !== "all" && type !== excluded)].sort());
    expect(decodePngImage(encoded).data).toEqual(data);
  });
}
