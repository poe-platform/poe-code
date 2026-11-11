import type {BmpPalette} from "./bmp-palette.js";
import type {RgbaImage, OutputEncodeOptions} from "../ast.js";
export function createBmpHeader(img:Pick<RgbaImage,"width"|"height"|"resolution"|"hasAlpha"|"icc">, options?: Pick<OutputEncodeOptions,"bmpFormat"|"bmp3Alpha"|"bmpSubtype"|"bmpCompression"|"bmpRenderingIntent">, palette?: BmpPalette, rleSize?: number) {
 const {width,height}=img;
 const version = options?.bmpFormat === "dib" ? "bmp3" : options?.bmpFormat ?? "bmp3";
 const subtype = options?.bmpSubtype;
 const masks = version === "bmp2" || !subtype || subtype.startsWith("ARGB") !== Boolean(img.hasAlpha) ? undefined : {
  RGB565: [0xf800,0x07e0,0x001f,0], RGB555: [0x7c00,0x03e0,0x001f,0],
  ARGB4444: [0x0f00,0x00f0,0x000f,0xf000], ARGB1555: [0x7c00,0x03e0,0x001f,0x8000]
 }[subtype];
 const dibSize = version === "bmp2" ? 12 : version === "bmp3" ? masks?.[3] ? 56 : 40 : 124;
 if (dibSize === 12 && (width > 65535 || height > 65535)) throw new RangeError("BMP2 dimensions exceed 65535");
 const icc = dibSize === 124 && img.icc?.length ? img.icc : undefined;
 const bytesPerPixel = masks ? 2 : img.hasAlpha && (dibSize === 124 || (version === "bmp3" && options?.bmp3Alpha === true)) ? 4 : 3;
 const rle = !!palette && version !== "bmp2" && options?.bmpCompression === "rle";
 const bitDepth = rle ? 8 : palette?.depth ?? bytesPerPixel * 8;
 const rowStride = Math.ceil(width * bitDepth / 32) * 4, pixelSize = rleSize ?? rowStride * height;
 const paletteBytes = palette?.bytes(dibSize === 12 ? 3 : 4, bitDepth);
 const out = new Uint8Array(14 + dibSize + (masks && dibSize === 40 ? 12 : 0) + (paletteBytes?.length ?? 0)), view = new DataView(out.buffer);
 out[0] = 0x42; out[1] = 0x4d;
 view.setUint32(2, out.length + pixelSize + (icc?.length ?? 0), true);
 view.setUint32(10, out.length, true);
 view.setUint32(14, dibSize, true);
 if (dibSize === 12) {
  view.setUint16(18, width, true); view.setUint16(20, height, true);
  view.setUint16(22, 1, true); view.setUint16(24, bitDepth, true);
 } else {
  view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, bitDepth, true);
  view.setUint32(34, pixelSize, true);
  if (rle) view.setUint32(30, 1, true);
  if (palette) view.setUint32(46, 2 ** bitDepth, true);
  const resolution = img.resolution;
  const scale = resolution?.unit === "meter" ? 1 : resolution?.unit === "cm" ? 100 : 1 / 0.0254;
  view.setInt32(38, Math.round((resolution?.x ?? 0) * scale), true);
  view.setInt32(42, Math.round((resolution?.y ?? 0) * scale), true);
  if (masks) {
   view.setUint32(30, 3, true);
   for (let i=0;i<(dibSize===40?3:4);i++) view.setUint32(54+i*4,masks[i]!,true);
  }
  if (dibSize === 124) {
   if (bytesPerPixel === 4) {
    view.setUint32(30, 3, true);
    view.setUint32(54, 0xff0000, true); view.setUint32(58, 0xff00, true);
    view.setUint32(62, 0xff, true); view.setUint32(66, 0xff000000, true);
   }
   view.setUint32(70, icc ? 0x4d424544 : 0x73524742, true); // PROFILE_EMBEDDED or sRGB
   if (icc) {
    view.setUint32(126, out.length + pixelSize - 14, true); // Offset relative to the DIB header
    view.setUint32(130, icc.length, true);
   }
   const intent = options?.bmpRenderingIntent?.toLowerCase();
   view.setUint32(122, intent === "saturation" ? 1 : intent === "relative" ? 2 : intent === "absolute" ? 8 : 4, true);
  }
 }
 if (paletteBytes) out.set(paletteBytes, 14 + dibSize);
 return {data:options?.bmpFormat === "dib" ? out.subarray(14) : out,rowStride,pixelSize,bytesPerPixel,bitDepth,masks,icc};
}

/** Read the shared bitmap header, with or without the 14-byte BMP file header. */
export function readBmpHeader(bytes: Uint8Array) {
 const fileHeader = bytes[0] === 66 && bytes[1] === 77 ? 14 : 0;
 if (bytes.length < fileHeader + 4) throw new Error("Truncated BMP DIB header");
 const view = new DataView(bytes.buffer, bytes.byteOffset + fileHeader, bytes.byteLength - fileHeader);
 const size = view.getUint32(0, true);
 if (![12, 40, 52, 56, 64, 108, 124].includes(size)) throw new Error("Invalid BMP DIB header size");
 if (view.byteLength < size) throw new Error("Truncated BMP DIB header");
 const bpp = view.getUint16(size === 12 ? 10 : 14, true);
 const colors = (size === 12 ? 0 : view.getUint32(32, true)) || (bpp <= 8 ? 2 ** bpp : 0);
 const masks = size === 40 && view.getUint32(16, true) === 3 ? 12 : 0;
 const dataOffset = fileHeader ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(10, true)
  : size + masks + colors * (size === 12 ? 3 : 4);
 return { view, fileHeader, dataOffset };
}

/** BI_BITFIELDS masks follow the 40-byte header or occupy the same slots in extended headers. */
export function readBmpMasks(view: DataView, dataOffset: number): number[] | undefined {
 const dibSize = view.getUint32(0, true);
 if (dibSize < 40) return;
 const bpp = view.getUint16(14, true), compression = view.getUint32(16, true);
 if (bpp === 16 && compression === 0) return [0x7c00, 0x03e0, 0x001f, 0];
 if ((bpp !== 16 && bpp !== 32) || compression !== 3) return;
 if (view.byteLength < 52 || dataOffset < 52) throw new Error("Truncated BMP channel masks");
 return [view.getUint32(40, true), view.getUint32(44, true), view.getUint32(48, true), dibSize >= 56 ? view.getUint32(52, true) : 0];
}

export function bmpMaskedChannel(pixel: number, mask: number): number {
 if (mask === 0) return 255;
 // Dividing by the unsigned mask also removes the channel's bit offset.
 return Math.round(((pixel & mask) >>> 0) / mask * 255);
}

/** Quantize RGBA channels to their bitfield widths before shifting into a 16-bit pixel. */
export function packBmpPixel(r:number,g:number,b:number,a:number,masks:readonly number[]):number {
 let pixel=0;
 const channels=[r,g,b,a];
 for(let i=0;i<4;i++) {
  const mask=masks[i]!;
  if(mask) {
   const shift=mask & -mask;
   pixel |= Math.round(channels[i]! / 255 * (mask / shift)) * shift;
  }
 }
 return pixel;
}
