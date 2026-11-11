import type {OutputEncodeOptions, RgbaImage} from "../ast.js";
export function tiffChannels(img: Pick<RgbaImage,"space"|"hasAlpha">): 1 | 2 | 3 | 4 | 5 {
  return img.space === "cmyk" ? img.hasAlpha ? 5 : 4 : img.space === "b-w" || img.space === "grey16" ? img.hasAlpha ? 2 : 1 : img.hasAlpha ? 4 : 3;
}
export function createTiffLayout(
  img: Pick<RgbaImage,"width"|"height"|"density"|"resolution"|"orientation"|"space"|"hasAlpha"|"properties"|"virtualCanvas"|"metaChannels"> & { storedMetaChannels?: readonly unknown[] | undefined },
  options?: Pick<OutputEncodeOptions, "tiffBig" | "tiffScene" | "tiffIntegerDepth" | "tiffSigned" | "tiffFloatDepth" | "tiffPlanar" | "tiffAlpha" | "density" | "orientation" | "tiffCompression" | "quality" | "tiffEndian" | "tiffFillOrder" | "tiffRowsPerStrip" | "tiffTile">,
  offset = 0, hasNext = false, stripSizes?: readonly number[], pageIndex = 0, pageCount = 1
) {
  const { width, height } = img;
  const big = options?.tiffBig === true;
  const alignment = big ? 8 : 2, offsetBytes = big ? 8 : 4;
  const countBytes = big ? 8 : 2, entryBytes = big ? 20 : 12;
  const littleEndian = options?.tiffEndian !== "msb";
  const bits = options?.tiffFloatDepth ?? options?.tiffIntegerDepth ?? 8, sampleBytes = bits / 8;
  const jpeg = options?.tiffCompression === "jpeg";
  if (jpeg && img.space === "cmyk") throw new Error("CMYK TIFF does not support JPEG compression");
  if (jpeg && options?.tiffFloatDepth) throw new Error("Floating-point TIFF does not support JPEG compression");
  if (jpeg && (bits !== 8 || options?.tiffSigned)) throw new Error("Integer TIFF with JPEG compression requires unsigned 8-bit samples");
  if (jpeg && options?.tiffPlanar) throw new Error("Planar TIFF does not support JPEG compression");
  const metaCount = jpeg ? 0 : (img.metaChannels ?? img.storedMetaChannels)?.length ?? 0;
  const channels = jpeg ? 3 : tiffChannels(img) + metaCount, hasAlpha = !jpeg && img.hasAlpha;
  const extras = (hasAlpha ? 1 : 0) + metaCount;
  const bpsSize = Math.ceil(Math.max(8, channels * 2) / alignment) * alignment;
  const extrasSize = extras * 2 > offsetBytes ? Math.ceil(extras * 2 / alignment) * alignment : 0;
  const rowsPerStrip = options?.tiffRowsPerStrip ?? height;
  if (!Number.isSafeInteger(rowsPerStrip) || rowsPerStrip <= 0 || rowsPerStrip > 0xffffffff) throw new RangeError("Invalid TIFF rows per strip");
  const tile = options?.tiffTile;
  if (tile && (!Number.isSafeInteger(tile.width) || !Number.isSafeInteger(tile.height) || tile.width <= 0 || tile.height <= 0 || tile.width % 16 !== 0 || tile.height % 16 !== 0)) throw new RangeError("Invalid TIFF tile dimensions");
  const stripsPerPlane = tile ? Math.ceil(width / tile.width) * Math.ceil(height / tile.height) : Math.ceil(height / rowsPerStrip);
  const stripCount = stripsPerPlane * (options?.tiffPlanar ? channels : 1);
  const chunkChannels = options?.tiffPlanar ? 1 : channels;
  const stripArraySize = stripCount > 1 ? stripCount * offsetBytes * 2 : 0;
  const pixelBytes = stripSizes?.reduce((sum, size) => sum + size, 0) ?? (tile ? stripCount * tile.width * tile.height * chunkChannels : width * height * channels) * sampleBytes;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const resolution = options?.density === undefined ? img.resolution : undefined;
  const hasResolution = resolution !== undefined || options?.density !== undefined;
  const scale = resolution?.unit === "meter" ? 100 : 1;
  const x = resolution ? resolution.x / scale : density, y = resolution ? resolution.y / scale : density;
  const denominator = Number.isInteger(x) && Number.isInteger(y) ? 1 : 10000;
  const positions = img.virtualCanvas && (img.virtualCanvas.x !== 0 || img.virtualCanvas.y !== 0)
    ? [[Math.round(Math.max(0, img.virtualCanvas.x) * denominator), Math.round(x * denominator)], [Math.round(Math.max(0, img.virtualCanvas.y) * denominator), Math.round(y * denominator)]] : undefined;
  const positionSize = positions ? 16 : 0;
  const orientation = options?.orientation ?? img.orientation ?? 1;
  // The first page stores pixels before its directory. Later pages start with
  // their directory so the preceding page can link to them without reading ahead.
  const padding = (alignment - pixelBytes % alignment) % alignment;
  const comment = img.properties?.comment === undefined ? undefined : new TextEncoder().encode(img.properties.comment + "\0");
  const commentSize = comment ? Math.ceil(comment.length / alignment) * alignment : 0;
  const numEntries = (options?.tiffFillOrder === "lsb" ? 1 : 0) + (extras ? 16 : 15) - (hasResolution ? 0 : 3) + (positions ? 2 : 0) + (comment ? 1 : 0) + (jpeg ? 1 : 0) + (tile ? 1 : 0) + (options?.tiffFloatDepth || options?.tiffIntegerDepth || options?.tiffSigned ? 1 : 0);
  const tableSize = Math.ceil((countBytes + numEntries * entryBytes + offsetBytes) / alignment) * alignment;
  const directorySize = tableSize + bpsSize + extrasSize + 16 + commentSize + stripArraySize + positionSize;
  const pixelOffset = offset === 0 ? (big ? 16 : 8) : offset + directorySize;
  const ifdOffset = offset === 0 ? pixelOffset + pixelBytes + padding : offset;
  const bpsOffset = ifdOffset + tableSize;
  const extrasOffset = bpsOffset + bpsSize;
  const xResOffset = extrasOffset + extrasSize;
  const yResOffset = xResOffset + 8;
  const positionOffset = yResOffset + 8 + commentSize + stripArraySize;
  // BigTIFF offsets stay within the exact integer range used by backing storage.
  const limit = big ? Number.MAX_SAFE_INTEGER : 0xffffffff;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(width) || width <= 0 || width > 0xffffffff || !Number.isSafeInteger(height) || height <= 0 || height > 0xffffffff || !Number.isSafeInteger(pixelBytes) || pixelBytes > limit || pixelOffset + pixelBytes + padding > limit + (big ? 0 : 1) || positionOffset + positionSize > limit + (big ? 0 : 1)) {
    throw new RangeError(big ? "TIFF layout exceeds safe BigTIFF offsets" : "TIFF layout exceeds classic TIFF offsets");
  }
  const header=new Uint8Array(big ? 16 : 8),directory=new Uint8Array(directorySize);
  const headerView=new DataView(header.buffer),view=new DataView(directory.buffer);
  header[0]=littleEndian ? 0x49 : 0x4d;header[1]=header[0];
  headerView.setUint16(2,big ? 43 : 42,littleEndian);
  if (big) {
    headerView.setUint16(4, 8, littleEndian);
    headerView.setBigUint64(8, BigInt(ifdOffset), littleEndian);
    view.setBigUint64(0, BigInt(numEntries), littleEndian);
  } else {
    headerView.setUint32(4,ifdOffset,littleEndian);
    view.setUint16(0, numEntries, littleEndian);
  }
  const entries: [number, number, number, number][] = [];
  entries.push([256, 4, 1, width]); // ImageWidth
  entries.push([257, 4, 1, height]); // ImageLength
  entries.push([258, 3, channels, channels === 1 ? bits : channels === 2 ? bits * 0x10001 : bpsOffset]); // BitsPerSample
  entries.push([259, 3, 1, ({ none: 1, lzw: 5, deflate: 8, packbits: 32773, jpeg: 7 })[options?.tiffCompression ?? "none"]]);
  entries.push([262, 3, 1, jpeg ? 6 : img.space === "cmyk" ? 5 : tiffChannels(img) < 3 ? 1 : 2]); // YCbCr, separated CMYK, BlackIsZero or RGB
  if (options?.tiffFillOrder === "lsb") entries.push([266, 3, 1, 2]); // FillOrder
  if (!tile) entries.push([273, big ? 16 : 4, stripCount, stripCount === 1 ? pixelOffset : yResOffset + 8 + commentSize]); // StripOffsets
  entries.push([274, 3, 1, orientation]); // Orientation
  entries.push([277, 3, 1, channels]); // SamplesPerPixel
  if (!tile) entries.push([278, 4, 1, rowsPerStrip]); // RowsPerStrip
  if (!tile) entries.push([279, big ? 16 : 4, stripCount, stripCount === 1 ? pixelBytes : yResOffset + 8 + commentSize + stripCount * offsetBytes]); // StripByteCounts
  if (hasResolution) entries.push([282, 5, 1, xResOffset]); // XResolution
  if (hasResolution) entries.push([283, 5, 1, yResOffset]); // YResolution
  entries.push([284, 3, 1, options?.tiffPlanar ? 2 : 1]); // PlanarConfiguration
  if (positions) {
    entries.push([286, 5, 1, positionOffset]); // XPosition
    entries.push([287, 5, 1, positionOffset + 8]); // YPosition
  }
  if (hasResolution) entries.push([296, 3, 1, resolution?.unit === "meter" || resolution?.unit === "cm" ? 3 : resolution?.unit === "unknown" ? 1 : 2]); // ResolutionUnit
  entries.push([297, 3, 2, 0]); // PageNumber
  if (tile) {
    entries.push([322, 4, 1, tile.width]);
    entries.push([323, 4, 1, tile.height]);
    entries.push([324, big ? 16 : 4, stripCount, stripCount === 1 ? pixelOffset : yResOffset + 8 + commentSize]);
    entries.push([325, big ? 16 : 4, stripCount, stripCount === 1 ? pixelBytes : yResOffset + 8 + commentSize + stripCount * offsetBytes]);
  }
  if (jpeg) entries.push([530, 3, 2, 0x00010001]); // YCbCrSubSampling
  if (options?.tiffFloatDepth) entries.push([339, 3, 1, 3]); // IEEE floating point
  else if (options?.tiffIntegerDepth || options?.tiffSigned) entries.push([339, 3, 1, options?.tiffSigned ? 2 : 1]);
  if (extras) entries.push([338, 3, extras, extrasOffset]); // ExtraSamples
  if (comment) {
    entries.push([270, 2, comment.length, comment.length <= offsetBytes ? 0 : yResOffset + 8]);

  }
  entries.sort((a,b) => a[0]-b[0]).forEach(([tag,type,count,val],index) => {
    const p = countBytes + index * entryBytes, valueAt = p + (big ? 12 : 8);
    view.setUint16(p,tag,littleEndian);view.setUint16(p+2,type,littleEndian);
    if (big) {
      view.setBigUint64(p+4,BigInt(count),littleEndian);
      if (type === 3) {
        if (count * 2 > offsetBytes) view.setBigUint64(valueAt, BigInt(val), littleEndian);
        else for (let i = 0; i < count; i++) view.setUint16(valueAt + i * 2, tag === 258 ? bits : count === 1 ? val : 1, littleEndian);
      } else if (type === 4) view.setUint32(valueAt,val,littleEndian);
      else if (type === 5) {
        view.setUint32(valueAt, tag < 286 ? Math.round((tag === 282 ? x : y) * denominator) : positions![tag - 286]![0]!, littleEndian);
        view.setUint32(valueAt+4, tag < 286 ? denominator : positions![tag - 286]![1]!, littleEndian);
      } else view.setBigUint64(valueAt,BigInt(val),littleEndian);
    } else {
      view.setUint32(p+4,count,littleEndian);
      if(type === 3 && count === 1) view.setUint16(valueAt,val,littleEndian);
      else view.setUint32(valueAt,val,littleEndian);
    }
    if (tag === 297) {
      view.setUint16(valueAt, (options?.tiffScene ?? 0) + pageIndex, littleEndian);
      view.setUint16(valueAt + 2, pageCount, littleEndian);
    }
    if (tag === 338) {
      const at = extrasSize ? extrasOffset - ifdOffset : valueAt;
      for (let i = 0; i < extras; i++) view.setUint16(at + i * 2, i === 0 && hasAlpha ? options?.tiffAlpha === "associated" ? 1 : options?.tiffAlpha === "unspecified" ? 0 : 2 : 0, littleEndian);
    }
    if(tag === 270 && comment) directory.set(comment,comment.length <= offsetBytes ? valueAt : yResOffset+8-ifdOffset);
  });
  if (stripCount > 1) {
    let stripOffset = pixelOffset;
    for (let strip = 0; strip < stripCount; strip++) {
      const size = stripSizes?.[strip] ?? (tile ? tile.width * tile.height : width * Math.min(rowsPerStrip, height - (strip % stripsPerPlane) * rowsPerStrip)) * chunkChannels * sampleBytes;
      const at = yResOffset + 8 + commentSize - ifdOffset + strip * offsetBytes;
      if (big) {
        view.setBigUint64(at, BigInt(stripOffset), littleEndian);
        view.setBigUint64(at + stripCount * offsetBytes, BigInt(size), littleEndian);
      } else {
        view.setUint32(at, stripOffset, littleEndian);
        view.setUint32(at + stripCount * offsetBytes, size, littleEndian);
      }
      stripOffset += size;
    }
  }
  const end = offset === 0 ? positionOffset + positionSize : pixelOffset + pixelBytes + padding;
  if (hasNext && end > limit) throw new RangeError(big ? "TIFF layout exceeds safe BigTIFF offsets" : "TIFF layout exceeds classic TIFF offsets");
  if (big) view.setBigUint64(countBytes + numEntries * entryBytes, BigInt(hasNext ? end : 0), littleEndian);
  else view.setUint32(countBytes + numEntries * entryBytes, hasNext ? end : 0, littleEndian);
  for (let i = 0; i < Math.max(4, channels); i++) view.setUint16(bpsOffset-ifdOffset + i * 2, bits, littleEndian);
  view.setUint32(xResOffset-ifdOffset, Math.round(x * denominator), littleEndian);
  view.setUint32(xResOffset-ifdOffset + 4, denominator, littleEndian);
  view.setUint32(yResOffset-ifdOffset, Math.round(y * denominator), littleEndian);
  view.setUint32(yResOffset-ifdOffset + 4, denominator, littleEndian);
  positions?.forEach((value, index) => {
    const at = positionOffset - ifdOffset + index * 8;
    view.setUint32(at, value[0]!, littleEndian);
    view.setUint32(at + 4, value[1]!, littleEndian);
  });
  return {header,directory,channels,padding,end};
}

/** ImageMagick associates every sample, including the alpha sample itself. */
export function associateTiffSamples(bytes: Uint8Array, channels: number, alphaChannel = channels - 1): void {
  for (let offset = 0; offset < bytes.length; offset += channels) {
    const alpha = bytes[offset + alphaChannel]! / 255;
    for (let channel = 0; channel < channels; channel++) bytes[offset + channel] = Math.round(bytes[offset + channel]! * alpha);
  }
}

/** Extract one sample plane from a bounded chunk of packed samples. */
export function tiffSamplePlane(bytes: Uint8Array, channels: number, plane: number): Uint8Array {
  const output = new Uint8Array(bytes.length / channels);
  for (let i = 0; i < output.length; i++) output[i] = bytes[i * channels + plane]!;
  return output;
}
