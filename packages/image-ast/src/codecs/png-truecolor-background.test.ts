import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngImage, encodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

for (const retained of [false, true])
for (const background of [false, true])
it.each(["png24", "png32", "png48", "png64"] as const)(`writes truecolor PNG background at the output depth (stored=${retained}, background=${background}): %s`, async pngCoder => {
  const alpha = pngCoder === "png32" || pngCoder === "png64";
  const data = Uint8Array.of(255, 0, 0, alpha ? 128 : 255, 0, 0, 255, 255);
  const backgroundColor = { r: 18, g: 52, b: 86, a: 0 };
  const image: RgbaImage = {
    width: 2, height: 1, data, format: "png", space: "srgb", channels: alpha ? 4 : 3,
    hasAlpha: alpha, depth: "uchar", density: 72, ...(background ? { backgroundColor } : {})
  };
  const chunks: Uint8Array[] = [];
  if (retained) {
    const storage = { allocate() { return 0; }, async write() {}, async read(offset: number, length: number) {
      return data.slice(offset, offset + length);
    } };
    for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, { pngCoder })) chunks.push(chunk);
  } else chunks.push(encodePngImage(image, { pngCoder }));
  const output = Buffer.concat(chunks);
  const actual: number[][] = [];
  for (let offset = 8; offset < output.length; offset += output.readUInt32BE(offset) + 12) {
    if (output.toString("ascii", offset + 4, offset + 8) !== "bKGD") continue;
    expect(output.readUInt32BE(offset)).toBe(6);
    actual.push([0, 2, 4].map(channel => output.readUInt16BE(offset + 8 + channel)));
  }
  const scale = pngCoder === "png48" || pngCoder === "png64" ? 257 : 1;
  expect(actual).toEqual(background ? [[18 * scale, 52 * scale, 86 * scale]] : []);
  const decoded = decodePngImage(output);
  expect(decoded.data).toEqual(data);
  expect(decoded.backgroundColor).toEqual(background ? { ...backgroundColor, a: 255 } : undefined);
});
