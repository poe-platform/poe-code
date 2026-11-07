import type {RgbaImage} from "../ast.js";
export function createBmpHeader(img:Pick<RgbaImage,"width"|"height"|"density">) {
 const {width,height}=img;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowStride * height;
  const out = new Uint8Array(54);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, 54 + pixelSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  const ppm = Math.round((img.density ?? 72) / 0.0254);
  view.setInt32(38, ppm, true);
  view.setInt32(42, ppm, true);

 return {data:out,rowStride,pixelSize};
}

/** BI_BITFIELDS masks follow the 40-byte header or occupy the same slots in extended headers. */
export function readBmpMasks(view: DataView): number[] | undefined {
 const dibSize = view.getUint32(14, true);
 if (dibSize < 40) return;
 const bpp = view.getUint16(28, true), compression = view.getUint32(30, true);
 if (bpp === 16 && compression === 0) return [0x7c00, 0x03e0, 0x001f, 0];
 if ((bpp !== 16 && bpp !== 32) || compression !== 3) return;
 if (view.byteLength < 66 || view.getUint32(10, true) < 66) throw new Error("Truncated BMP channel masks");
 return [view.getUint32(54, true), view.getUint32(58, true), view.getUint32(62, true), bpp === 32 && dibSize >= 56 ? view.getUint32(66, true) : 0];
}

export function bmpMaskedChannel(pixel: number, mask: number): number {
 if (mask === 0) return 255;
 // Dividing by the unsigned mask also removes the channel's bit offset.
 return Math.round(((pixel & mask) >>> 0) / mask * 255);
}
