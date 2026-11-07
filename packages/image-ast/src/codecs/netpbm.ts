import {createTiffCompressor} from "./tiff-compression.js";
import {createTiffLayout} from "./tiff-layout.js";
import {createBmpHeader} from "./bmp-header.js";
import {parseNetpbmSequence} from "./netpbm-header.js";
import { transformBytes } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage } from "../ast.js";
import { encodeJpegImage, decodeJpegImage } from "./jpeg.js";

export function isNetpbmBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 7 || bytes[0] !== 0x50) return false; // 'P'
  const m = bytes[1]!;
  if (m < 0x31 || m > 0x37) return false; // '1'..'7'
  const ws = bytes[2]!;
  return ws === 0x20 || ws === 0x0a || ws === 0x0d || ws === 0x09;
}

export function isBmpBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function isTiffBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  );
}

export function readNetpbmMetadata(bytes: Uint8Array): ImageMetadata {
  const { header: hdr, pages } = parseNetpbmSequence(bytes);
  return {
    format: hdr.format,
    width: hdr.width,
    height: hdr.height,
    space: hdr.channels >= 3 ? "srgb" : "b-w",
    channels: hdr.channels,
    depth: hdr.format === "pbm" ? "bit" : hdr.maxval > 255 ? "ushort" : "uchar",
    density: 72,
    hasAlpha: hdr.hasAlpha,
    size: bytes.byteLength,
    ...(pages > 1 ? { pages } : {})
  };
}

export function decodeNetpbmImage(bytes: Uint8Array, page = 0): RgbaImage {
  const { header: hdr } = parseNetpbmSequence(bytes, page);
  const { width, height, maxval, magic, format, channels, hasAlpha } = hdr;
  if (magic === "P6" && bytes.length - hdr.dataOffset < width * height * 3 * (maxval > 255 ? 2 : 1)) {
    throw new Error("Truncated PPM raster");
  }
  if (magic === "P7" && bytes.length - hdr.dataOffset < width * height * channels * (maxval > 255 ? 2 : 1)) throw new Error("Truncated PAM raster");
  const rgba = new Uint8Array(width * height * 4);
  const data16 = maxval > 255 ? new Uint16Array(width * height * 4) : undefined;
  let pos = hdr.dataOffset;

  const readNextAsciiInt = (): number => {
    while (pos < bytes.length) {
      const c = bytes[pos]!;
      if (c === 0x23) {
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      } else if (c <= 0x20) {
        pos++;
      } else {
        break;
      }
    }
    let val = 0;
    while (pos < bytes.length && bytes[pos]! >= 0x30 && bytes[pos]! <= 0x39) {
      val = val * 10 + (bytes[pos]! - 0x30);
      pos++;
    }
    return val;
  };

  if (magic === "P7" || magic === "P6" || magic === "P5" || magic === "P3" || magic === "P2") {
    const readSample = magic === "P3" || magic === "P2" ? readNextAsciiInt : () => {
      const hi = bytes[pos++] ?? 0;
      return maxval > 255 ? (hi << 8) | (bytes[pos++] ?? 0) : hi;
    };
    for (let i = 0; i < width * height; i++) {
      const r = readSample(), g = channels >= 3 ? readSample() : r, b = channels >= 3 ? readSample() : r, a = hasAlpha ? readSample() : maxval;
      for (const [channel, value] of [r, g, b, a].entries()) {
        rgba[i * 4 + channel] = Math.round(value * 255 / maxval);
        if (data16) data16[i * 4 + channel] = Math.round(value * 65535 / maxval);
      }
      if (!hasAlpha) { rgba[i * 4 + 3] = 255; if (data16) data16[i * 4 + 3] = 65535; }
    }
  } else if (magic === "P4") {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      const rowStart = pos + y * rowBytes;
      for (let x = 0; x < width; x++) {
        const bit = (bytes[rowStart + (x >>> 3)]! >>> (7 - (x & 7))) & 1;
        const g = bit === 1 ? 0 : 255; // PBM: 1 = black, 0 = white
        const idx = (y * width + x) * 4;
        rgba[idx] = g;
        rgba[idx + 1] = g;
        rgba[idx + 2] = g;
        rgba[idx + 3] = 255;
      }
    }
  } else if (magic === "P1") {
    for (let i = 0; i < width * height; i++) {
      const bit = readNextAsciiInt();
      const g = bit === 1 ? 0 : 255;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    }
  }

  return {
    width,
    height,
    data: rgba,
    ...(data16 ? {data16} : {}),
    format,
    space: channels >= 3 ? "srgb" : "b-w",
    channels,
    depth: format === "pbm" ? "bit" : maxval > 255 ? "ushort" : "uchar",
    density: 72,
    hasAlpha
  };
}

export function encodePpm(img: RgbaImage, depth = img.data16 ? 16 : 8, ascii = false, pam = false): Uint8Array {
  if (pam) ascii = false;
  const channels = pam && img.hasAlpha ? 4 : 3;
  if (!Number.isInteger(depth) || depth < 1 || depth > 16) throw new RangeError("Invalid Netpbm depth");
  const maximum = 2 ** depth - 1;
  const text: string[] = [];
  const header = pam ? `P7\nWIDTH ${img.width}\nHEIGHT ${img.height}\nDEPTH ${channels}\nMAXVAL ${maximum}\nTUPLTYPE ${img.hasAlpha ? "RGB_ALPHA" : "RGB"}\nENDHDR\n` : `${ascii ? "P3" : "P6"}\n${img.width} ${img.height}\n${maximum}\n`;
  const out = new Uint8Array(ascii ? 0 : header.length + img.width * img.height * channels * (depth > 8 ? 2 : 1));
  if (!ascii) out.set(new TextEncoder().encode(header), 0);
  let dst = header.length;
  for (let i = 0; i < img.width * img.height; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.round((img.data16 ?? img.data)[i * 4 + channel]! * maximum / (img.data16 ? 65535 : 255));
      if (ascii) { text.push(String(value)); continue; }
      if (depth > 8) out[dst++] = value >>> 8;
      out[dst++] = value & 255;
    }
  }
  return ascii ? new TextEncoder().encode(header + text.join("\n") + "\n") : out;
}

export function encodePgm(img: RgbaImage, depth = img.data16 ? 16 : 8, ascii = false): Uint8Array {
  if (!Number.isInteger(depth) || depth < 1 || depth > 16) throw new RangeError("Invalid Netpbm depth");
  const maximum = 2 ** depth - 1;
  const text: string[] = [];
  const header = `${ascii ? "P2" : "P5"}\n${img.width} ${img.height}\n${maximum}\n`;
  const out = new Uint8Array(ascii ? 0 : header.length + img.width * img.height * (depth > 8 ? 2 : 1));
  if (!ascii) out.set(new TextEncoder().encode(header), 0);
  let dst = header.length;
  for (let i = 0; i < img.width * img.height; i++) {
    const samples = img.data16 ?? img.data;
    const r = samples[i * 4]!;
    const g = samples[i * 4 + 1]!;
    const b = samples[i * 4 + 2]!;
    const value = Math.round((0.212656 * r + 0.715158 * g + 0.072186 * b) * maximum / (img.data16 ? 65535 : 255));
    if (ascii) { text.push(String(value)); continue; }
    if (depth > 8) out[dst++] = value >>> 8;
    out[dst++] = value & 255;
  }
  return ascii ? new TextEncoder().encode(header + text.join("\n") + "\n") : out;
}

export function encodePbm(img: RgbaImage, ascii = false): Uint8Array {
  const text: string[] = [];
  const header = `${ascii ? "P1" : "P4"}\n${img.width} ${img.height}\n`;
  const rowBytes = Math.ceil(img.width / 8);
  const out = new Uint8Array(ascii ? 0 : header.length + rowBytes * img.height);
  if (!ascii) out.set(new TextEncoder().encode(header), 0);
  for (let y = 0; y < img.height; y++) {
    const rowOffset = header.length + y * rowBytes;
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const luma = 0.299 * img.data[idx]! + 0.587 * img.data[idx + 1]! + 0.114 * img.data[idx + 2]!;
      const bit = luma < 128 ? 1 : 0; // 1 = black
      if (ascii) { text.push(String(bit)); continue; }
      if (bit) {
        const bIdx = rowOffset + (x >>> 3);
        out[bIdx] = (out[bIdx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
  }
  return ascii ? new TextEncoder().encode(header + text.join("\n") + "\n") : out;
}

export function readBmpMetadata(bytes: Uint8Array): ImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Math.abs(view.getInt32(18, true));
  const height = Math.abs(view.getInt32(22, true));
  const bpp = view.getUint16(28, true);
  const ppmX = view.getInt32(38, true);
  const density = ppmX > 0 ? Math.max(1, Math.round(ppmX * 0.0254)) : 72;
  return {
    format: "bmp",
    width,
    height,
    space: "srgb",
    channels: bpp === 32 ? 4 : 3,
    depth: "uchar",
    density,
    hasAlpha: bpp === 32,
    size: bytes.byteLength
  };
}

export function decodeBmpImage(bytes: Uint8Array): RgbaImage {
  const meta = readBmpMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = view.getUint32(10, true);
  const dibHeaderSize = view.getUint32(14, true);
  const rawHeight = view.getInt32(22, true);
  const topDown = rawHeight < 0;
  const bpp = view.getUint16(28, true);
  const rowStride = Math.floor((meta.width * bpp + 31) / 32) * 4;
  const rgba = new Uint8Array(meta.width * meta.height * 4);
  const paletteOffset = 14 + dibHeaderSize;
  const paletteStep = dibHeaderSize === 12 ? 3 : 4;

  for (let y = 0; y < meta.height; y++) {
    const srcY = topDown ? y : meta.height - 1 - y;
    const rowStart = dataOffset + srcY * rowStride;
    for (let x = 0; x < meta.width; x++) {
      const dstIdx = (y * meta.width + x) * 4;
      if (bpp <= 8) {
        let pIdx = 0;
        if (bpp === 8) {
          pIdx = bytes[rowStart + x] ?? 0;
        } else if (bpp === 4) {
          const b = bytes[rowStart + (x >>> 1)] ?? 0;
          pIdx = (x & 1) === 0 ? (b >>> 4) & 0x0f : b & 0x0f;
        } else if (bpp === 1) {
          const b = bytes[rowStart + (x >>> 3)] ?? 0;
          pIdx = (b >>> (7 - (x & 7))) & 1;
        }
        const pOff = paletteOffset + pIdx * paletteStep;
        rgba[dstIdx] = bytes[pOff + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[pOff + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[pOff] ?? 0;
        rgba[dstIdx + 3] = 255;
      } else {
        const bytesPerPixel = bpp >>> 3;
        const srcIdx = rowStart + x * bytesPerPixel;
        rgba[dstIdx] = bytes[srcIdx + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[srcIdx + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[srcIdx] ?? 0;
        rgba[dstIdx + 3] = bytesPerPixel === 4 ? (bytes[srcIdx + 3] ?? 255) : 255;
      }
    }
  }
  return {
    width: meta.width,
    height: meta.height,
    data: rgba,
    format: "bmp",
    space: "srgb",
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: meta.hasAlpha
  };
}

export function encodeBmpImage(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const {data:header,rowStride,pixelSize}=createBmpHeader(img);
  const out=new Uint8Array(54+pixelSize);
  out.set(header);

  for (let y = 0; y < height; y++) {
    const dstRow = 54 + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      out[dstRow + x * 3] = data[srcIdx + 2]!;
      out[dstRow + x * 3 + 1] = data[srcIdx + 1]!;
      out[dstRow + x * 3 + 2] = data[srcIdx]!;
    }
  }
  return out;
}

export function encodeTiffImage(img:RgbaImage,options?:Parameters<typeof createTiffLayout>[1]):Uint8Array {
 const pages=img.tiffPages ?? [img];
 const layouts: ReturnType<typeof createTiffLayout>[]=[];
 const payloads: Uint8Array[][]=[];
 let end=0;
 for(let index=0;index<pages.length;index++) {
  const page=pages[index]!,channels=createTiffLayout(page,options).channels,chunks:Uint8Array[]=[];
  const rows=options?.tiffTile?.height ?? options?.tiffRowsPerStrip ?? page.height,columns=options?.tiffTile?.width ?? page.width,stripSizes:number[]=[];
  for(let row=0;row<page.height;row+=rows) {
  for(let left=0;left<page.width;left+=columns) {
  const height=options?.tiffTile ? rows : Math.min(rows,page.height-row),start=chunks.length;
  let block=page;
  if(options?.tiffTile) {
   const data=new Uint8Array(columns*height*4);
   for(let y=0;y<Math.min(height,page.height-row);y++) data.set(page.data.subarray(((row+y)*page.width+left)*4,((row+y)*page.width+Math.min(left+columns,page.width))*4),y*columns*4);
   block={...page,width:columns,height,data};
  } else block={...page,height,data:page.data.subarray(row*page.width*4,(row+height)*page.width*4)};
  if(options?.tiffCompression === "jpeg") chunks.push(encodeJpegImage(block, {...options,chromaSubsampling:"4:4:4"}));
  else {
   const compressor=createTiffCompressor(options?.tiffCompression,columns*channels);
   try {
    for(let offset=0;offset<block.data.length;offset+=4096) {
     const size=Math.min(4096,block.data.length-offset),raw=new Uint8Array(size/4*channels);
     for(let src=offset,dst=0;src<offset+size;src+=4) {raw[dst++]=block.data[src]!;if(channels===2)raw[dst++]=block.data[src+3]!;if(channels>=3){raw[dst++]=block.data[src+1]!;raw[dst++]=block.data[src+2]!;}if(channels===4)raw[dst++]=block.data[src+3]!;}
     chunks.push(...compressor.push(raw));
    }
    chunks.push(...compressor.push(new Uint8Array(),true));
   } finally {compressor.close();}
  }
  stripSizes.push(chunks.slice(start).reduce((sum,chunk)=>sum+chunk.length,0));
  }
  }
  payloads.push(chunks);
  layouts[index]=createTiffLayout(page,options,end,index+1<pages.length,stripSizes);end=layouts[index]!.end;
 }
 const out=new Uint8Array(end);
 let offset=0;
 for(let index=0;index<pages.length;index++) {
  const {header,directory,padding}=layouts[index]!;
  out.set(index===0?header:directory,offset);offset+=index===0?header.length:directory.length;
  for(const chunk of payloads[index]!) {out.set(chunk,offset);offset+=chunk.length;}
  offset+=padding;
  if(index===0) { out.set(directory,offset);offset+=directory.length; }
 }
 return out;
}

function readTiffTagValues(
  view: DataView,
  entryPos: number,
  le: boolean
): number[] {
  const type = view.getUint16(entryPos + 2, le);
  const count = view.getUint32(entryPos + 4, le);
  const elemSize = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 1;
  const totalBytes = count * elemSize;
  const valPos = totalBytes <= 4 ? entryPos + 8 : view.getUint32(entryPos + 8, le);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = valPos + i * elemSize;
    if (off + elemSize > view.byteLength) break;
    if (type === 3) values.push(view.getUint16(off, le));
    else if (type === 4) values.push(view.getUint32(off, le));
    else if (type === 5) {
      const num = view.getUint32(off, le);
      const den = view.getUint32(off + 4, le);
      values.push(den > 0 ? num / den : num);
    }
    else values.push(view.getUint8(off));
  }
  return values;
}

function decodePackBits(src: Uint8Array, expectedLen: number): Uint8Array {
  const out = new Uint8Array(expectedLen);
  let sp = 0;
  let dp = 0;
  while (sp < src.length && dp < expectedLen) {
    const n = (src[sp++]! << 24) >> 24;
    if (n >= 0) {
      const count = n + 1;
      for (let i = 0; i < count && sp < src.length && dp < expectedLen; i++) {
        out[dp++] = src[sp++]!;
      }
    } else if (n !== -128) {
      const count = 1 - n;
      const val = src[sp++] ?? 0;
      for (let i = 0; i < count && dp < expectedLen; i++) {
        out[dp++] = val;
      }
    }
  }
  return out;
}

function decodeTiffLzw(src: Uint8Array, expectedLen: number): Uint8Array {
  const out = new Uint8Array(expectedLen);
  let dp = 0;
  let bitPos = 0;
  let codeSize = 9;
  const CLEAR_CODE = 256;
  const EOI_CODE = 257;
  let dict: Uint8Array[] = [];

  const resetDict = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict[i] = new Uint8Array([i]);
    dict[CLEAR_CODE] = new Uint8Array(0);
    dict[EOI_CODE] = new Uint8Array(0);
    codeSize = 9;
  };
  resetDict();

  const readCode = (): number => {
    if (bitPos + codeSize > src.length * 8) return EOI_CODE;
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      const bitIdx = 7 - ((bitPos + i) & 7);
      code = (code << 1) | ((src[byteIdx]! >>> bitIdx) & 1);
    }
    bitPos += codeSize;
    return code;
  };

  let prevEntry: Uint8Array | undefined;
  while (dp < expectedLen) {
    const code = readCode();
    if (code === EOI_CODE) break;
    if (code === CLEAR_CODE) {
      resetDict();
      const first = readCode();
      if (first === EOI_CODE) break;
      const entry = dict[first] ?? new Uint8Array([first & 0xff]);
      for (let i = 0; i < entry.length && dp < expectedLen; i++) out[dp++] = entry[i]!;
      prevEntry = entry;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length && dict[code]) {
      entry = dict[code]!;
    } else if (prevEntry && code === dict.length) {
      entry = new Uint8Array(prevEntry.length + 1);
      entry.set(prevEntry, 0);
      entry[prevEntry.length] = prevEntry[0]!;
    } else {
      break;
    }
    for (let i = 0; i < entry.length && dp < expectedLen; i++) out[dp++] = entry[i]!;
    if (prevEntry && dict.length < 4096) {
      const next = new Uint8Array(prevEntry.length + 1);
      next.set(prevEntry, 0);
      next[prevEntry.length] = entry[0]!;
      dict.push(next);
      if (dict.length === 511 && codeSize === 9) codeSize = 10;
      else if (dict.length === 1023 && codeSize === 10) codeSize = 11;
      else if (dict.length === 2047 && codeSize === 11) codeSize = 12;
    }
    prevEntry = entry;
  }
  return out;
}

export function decodeTiffImage(bytes: Uint8Array): RgbaImage {
  const le = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(4, le);
  const numEntries = view.getUint16(ifdOffset, le);
  let width = 0;
  let height = 0;
  let bitsPerSample = 8;
  let compression = 1;
  let photometric = 2;
  let stripOffsets: number[] = [8];
  let stripByteCounts: number[] = [];
  let tileWidth = 0;
  let tileLength = 0;
  let tileOffsets: number[] = [];
  let tileByteCounts: number[] = [];
  let samplesPerPixel = 4;
  let extraSample: number | undefined;
  let planar = false;
  let rowsPerStrip = 0;
  let predictor = 1;
  let xRes = 72, yRes = 72;
  let resUnit = 2;
  let orientation: number | undefined;
  let properties: Record<string,string> | undefined;
  let jpegTables: Uint8Array | undefined;
  for (let i = 0; i < numEntries; i++) {
    const p = ifdOffset + 2 + i * 12;
    const tag = view.getUint16(p, le);
    const vals = readTiffTagValues(view, p, le);
    const first = vals[0] ?? 0;
    if (tag === 256) width = first;
    else if (tag === 257) height = first;
    else if (tag === 258 && first > 0) bitsPerSample = first;
    else if (tag === 259 && first > 0) compression = first;
    else if (tag === 262) photometric = first;
    else if (tag === 270) properties = {comment: new TextDecoder().decode(new Uint8Array(vals.slice(0, vals.indexOf(0) < 0 ? vals.length : vals.indexOf(0))))};
    else if (tag === 273 && vals.length > 0) stripOffsets = vals;
    else if (tag === 274 && first >= 1 && first <= 8) orientation = first;
    else if (tag === 277 && first > 0) samplesPerPixel = first;
    else if (tag === 278 && first > 0) rowsPerStrip = first;
    else if (tag === 279 && vals.length > 0) stripByteCounts = vals;
    else if (tag === 282 && first > 0) xRes = first;
    else if (tag === 283 && first > 0) yRes = first;
    else if (tag === 284) planar = first === 2;
    else if (tag === 296 && (first === 1 || first === 2 || first === 3)) resUnit = first;
    else if (tag === 317 && first > 0) predictor = first;
    else if (tag === 322 && first > 0) tileWidth = first;
    else if (tag === 323 && first > 0) tileLength = first;
    else if (tag === 324 && vals.length > 0) tileOffsets = vals;
    else if (tag === 325 && vals.length > 0) tileByteCounts = vals;
    else if (tag === 338) extraSample = first;
    else if (tag === 347) {
      const count = view.getUint32(p + 4, le);
      const valOff = count <= 4 ? p + 8 : view.getUint32(p + 8, le);
      if (valOff + count <= bytes.length) {
        jpegTables = bytes.subarray(valOff, valOff + count);
      }
    }
  }

  const bytesPerSample = Math.max(1, bitsPerSample >>> 3);
  const chunkSamples = planar ? 1 : samplesPerPixel;
  const bytesPerPixel = chunkSamples * bytesPerSample;
  const rowByteWidth = width * bytesPerPixel;
  const planeBytes = height * rowByteWidth;
  const totalExpectedBytes = planeBytes * (planar ? samplesPerPixel : 1);
  const combined = new Uint8Array(totalExpectedBytes);

  const decompressChunk = (off: number, rawLen: number, expectedBytes: number): Uint8Array => {
    const rawSlice = bytes.subarray(off, Math.min(bytes.length, off + rawLen));
    if (compression === 7 || compression === 6) {
      let fullJpeg = rawSlice;
      if (
        jpegTables &&
        jpegTables.length > 4 &&
        jpegTables[0] === 0xff &&
        jpegTables[1] === 0xd8 &&
        rawSlice.length > 2 &&
        rawSlice[0] === 0xff &&
        rawSlice[1] === 0xd8
      ) {
        const tablesBody = jpegTables.subarray(2, jpegTables.length - 2);
        fullJpeg = new Uint8Array(tablesBody.length + rawSlice.length);
        fullJpeg[0] = 0xff;
        fullJpeg[1] = 0xd8;
        fullJpeg.set(tablesBody, 2);
        fullJpeg.set(rawSlice.subarray(2), 2 + tablesBody.length);
      }
      const decJpeg = decodeJpegImage(fullJpeg);
      const outChunk = new Uint8Array(expectedBytes);
      const numPx = Math.min(decJpeg.width * decJpeg.height, Math.floor(expectedBytes / chunkSamples));
      for (let p = 0; p < numPx; p++) {
        for (let c = 0; c < chunkSamples; c++) {
          outChunk[p * chunkSamples + c] = decJpeg.data[p * 4 + Math.min(3, c)] ?? 255;
        }
      }
      return outChunk;
    }
    if (compression === 8 || compression === 32946) {
      try {
        return transformBytes(rawSlice, { direction: "decode", format: "zlib-or-gzip" });
      } catch {
        return rawSlice;
      }
    }
    if (compression === 5) return decodeTiffLzw(rawSlice, expectedBytes);
    if (compression === 32773) return decodePackBits(rawSlice, expectedBytes);
    return rawSlice;
  };

  const applyHorizontalPredictor = (buf: Uint8Array, rows: number, strideBytes: number) => {
    if (bytesPerSample === 1) {
      for (let ry = 0; ry < rows; ry++) {
        const rStart = ry * strideBytes;
        for (let rx = chunkSamples; rx < strideBytes && rStart + rx < buf.length; rx++) {
          buf[rStart + rx] = ((buf[rStart + rx] ?? 0) + (buf[rStart + rx - chunkSamples] ?? 0)) & 0xff;
        }
      }
    } else if (bytesPerSample === 2) {
      const step = chunkSamples * 2;
      for (let ry = 0; ry < rows; ry++) {
        const rStart = ry * strideBytes;
        for (let rx = step; rx + 1 < strideBytes && rStart + rx + 1 < buf.length; rx += 2) {
          const prevOff = rStart + rx - step;
          const curOff = rStart + rx;
          const prev16 = le
            ? (buf[prevOff] ?? 0) | ((buf[prevOff + 1] ?? 0) << 8)
            : ((buf[prevOff] ?? 0) << 8) | (buf[prevOff + 1] ?? 0);
          const cur16 = le
            ? (buf[curOff] ?? 0) | ((buf[curOff + 1] ?? 0) << 8)
            : ((buf[curOff] ?? 0) << 8) | (buf[curOff + 1] ?? 0);
          const sum16 = (prev16 + cur16) & 0xffff;
          if (le) {
            buf[curOff] = sum16 & 0xff;
            buf[curOff + 1] = (sum16 >>> 8) & 0xff;
          } else {
            buf[curOff] = (sum16 >>> 8) & 0xff;
            buf[curOff + 1] = sum16 & 0xff;
          }
        }
      }
    }
  };

  if (tileWidth > 0 && tileLength > 0 && tileOffsets.length > 0) {
    const tilesAcross = Math.max(1, Math.ceil(width / tileWidth));
    const tilesPerPlane = tilesAcross * Math.ceil(height / tileLength);
    const tileRowByteWidth = tileWidth * bytesPerPixel;
    const expectedTileBytes = tileLength * tileRowByteWidth;
    for (let t = 0; t < tileOffsets.length; t++) {
      const off = tileOffsets[t]!;
      const rawLen = tileByteCounts[t] ?? Math.max(0, bytes.length - off);
      const decodedTile = new Uint8Array(decompressChunk(off, rawLen, expectedTileBytes));
      if (predictor === 2) {
        applyHorizontalPredictor(decodedTile, tileLength, tileRowByteWidth);
      }
      const tx = (t % tilesAcross) * tileWidth;
      const ty = Math.floor((planar ? t % tilesPerPlane : t) / tilesAcross) * tileLength;
      const planeOffset = planar ? Math.floor(t / tilesPerPlane) * planeBytes : 0;
      const validW = Math.max(0, Math.min(tileWidth, width - tx));
      const validH = Math.max(0, Math.min(tileLength, height - ty));
      const validRowBytes = validW * bytesPerPixel;
      for (let ry = 0; ry < validH; ry++) {
        const srcStart = ry * tileRowByteWidth;
        const dstStart = planeOffset + (ty + ry) * rowByteWidth + tx * bytesPerPixel;
        if (srcStart + validRowBytes <= decodedTile.length && dstStart + validRowBytes <= combined.length) {
          combined.set(decodedTile.subarray(srcStart, srcStart + validRowBytes), dstStart);
        }
      }
    }
  } else {
    const effectiveRowsPerStrip = rowsPerStrip > 0 ? rowsPerStrip : height;
    const stripsPerPlane = Math.ceil(height / effectiveRowsPerStrip);
    let dstOff = 0;
    for (let s = 0; s < stripOffsets.length && dstOff < totalExpectedBytes; s++) {
      const off = stripOffsets[s]!;
      if (planar) {
        if (s >= stripsPerPlane * samplesPerPixel) break;
        dstOff = Math.floor(s / stripsPerPlane) * planeBytes + (s % stripsPerPlane) * effectiveRowsPerStrip * rowByteWidth;
      }
      const remainingBytes = planar ? planeBytes - dstOff % planeBytes : totalExpectedBytes - dstOff;
      const expectedStripBytes = Math.min(remainingBytes, effectiveRowsPerStrip * rowByteWidth);
      const rawLen = stripByteCounts[s] ?? Math.max(0, bytes.length - off);
      const decodedStrip = decompressChunk(off, rawLen, expectedStripBytes);
      const copyLen = Math.min(decodedStrip.length, remainingBytes);
      combined.set(decodedStrip.subarray(0, copyLen), dstOff);
      dstOff += copyLen;
    }

    if (predictor === 2) {
      applyHorizontalPredictor(combined, height * (planar ? samplesPerPixel : 1), rowByteWidth);
    }
  }

  const readSample8 = (pixelIdx: number, ch: number): number => {
    const base = planar ? ch * planeBytes + pixelIdx * bytesPerSample : (pixelIdx * samplesPerPixel + ch) * bytesPerSample;
    if (bytesPerSample === 2) {
      return le ? (combined[base + 1] ?? 0) : (combined[base] ?? 0);
    }
    return combined[base] ?? 0;
  };

  const hasAlpha = (samplesPerPixel === 2 || samplesPerPixel === 4) && (extraSample === undefined || extraSample === 1 || extraSample === 2);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (samplesPerPixel === 1) {
      let g = readSample8(i, 0);
      if (photometric === 0) g = 255 - g;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    } else if (samplesPerPixel === 2) {
      let g = readSample8(i, 0);
      if (photometric === 0) g = 255 - g;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = hasAlpha ? readSample8(i, 1) : 255;
    } else {
      rgba[i * 4] = readSample8(i, 0);
      rgba[i * 4 + 1] = readSample8(i, 1);
      rgba[i * 4 + 2] = readSample8(i, 2);
      rgba[i * 4 + 3] = hasAlpha || (extraSample === undefined && samplesPerPixel >= 4) ? readSample8(i, 3) : 255;
    }
    if (hasAlpha && extraSample === 1) {
      const alpha = rgba[i * 4 + 3]!;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.min(255, Math.round(rgba[i * 4 + c]! * 255 / Math.max(alpha, Number.EPSILON)));
    }
  }
  const density = resUnit === 3 ? Math.max(1, Math.round(xRes * 2.54)) : Math.max(1, Math.round(xRes));
  return {
    width,
    height,
    data: rgba,
    format: "tiff",
    space:
      samplesPerPixel < 3
        ? bitsPerSample === 16
          ? "grey16"
          : "b-w"
        : bitsPerSample === 16
          ? "rgb16"
          : "srgb",
    channels: samplesPerPixel < 3 ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3,
    depth: bitsPerSample === 16 ? "ushort" : "uchar",
    bitsPerSample,
    density,
    resolution: {x:xRes,y:yRes,unit:resUnit===3?"cm":resUnit===1?"unknown":"inch"},
    hasAlpha,
    ...(properties ? {properties} : {}),
    ...(orientation !== undefined ? { orientation } : {})
  };
}
