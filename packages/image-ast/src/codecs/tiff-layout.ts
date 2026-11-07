import type {RgbaImage} from "../ast.js";
export function tiffChannels(img: Pick<RgbaImage,"space"|"hasAlpha">): 1 | 2 | 3 | 4 {
  return img.space === "b-w" || img.space === "grey16" ? img.hasAlpha ? 2 : 1 : img.hasAlpha ? 4 : 3;
}
export function createTiffLayout(
  img: Pick<RgbaImage,"width"|"height"|"density"|"resolution"|"orientation"|"space"|"hasAlpha"|"properties">,
  options?: { readonly density?: number; readonly orientation?: number; readonly tiffRowsPerStrip?: number },
  offset = 0, hasNext = false
) {
  const { width, height } = img;
  const channels = tiffChannels(img), hasAlpha = img.hasAlpha;
  const rowsPerStrip = options?.tiffRowsPerStrip ?? height;
  if (!Number.isSafeInteger(rowsPerStrip) || rowsPerStrip <= 0 || rowsPerStrip > 0xffffffff) throw new RangeError("Invalid TIFF rows per strip");
  const stripCount = Math.ceil(height / rowsPerStrip);
  const stripArraySize = stripCount > 1 ? stripCount * 8 : 0;
  const pixelBytes = width * height * channels;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const resolution = options?.density === undefined ? img.resolution : undefined;
  const scale = resolution?.unit === "meter" ? 100 : 1;
  const x = resolution ? resolution.x / scale : density, y = resolution ? resolution.y / scale : density;
  const denominator = Number.isInteger(x) && Number.isInteger(y) ? 1 : 10000;
  const orientation = options?.orientation ?? img.orientation ?? 1;
  // Keep the single-page layout byte-compatible. Later pages start with their
  // directory so the preceding page can link to them without reading ahead.
  const padding = pixelBytes % 2;
  const comment = img.properties?.comment === undefined ? undefined : new TextEncoder().encode(img.properties.comment + "\0");
  const commentSize = comment ? comment.length + comment.length % 2 : 0;
  const numEntries = (hasAlpha ? 15 : 14) + (comment ? 1 : 0);
  const directorySize = 2 + numEntries * 12 + 4 + 24 + commentSize + stripArraySize;
  const pixelOffset = offset === 0 ? 8 : offset + directorySize;
  const ifdOffset = offset === 0 ? pixelOffset + pixelBytes + padding : offset;
  const bpsOffset = ifdOffset + 2 + numEntries * 12 + 4;
  const xResOffset = bpsOffset + 8;
  const yResOffset = xResOffset + 8;
  // Classic TIFF uses 32-bit offsets and LONG fields, including directory payloads.
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(width) || width <= 0 || width > 0xffffffff || !Number.isSafeInteger(height) || height <= 0 || height > 0xffffffff || !Number.isSafeInteger(pixelBytes) || pixelBytes > 0xffffffff || pixelOffset + pixelBytes + padding > 0x100000000 || yResOffset + 8 + commentSize + stripArraySize > 0x100000000) {
    throw new RangeError("TIFF layout exceeds classic TIFF offsets");
  }
  const header=new Uint8Array(8),directory=new Uint8Array(yResOffset+8+commentSize+stripArraySize-ifdOffset);
  const headerView=new DataView(header.buffer),view=new DataView(directory.buffer);
  header[0]=0x49;header[1]=0x49;
  headerView.setUint16(2,42,true);
  headerView.setUint32(4,ifdOffset,true);

  view.setUint16(0, numEntries, true);
  const writeEntry = (idx: number, tag: number, type: number, count: number, val: number) => {
    const p = 2 + (idx + (comment && tag > 270 ? 1 : 0)) * 12;
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
  writeEntry(5, 273, 4, stripCount, stripCount === 1 ? pixelOffset : yResOffset + 8 + commentSize); // StripOffsets
  writeEntry(6, 274, 3, 1, orientation); // Orientation
  writeEntry(7, 277, 3, 1, channels); // SamplesPerPixel
  writeEntry(8, 278, 4, 1, rowsPerStrip); // RowsPerStrip
  writeEntry(9, 279, 4, stripCount, stripCount === 1 ? pixelBytes : yResOffset + 8 + commentSize + stripCount * 4); // StripByteCounts
  writeEntry(10, 282, 5, 1, xResOffset); // XResolution
  writeEntry(11, 283, 5, 1, yResOffset); // YResolution
  writeEntry(12, 284, 3, 1, 1); // PlanarConfiguration = Chunky
  writeEntry(13, 296, 3, 1, resolution?.unit === "meter" || resolution?.unit === "cm" ? 3 : resolution?.unit === "unknown" ? 1 : 2); // ResolutionUnit
  if (hasAlpha) writeEntry(14, 338, 3, 1, 2); // ExtraSamples = Unassociated Alpha
  if (comment) {
    writeEntry(5, 270, 2, comment.length, comment.length <= 4 ? 0 : yResOffset + 8);
    directory.set(comment, comment.length <= 4 ? 2 + 5 * 12 + 8 : yResOffset + 8 - ifdOffset);
  }
  if (stripCount > 1) {
    let stripOffset = pixelOffset;
    for (let strip = 0; strip < stripCount; strip++) {
      const size = width * channels * Math.min(rowsPerStrip, height - strip * rowsPerStrip);
      view.setUint32(yResOffset + 8 + commentSize - ifdOffset + strip * 4, stripOffset, true);
      view.setUint32(yResOffset + 8 + commentSize - ifdOffset + (stripCount + strip) * 4, size, true);
      stripOffset += size;
    }
  }
  const end = offset === 0 ? yResOffset + 8 + commentSize + stripArraySize : pixelOffset + pixelBytes + padding;
  if (hasNext && end > 0xffffffff) throw new RangeError("TIFF layout exceeds classic TIFF offsets");
  view.setUint32(2 + numEntries * 12, hasNext ? end : 0, true);
  view.setUint16(bpsOffset-ifdOffset, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 2, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 4, 8, true);
  view.setUint16(bpsOffset-ifdOffset + 6, 8, true);
  view.setUint32(xResOffset-ifdOffset, Math.round(x * denominator), true);
  view.setUint32(xResOffset-ifdOffset + 4, denominator, true);
  view.setUint32(yResOffset-ifdOffset, Math.round(y * denominator), true);
  view.setUint32(yResOffset-ifdOffset + 4, denominator, true);
  return {header,directory,channels,padding,end};
}

