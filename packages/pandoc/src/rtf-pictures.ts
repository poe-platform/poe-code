import { decode } from "jpeg-js";
import { PandocError } from "./errors.js";
import type { AdapterContext } from "./types.js";

export interface Picture {readonly width: number; readonly height: number; readonly encoding: "png" | "jpeg"}
function invalid(context: AdapterContext, message: string): never {
  throw new PandocError("E_RESOURCE", context.operation ?? "write", message, "rtf");
}
function dimensions(width: number, height: number, context: AdapterContext): void {
  if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 32767 || height > 32767)
    invalid(context, "Picture dimensions outside RTF profile");
  context.charge("images", 1);
  context.charge("expandedBytes", width * height * 4);
  context.charge("layoutWork", width * height);
}

async function png(bytes: Uint8Array, context: AdapterContext): Promise<Picture> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataClosed = false;
  let compressed = 0; const data: Uint8Array[] = [];
  while(offset < bytes.length) {
    await context.cooperate(); context.charge("parts", 1);
    if(bytes.length - offset < 12) invalid(context, "Truncated PNG chunk");
    const length = view.getUint32(offset);
    if(length > bytes.length - offset - 12) invalid(context, "PNG chunk length exceeds resource bytes");
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for(let i = offset + 4; i < offset + 8 + length; i++) {
      context.checkpoint(); crc ^= bytes[i]!;
      for(let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if(((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) invalid(context, "PNG checksum mismatch");
    const start = offset + 8;
    if(name === "IHDR") {
      if(offset !== 8 || length !== 13) invalid(context, "Invalid PNG header");
      width = view.getUint32(start); height = view.getUint32(start + 4);
      dimensions(width, height, context);
      channels = ({0: 1, 2: 3, 4: 2, 6: 4} as Record<number, number>)[bytes[start + 9]!] ?? 0;
      if(bytes[start + 8] !== 8 || !channels || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0)
        invalid(context, "PNG profile requires noninterlaced 8-bit gray/RGB/gray-alpha/RGBA");
    } else if(!width) invalid(context, "PNG header must be first");
    else if(name === "IDAT") {
      if(dataClosed) invalid(context, "Nonconsecutive PNG image chunks");
      seenData = true; compressed += length;
      context.charge("compressedBytes", length); context.charge("references", 1);
      data.push(bytes.subarray(start, start + length));
    } else if(name === "IEND") {
      if(length || !seenData || start + 4 !== bytes.length) invalid(context, "Invalid PNG end");
      ended = true;
    } else {
      if(seenData) dataClosed = true;
      const lengths: Record<string, number> = {gAMA: 4, cHRM: 32, sRGB: 1, pHYs: 9};
      if(lengths[name] !== length) invalid(context, `Unsupported PNG chunk: ${name}`);
    }
    offset += length + 12;
  }
  if(!ended || !compressed) invalid(context, "Missing PNG image data/end");
  const stride = width * channels + 1, expected = stride * height;
  context.charge("expandedBytes", expected); context.charge("retainedBytes", compressed);
  const joined = new Uint8Array(compressed); let at = 0;
  for(const chunk of data) {joined.set(chunk, at); at += chunk.length;}
  // Explicit stream decoding validates compressed data without allocating its
  // advertised expansion. Reserve expected capacity before receiving any chunk.
  context.charge("retainedBytes", expected + 65536);
  const stream = new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader(); let count = 0;
  try {
    while(true) {
      await context.cooperate(); const result = await reader.read();
      if(result.done) break;
      if(result.value.length > expected - count) invalid(context, "PNG expands beyond checked scanline length");
      for(const byte of result.value) {context.checkpoint(); if(count % stride === 0 && byte > 4) invalid(context, "Invalid PNG scanline filter"); count++;}
    }
    if(count !== expected) invalid(context, "PNG scanline length mismatch");
  } catch(error) {
    if(error instanceof PandocError) throw error;
    invalid(context, "Invalid PNG compressed image data");
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
  return {width, height, encoding: "png"};
}

function jpeg(bytes: Uint8Array, context: AdapterContext): Picture {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2, width = 0, height = 0, components = 0, scanned = false;
  while(offset < bytes.length) {
    context.checkpoint(); context.charge("parts", 1);
    if(bytes[offset++] !== 255) invalid(context, "Invalid JPEG marker");
    const marker = bytes[offset++];
    if(marker === 217) break;
    if(![192,196,219,218,224].includes(marker ?? 0) || bytes.length - offset < 2) invalid(context, "Unsupported or truncated JPEG marker");
    const length = view.getUint16(offset);
    if(length < 2 || length > bytes.length - offset) invalid(context, "Invalid JPEG segment length");
    if(marker === 192) {
      if(width || length < 11 || bytes[offset + 2] !== 8) invalid(context, "Invalid JPEG frame");
      height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); components = bytes[offset + 7]!;
      if(![1,3].includes(components) || length !== 8 + components * 3) invalid(context, "Unsupported JPEG components");
      dimensions(width, height, context);
      for(let i = 0; i < components; i++) {
        const sampling = bytes[offset + 9 + i * 3]!;
        if((sampling >>> 4) < 1 || (sampling >>> 4) > 2 || (sampling & 15) < 1 || (sampling & 15) > 2) invalid(context, "Unsupported JPEG sampling");
      }
    }
    if(marker === 224 && (length < 16 || String.fromCharCode(...bytes.subarray(offset + 2, offset + 7)) !== "JFIF\0")) invalid(context, "Only JFIF JPEG application metadata supported");
    offset += length;
    if(marker === 218) {
      if(!width || scanned) invalid(context, "Invalid JPEG scan");
      scanned = true;
      // This bounded baseline profile has one scan; escaped FF bytes are data.
      while(offset < bytes.length && bytes[offset] !== 255) {context.checkpoint(); offset++;}
      while(offset + 1 < bytes.length && bytes[offset] === 255 && bytes[offset + 1] === 0) {
        offset += 2; while(offset < bytes.length && bytes[offset] !== 255) {context.checkpoint(); offset++;}
      }
      if(offset + 2 !== bytes.length || bytes[offset] !== 255 || bytes[offset + 1] !== 217) invalid(context, "JPEG requires one complete baseline scan and end marker");
    }
  }
  if(!width || !scanned || offset !== bytes.length || bytes.at(-1) !== 217) invalid(context, "Incomplete JPEG");
  // Conservatively reserve block coefficients, sampling planes and decoded RGBA.
  const memory = 65536 + Math.ceil(width / 8) * Math.ceil(height / 8) * 64 * 64;
  context.charge("retainedBytes", memory); context.charge("expandedBytes", memory);
  context.checkpoint(width * height);
  try {
    const decoded = decode(bytes, {useTArray: true, tolerantDecoding: false, maxResolutionInMP: width * height / 1e6, maxMemoryUsageInMB: memory / 1048576});
    if(decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) invalid(context, "JPEG decoded dimensions mismatch");
  } catch(error) {
    if(error instanceof PandocError) throw error;
    invalid(context, "Invalid JPEG encoded data");
  }
  return {width, height, encoding: "jpeg"};
}
export async function inspectRtfPicture(bytes: Uint8Array, context: AdapterContext): Promise<Picture> {
  context.charge("binaryBytes", bytes.length);
  if(bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return png(bytes, context);
  if(bytes[0] === 255 && bytes[1] === 216) return jpeg(bytes, context);
  return invalid(context, "RTF pictures require valid PNG or baseline JPEG resources");
}
