import type {OutputEncodeOptions, RgbaImage} from "../ast.js";
export function tiffChannels(img: Pick<RgbaImage,"space"|"hasAlpha">): 1 | 2 | 3 | 4 {
  return img.space === "b-w" || img.space === "grey16" ? img.hasAlpha ? 2 : 1 : img.hasAlpha ? 4 : 3;
}
export function createTiffLayout(
  img: Pick<RgbaImage,"width"|"height"|"density"|"resolution"|"orientation"|"space"|"hasAlpha"|"properties">,
  options?: Pick<OutputEncodeOptions, "tiffAlpha" | "density" | "orientation" | "tiffCompression" | "quality" | "tiffEndian" | "tiffRowsPerStrip" | "tiffTile">,
  offset = 0, hasNext = false, stripSizes?: readonly number[]
) {
  const { width, height } = img;
  const littleEndian = options?.tiffEndian !== "msb";
  const jpeg = options?.tiffCompression === "jpeg";
  const channels = jpeg ? 3 : tiffChannels(img), hasAlpha = !jpeg && img.hasAlpha;
  const rowsPerStrip = options?.tiffRowsPerStrip ?? height;
  if (!Number.isSafeInteger(rowsPerStrip) || rowsPerStrip <= 0 || rowsPerStrip > 0xffffffff) throw new RangeError("Invalid TIFF rows per strip");
  const tile = options?.tiffTile;
  if (tile && (!Number.isSafeInteger(tile.width) || !Number.isSafeInteger(tile.height) || tile.width <= 0 || tile.height <= 0 || tile.width % 16 !== 0 || tile.height % 16 !== 0)) throw new RangeError("Invalid TIFF tile dimensions");
  const stripCount = tile ? Math.ceil(width / tile.width) * Math.ceil(height / tile.height) : Math.ceil(height / rowsPerStrip);
  const stripArraySize = stripCount > 1 ? stripCount * 8 : 0;
  const pixelBytes = stripSizes?.reduce((sum, size) => sum + size, 0) ?? (tile ? stripCount * tile.width * tile.height : width * height) * channels;
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
  const numEntries = (hasAlpha ? 15 : 14) + (comment ? 1 : 0) + (jpeg ? 1 : 0) + (tile ? 1 : 0);
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
  header[0]=littleEndian ? 0x49 : 0x4d;header[1]=header[0];
  headerView.setUint16(2,42,littleEndian);
  headerView.setUint32(4,ifdOffset,littleEndian);

  view.setUint16(0, numEntries, littleEndian);
  const entries: [number, number, number, number][] = [];
  entries.push([256, 4, 1, width]); // ImageWidth
  entries.push([257, 4, 1, height]); // ImageLength
  entries.push([258, 3, channels, channels === 1 ? 8 : channels === 2 ? 0x00080008 : bpsOffset]); // BitsPerSample
  entries.push([259, 3, 1, ({ none: 1, lzw: 5, deflate: 8, packbits: 32773, jpeg: 7 })[options?.tiffCompression ?? "none"]]);
  entries.push([262, 3, 1, jpeg ? 6 : channels < 3 ? 1 : 2]); // YCbCr, BlackIsZero or RGB
  if (!tile) entries.push([273, 4, stripCount, stripCount === 1 ? pixelOffset : yResOffset + 8 + commentSize]); // StripOffsets
  entries.push([274, 3, 1, orientation]); // Orientation
  entries.push([277, 3, 1, channels]); // SamplesPerPixel
  if (!tile) entries.push([278, 4, 1, rowsPerStrip]); // RowsPerStrip
  if (!tile) entries.push([279, 4, stripCount, stripCount === 1 ? pixelBytes : yResOffset + 8 + commentSize + stripCount * 4]); // StripByteCounts
  entries.push([282, 5, 1, xResOffset]); // XResolution
  entries.push([283, 5, 1, yResOffset]); // YResolution
  entries.push([284, 3, 1, 1]); // PlanarConfiguration = Chunky
  entries.push([296, 3, 1, resolution?.unit === "meter" || resolution?.unit === "cm" ? 3 : resolution?.unit === "unknown" ? 1 : 2]); // ResolutionUnit
  if (tile) {
    entries.push([322, 4, 1, tile.width]);
    entries.push([323, 4, 1, tile.height]);
    entries.push([324, 4, stripCount, stripCount === 1 ? pixelOffset : yResOffset + 8 + commentSize]);
    entries.push([325, 4, stripCount, stripCount === 1 ? pixelBytes : yResOffset + 8 + commentSize + stripCount * 4]);
  }
  if (jpeg) entries.push([530, 3, 2, 0x00010001]); // YCbCrSubSampling
  if (hasAlpha) entries.push([338, 3, 1, options?.tiffAlpha === "associated" ? 1 : options?.tiffAlpha === "unspecified" ? 0 : 2]); // ExtraSamples
  if (comment) {
    entries.push([270, 2, comment.length, comment.length <= 4 ? 0 : yResOffset + 8]);

  }
  entries.sort((a,b) => a[0]-b[0]).forEach(([tag,type,count,val],index) => {
    const p = 2 + index * 12;
    view.setUint16(p,tag,littleEndian);view.setUint16(p+2,type,littleEndian);view.setUint32(p+4,count,littleEndian);
    if(type === 3 && count === 1) view.setUint16(p+8,val,littleEndian);else view.setUint32(p+8,val,littleEndian);
    if(tag === 270 && comment) directory.set(comment,comment.length <= 4 ? p+8 : yResOffset+8-ifdOffset);
  });
  if (stripCount > 1) {
    let stripOffset = pixelOffset;
    for (let strip = 0; strip < stripCount; strip++) {
      const size = stripSizes?.[strip] ?? (tile ? tile.width * tile.height : width * Math.min(rowsPerStrip, height - strip * rowsPerStrip)) * channels;
      view.setUint32(yResOffset + 8 + commentSize - ifdOffset + strip * 4, stripOffset, littleEndian);
      view.setUint32(yResOffset + 8 + commentSize - ifdOffset + (stripCount + strip) * 4, size, littleEndian);
      stripOffset += size;
    }
  }
  const end = offset === 0 ? yResOffset + 8 + commentSize + stripArraySize : pixelOffset + pixelBytes + padding;
  if (hasNext && end > 0xffffffff) throw new RangeError("TIFF layout exceeds classic TIFF offsets");
  view.setUint32(2 + numEntries * 12, hasNext ? end : 0, littleEndian);
  view.setUint16(bpsOffset-ifdOffset, 8, littleEndian);
  view.setUint16(bpsOffset-ifdOffset + 2, 8, littleEndian);
  view.setUint16(bpsOffset-ifdOffset + 4, 8, littleEndian);
  view.setUint16(bpsOffset-ifdOffset + 6, 8, littleEndian);
  view.setUint32(xResOffset-ifdOffset, Math.round(x * denominator), littleEndian);
  view.setUint32(xResOffset-ifdOffset + 4, denominator, littleEndian);
  view.setUint32(yResOffset-ifdOffset, Math.round(y * denominator), littleEndian);
  view.setUint32(yResOffset-ifdOffset + 4, denominator, littleEndian);
  return {header,directory,channels,padding,end};
}

/** ImageMagick associates every sample, including the alpha sample itself. */
export function associateTiffSamples(bytes: Uint8Array, channels: number): void {
  for (let offset = 0; offset < bytes.length; offset += channels) {
    const alpha = bytes[offset + channels - 1]! / 255;
    for (let channel = 0; channel < channels; channel++) bytes[offset + channel] = Math.round(bytes[offset + channel]! * alpha);
  }
}
