import type {RgbaImage} from "../ast.js";
export function tiffChannels(img: Pick<RgbaImage,"space"|"hasAlpha">): 1 | 2 | 4 {
  return img.space === "b-w" || img.space === "grey16" ? img.hasAlpha ? 2 : 1 : 4;
}
export function createTiffLayout(
  img: Pick<RgbaImage,"width"|"height"|"density"|"orientation"|"space"|"hasAlpha">,
  options?: { readonly density?: number; readonly orientation?: number }
) {
  const { width, height } = img;
  const channels = tiffChannels(img), hasAlpha = channels !== 1;
  const pixelBytes = width * height * channels;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const orientation = options?.orientation ?? img.orientation ?? 1;
  // Little-endian baseline TIFF: header + pixel data + IFD + extras
  const padding = pixelBytes % 2;
  const ifdOffset = 8 + pixelBytes + padding;
  const numEntries = hasAlpha ? 15 : 14;
  const bpsOffset = ifdOffset + 2 + numEntries * 12 + 4;
  const xResOffset = bpsOffset + 8;
  const yResOffset = xResOffset + 8;
  // Classic TIFF uses 32-bit offsets and LONG fields, including directory payloads.
  if (!Number.isSafeInteger(width) || width <= 0 || width > 0xffffffff || !Number.isSafeInteger(height) || height <= 0 || height > 0xffffffff || !Number.isSafeInteger(pixelBytes) || pixelBytes > 0xffffffff || yResOffset + 8 > 0x100000000) {
    throw new RangeError("TIFF layout exceeds classic TIFF offsets");
  }
  const header=new Uint8Array(8),directory=new Uint8Array(yResOffset+8-ifdOffset);
  const headerView=new DataView(header.buffer),view=new DataView(directory.buffer);
  header[0]=0x49;header[1]=0x49;
  headerView.setUint16(2,42,true);
  headerView.setUint32(4,ifdOffset,true);

  view.setUint16(0, numEntries, true);
  const writeEntry = (idx: number, tag: number, type: number, count: number, val: number) => {
    const p = 2 + idx * 12;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(p + 8, val, true);
    } else {
      view.setUint32(p + 8, val, true);
    }
  };
  writeEntry(0, 256, 4, 1, width); // ImageWidth
  writeEntry(1, 257, 4, 1, height); // ImageLength
  writeEntry(2, 258, 3, channels, channels === 1 ? 8 : channels === 2 ? 0x00080008 : bpsOffset); // BitsPerSample
  writeEntry(3, 259, 3, 1, 1); // Compression = None
  writeEntry(4, 262, 3, 1, channels < 3 ? 1 : 2); // BlackIsZero or RGB
  writeEntry(5, 273, 4, 1, 8); // StripOffsets
  writeEntry(6, 274, 3, 1, orientation); // Orientation
  writeEntry(7, 277, 3, 1, channels); // SamplesPerPixel
  writeEntry(8, 278, 4, 1, height); // RowsPerStrip
  writeEntry(9, 279, 4, 1, pixelBytes); // StripByteCounts
  writeEntry(10, 282, 5, 1, xResOffset); // XResolution
  writeEntry(11, 283, 5, 1, yResOffset); // YResolution
  writeEntry(12, 284, 3, 1, 1); // PlanarConfiguration = Chunky
  writeEntry(13, 296, 3, 1, 2); // ResolutionUnit = Inch
  if (hasAlpha) writeEntry(14, 338, 3, 1, 2); // ExtraSamples = Unassociated Alpha
  view.setUint32(2 + numEntries * 12, 0, true);
  view.setUint16(bpsOffset-ifdOffset, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 2, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 4, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 6, 8, true);
  view.setUint32(xResOffset-ifdOffset, density, true);
  view.setUint32(xResOffset-ifdOffset + 4, 1, true);
  view.setUint32(yResOffset-ifdOffset, density, true);
  view.setUint32(yResOffset-ifdOffset + 4, 1, true);
  return {header,directory,channels,padding};
}

