import { deflateSync } from "node:zlib";
import { joinBytes, pngChunk, rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "./raster.js";

export interface StoryRasterCase {
  name: string; bytes: Uint8Array; mime: string; width: number; height: number; x: number; y: number;
}
export const storyRasterCases: StoryRasterCase[] = [];
for (const [color, depths, channels] of [[0, [1, 2, 4, 8, 16], 1], [2, [8, 16], 3], [3, [1, 2, 4, 8], 1], [4, [8, 16], 2], [6, [8, 16], 4]] as const)
for (const depth of depths) for (const interlace of [0, 1]) for (const wide of [false, true]) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  const width = wide ? 3 : 1, height = wide ? 5 : 1;
  view.setUint32(0, width); view.setUint32(4, height); header.set([depth, color, 0, 0, interlace], 8);
  // The nonempty Adam7 passes for an original 3x5 transparent pixel grid.
  const passes = !wide ? [[1, 1]] : interlace ? [[1, 1], [1, 1], [1, 2], [2, 1], [1, 3], [3, 2]] : [[3, 5]];
  const pixels = joinBytes(...passes.flatMap(([w, h]) => Array.from({ length: h! }, () => new Uint8Array(1 + Math.ceil(w! * channels * depth / 8)))));
  const bytes = joinBytes(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk("IHDR", header),
    ...(color === 3 ? [pngChunk("PLTE", Uint8Array.of(20, 40, 60))] : []), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", new Uint8Array()));
  storyRasterCases.push({ name: `PNG ${width}x${height} color=${color} depth=${depth} interlace=${interlace}`, bytes, mime: "image/png", width, height, x: 72, y: 72 });
}
for (const [x, y, unit, expectedX, expectedY] of [[0, 0, 1, 72, 72], [0, 945, 1, 72, 24.003], [1654, 0, 1, 42.0116, 72], [1654, 945, 1, 42.0116, 24.003], [10, 20, 0, 72, 72]] as const)
  storyRasterCases.push({ name: `PNG density ${x}/${y}/${unit}`, bytes: rasterPng(1, 1, [x, y, unit]), mime: "image/png", width: 1, height: 1, x: expectedX, y: expectedY });
const png = rasterPng();
storyRasterCases.push({ name: "PNG empty initial IDAT and text metadata", bytes: joinBytes(png.slice(0, 33), pngChunk("tEXt", new TextEncoder().encode("audit\0Coastal marker")), pngChunk("IDAT", new Uint8Array()), png.slice(33)), mime: "image/png", width: 1, height: 1, x: 72, y: 72 });
for (const [unit, x, y, expectedX, expectedY] of [[0, 1, 1, 72, 72], [1, 72, 0, 72, 72], [1, 0, 144, 72, 144], [2, 10, 20, 25.4, 50.8]] as const)
  storyRasterCases.push({ name: `JPEG JFIF ${unit}/${x}/${y}`, bytes: rasterJpeg(2, 3, [unit, x, y]), mime: "image/jpeg", width: 2, height: 3, x: expectedX, y: expectedY });
for (const little of [false, true]) {
  storyRasterCases.push({ name: `JPEG Exif centimetres little=${little}`, bytes: rasterJpeg(2, 3, [0, 1, 1], rasterTiff(little, 3, [85, 2], [337, 4])), mime: "image/jpeg", width: 2, height: 3, x: 107.95, y: 213.995 });
  for (const [unit, x, y] of [[1, 72, 72], [2, 42.5, 84.25], [3, 107.95, 213.995]])
    storyRasterCases.push({ name: `TIFF fractional density unit=${unit} little=${little}`, bytes: rasterTiff(little, unit, [85, 2], [337, 4]), mime: "image/tiff", width: 1, height: 1, x: x!, y: y! });
}
for (const version of ["87a", "89a"]) storyRasterCases.push({ name: `GIF ${version}`, bytes: rasterGif(version), mime: "image/gif", width: 1, height: 1, x: 72, y: 72 });
for (const height of [-1, 1]) storyRasterCases.push({ name: `BMP height=${height}`, bytes: rasterBmp(1, height, 1654, 0), mime: "image/bmp", width: 1, height: 1, x: 42.0116, y: 72 });
