import { joinBytes, pngChunk, rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "./raster.js";

export const invalidStoryRasters: { name: string; bytes: Uint8Array }[] = [
  { name: "unknown signature", bytes: Uint8Array.of(37, 19, 83) },
  { name: "PNG truncated header", bytes: rasterPng().slice(0, 30) },
  { name: "PNG zero width", bytes: rasterPng(0) },
  { name: "PNG out-of-domain width", bytes: rasterPng(0x80000000) },
  { name: "PNG invalid density unit", bytes: rasterPng(1, 1, [1, 1, 2]) },
  { name: "JPEG truncated JFIF", bytes: rasterJpeg().slice(0, 16) },
  { name: "JPEG zero height", bytes: rasterJpeg(1, 0) },
  { name: "JPEG invalid density unit", bytes: rasterJpeg(1, 1, [3, 1, 1]) },
  { name: "GIF truncated global palette", bytes: rasterGif().slice(0, 15) },
  { name: "BMP truncated DIB", bytes: rasterBmp().slice(0, 36) },
  { name: "BMP negative width", bytes: rasterBmp(-1) },
  { name: "BMP zero height", bytes: rasterBmp(1, 0) },
  { name: "BMP negative density", bytes: rasterBmp(1, 1, -1) }
];
const png = rasterPng();
const checksum = png.slice(); checksum[29] = checksum[29]! ^ 1;
const density = new Uint8Array(9); density[8] = 1;
invalidStoryRasters.push({ name: "PNG corrupt checksum", bytes: checksum },
  { name: "PNG duplicate density", bytes: joinBytes(png.slice(0, 33), pngChunk("pHYs", density), pngChunk("pHYs", density), png.slice(33)) });
const jpeg = rasterJpeg(); new DataView(jpeg.buffer).setUint16(4, 65535);
const gif = rasterGif(); new DataView(gif.buffer).setUint16(6, 0, true);
const bmp = rasterBmp(); new DataView(bmp.buffer).setUint32(10, 0xffffffff, true);
invalidStoryRasters.push({ name: "JPEG unsafe segment length", bytes: jpeg }, { name: "GIF zero width", bytes: gif }, { name: "BMP unsafe pixel offset", bytes: bmp });
for (const little of [false, true]) {
  const unsafe = rasterTiff(little); new DataView(unsafe.buffer).setUint32(42, 0xffffffff, little);
  const cycle = rasterTiff(little); new DataView(cycle.buffer).setUint32(70, 8, little);
  const zero = rasterTiff(little); new DataView(zero.buffer).setUint32(18, 0, little);
  for (const [name, bytes] of [
    ["truncated rational", rasterTiff(little).slice(0, 80)], ["unsafe rational offset", unsafe], ["cyclic directory", cycle],
    ["zero width", zero], ["invalid density unit", rasterTiff(little, 9)],
    ["zero physical numerator", rasterTiff(little, 2, [0, 1])], ["zero denominator", rasterTiff(little, 2, [1, 0])]
  ] as const) {
    invalidStoryRasters.push({ name: `TIFF ${name} little=${little}`, bytes });
    if (name !== "zero width") invalidStoryRasters.push({ name: `JPEG Exif ${name} little=${little}`, bytes: rasterJpeg(2, 3, [0, 1, 1], bytes) });
  }
}
