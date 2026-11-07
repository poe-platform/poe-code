import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "./index.js";
import { decodeTiffImage, encodeTiffImage } from "./codecs/netpbm.js";
import { decodeImage } from "./codecs/index.js";

for (const compression of ["none", "lzw", "deflate", "packbits", "jpeg"] as const) {
 it.each([1, 3, 4] as const)(`preserves ${compression} TIFF across buffered and retained SDK output with %i channels`, async channels => {
  let seed = 12345;
  const pixels = Uint8Array.from({length: 137 * 101 * channels}, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; });
  const input = sharp(pixels, {raw: {width: 137, height: 101, channels}}).png().toBufferSync();
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.png", input);
  const buffered = sharp(input).tiff({compression}).toBufferWithObjectSync();
  const info = await sharp("/in.png", {filesystem}).tiff({compression}).toFile("/out.tif");
  const stored = await filesystem.readFile("/out.tif");
  expect(stored).toEqual(buffered.data);
  expect(info).toEqual(buffered.info);
  expect(info.channels).toBe(compression === "jpeg" ? 3 : channels);
  const decoded = decodeTiffImage(stored);
  expect([decoded.width, decoded.height]).toEqual([137, 101]);
  if (compression !== "jpeg") expect(decoded.data).toEqual(decodeImage(input).data);
  const retained = await sharp("/out.tif", {filesystem}).raw().toBuffer();
  expect(retained).toEqual(sharp(stored).raw().toBufferSync());
 });
 it(`links multiple ${compression} TIFF pages`, () => {
  const page = decodeImage(sharp({create:{width:17,height:13,channels:3,background:"red"}}).png().toBufferSync());
  const bytes = encodeTiffImage({...page, tiffPages:[page,page]}, {tiffCompression:compression});
  const view = new DataView(bytes.buffer), first = view.getUint32(4,true);
  const second = view.getUint32(first+2+view.getUint16(first,true)*12,true);
  expect(second).toBeGreaterThan(first);
  expect(view.getUint32(second+2+view.getUint16(second,true)*12,true)).toBe(0);
  const single = bytes.slice();new DataView(single.buffer).setUint32(4,second,true);
  expect(decodeTiffImage(single).data).toEqual(decodeTiffImage(bytes).data);
 });
}
