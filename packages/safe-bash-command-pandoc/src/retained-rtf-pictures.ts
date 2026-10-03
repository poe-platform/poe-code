import type {ImageByteSource, ImageByteStorage} from "@poe-code/image-ast";
import type {ExecutionContext} from "./execution.js";
import type {Picture} from "./rtf-pictures.js";
import {PandocError} from "./errors.js";

/** Preserve the RTF picture profile while retaining compressed bytes and JPEG
 * decoding planes in caller storage. PNG inflation only counts scanline bytes. */
export async function inspectRetainedRtfPicture(source: ImageByteSource, storage: ImageByteStorage, context: ExecutionContext): Promise<Picture> {
  const invalid = (message: string): never => {throw new PandocError("E_RESOURCE", context.operation, message, "rtf");};
  const signal = context.signal ?? new AbortController().signal;
  const read = async (position: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
    context.checkpoint();
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || length > 16384 || position + length > source.size) invalid("Truncated picture source");
    const bytes = await context.call(() => source.read(position, length, {signal}));
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) invalid("Truncated picture source");
    return new Uint8Array(bytes);
  };
  const dimensions = (width: number, height: number): void => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 32767 || height > 32767) invalid("Picture dimensions outside RTF profile");
    context.charge("images", 1); context.charge("expandedBytes", width * height * 4); context.charge("layoutWork", width * height);
  };
  context.charge("binaryBytes", source.size, false);
  const prefix = await read(0, Math.min(8, source.size));
  if (prefix.length === 8 && [137,80,78,71,13,10,26,10].every((value, index) => prefix[index] === value)) {
    let offset = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataClosed = false, compressed = 0;
    while (offset < source.size) {
      await context.cooperate(); context.charge("parts", 1);
      if (source.size - offset < 12) invalid("Truncated PNG chunk");
      const header = await read(offset, 8), length = new DataView(header.buffer).getUint32(0);
      if (length > source.size - offset - 12) invalid("PNG chunk length exceeds resource bytes");
      const name = String.fromCharCode(...header.subarray(4)), start = offset + 8;
      let crc = 0xffffffff;
      for (let position = offset + 4; position < start + length;) {
        const bytes = await read(position, Math.min(16384, start + length - position));
        for (const byte of bytes) {context.checkpoint(); crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
        position += bytes.length; await context.cooperate(0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== new DataView((await read(start + length, 4)).buffer).getUint32(0)) invalid("PNG checksum mismatch");
      if (name === "IHDR") {
        if (offset !== 8 || length !== 13) invalid("Invalid PNG header");
        const bytes = await read(start, 13), view = new DataView(bytes.buffer);
        width = view.getUint32(0); height = view.getUint32(4); dimensions(width, height);
        channels = ({0: 1, 2: 3, 4: 2, 6: 4} as Record<number, number>)[bytes[9]!] ?? 0;
        if (bytes[8] !== 8 || !channels || bytes[10] !== 0 || bytes[11] !== 0 || bytes[12] !== 0) invalid("PNG profile requires noninterlaced 8-bit gray/RGB/gray-alpha/RGBA");
      } else if (!width) invalid("PNG header must be first");
      else if (name === "IDAT") {
        if (dataClosed) invalid("Nonconsecutive PNG image chunks");
        seenData = true; compressed += length; context.charge("compressedBytes", length, false); context.charge("references", 1);
      } else if (name === "IEND") {
        if (length || !seenData || start + 4 !== source.size) invalid("Invalid PNG end");
        ended = true;
      } else {
        if (seenData) dataClosed = true;
        if (({gAMA: 4, cHRM: 32, sRGB: 1, pHYs: 9} as Record<string, number>)[name] !== length) invalid("Unsupported PNG chunk: " + name);
      }
      offset += length + 12;
    }
    if (!ended || !compressed) invalid("Missing PNG image data/end");
    const stride = width * channels + 1, expected = stride * height;
    context.charge("expandedBytes", expected, false);
    const data = (async function* () {
      for (let offset = 8; offset < source.size;) {
        const header = await read(offset, 8), length = new DataView(header.buffer).getUint32(0);
        if (String.fromCharCode(...header.subarray(4)) === "IDAT") {
          for (let position = 0; position < length; position += 16384) yield await read(offset + 8 + position, Math.min(16384, length - position));
        }
        offset += length + 12; await context.cooperate();
      }
    })();
    let sourceFailure: unknown;
    const stream = new ReadableStream<BufferSource>({
      async pull(controller) {
        try {const next = await data.next(); if (next.done) controller.close(); else controller.enqueue(next.value);}
        catch (error) {sourceFailure = error; controller.error(error);}
      },
      async cancel() {await data.return(undefined);}
    }, {highWaterMark: 0}).pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader(); let count = 0;
    try {
      while (true) {
        await context.cooperate(); const result = await reader.read();
        if (result.done) break;
        if (result.value.length > expected - count) invalid("PNG expands beyond checked scanline length");
        for (const byte of result.value) {context.checkpoint(); if (count % stride === 0 && byte > 4) invalid("Invalid PNG scanline filter"); count++;}
      }
      if (count !== expected) invalid("PNG scanline length mismatch");
    } catch (error) {
      context.checkpoint();
      if (sourceFailure) throw sourceFailure;
      if (error instanceof PandocError) throw error;
      invalid("Invalid PNG compressed image data");
    } finally {await reader.cancel().catch(() => {}); reader.releaseLock(); await data.return(undefined);}
    return {width, height, encoding: "png"};
  }
  if (prefix[0] === 255 && prefix[1] === 216) {
    let offset = 2, width = 0, height = 0, scanned = false;
    while (offset < source.size) {
      context.checkpoint(); context.charge("parts", 1);
      const markerBytes = await read(offset, Math.min(2, source.size - offset)); offset++;
      if (markerBytes[0] !== 255) invalid("Invalid JPEG marker");
      const marker = markerBytes[1]; offset++;
      if (marker === 217) break;
      if (![192,194,196,219,218,224,221].includes(marker ?? 0) || source.size - offset < 2) invalid("Unsupported or truncated JPEG marker");
      const length = new DataView((await read(offset, 2)).buffer).getUint16(0);
      if (length < 2 || length > source.size - offset) invalid("Invalid JPEG segment length");
      if (marker === 192 || marker === 194) {
        if (width || length < 11) invalid("Invalid JPEG frame");
        const bytes = await read(offset, Math.min(length, 17)), view = new DataView(bytes.buffer);
        if (bytes[2] !== 8) invalid("Invalid JPEG frame");
        height = view.getUint16(3); width = view.getUint16(5); const components = bytes[7]!;
        if (![1,3].includes(components) || length !== 8 + components * 3) invalid("Unsupported JPEG components");
        dimensions(width, height);
        for (let i = 0; i < components; i++) {
          const sampling = bytes[9 + i * 3]!;
          if ((sampling >>> 4) < 1 || (sampling >>> 4) > 2 || (sampling & 15) < 1 || (sampling & 15) > 2) invalid("Unsupported JPEG sampling");
        }
      }
      if (marker === 224 && (length < 16 || String.fromCharCode(...await read(offset + 2, 5)) !== "JFIF\0")) invalid("Only JFIF JPEG application metadata supported");
      offset += length;
      if (marker === 218) {
        if (!width) invalid("Invalid JPEG scan");
        scanned = true;
        let boundary = false;
        while (offset < source.size && !boundary) {
          const bytes = await read(offset, Math.min(16384, source.size - offset)); let index = 0;
          while (index < bytes.length) {
            context.checkpoint();
            if (bytes[index] !== 255) {index++; continue;}
            if (index + 1 === bytes.length && offset + bytes.length < source.size) break;
            const next = bytes[index + 1];
            if (next === 0 || next !== undefined && next >= 208 && next <= 215) {index += 2; continue;}
            boundary = true; break;
          }
          offset += index; await context.cooperate(0);
        }
      }
    }
    if (!width || !scanned || offset !== source.size || (await read(source.size - 1, 1))[0] !== 217) invalid("Incomplete JPEG");
    const memory = 65536 + Math.ceil(width / 8) * Math.ceil(height / 8) * 64 * 64;
    context.charge("expandedBytes", memory, false); context.checkpoint(width * height);
    try {
      const {decodeJpegToStorage} = await import("@poe-code/image-ast");
      const decoded = await decodeJpegToStorage({size: source.size, read}, {
        allocate(length) {context.checkpoint(); return storage.allocate(length);},
        read(position, length) {return context.call(() => storage.read(position, length, {signal}));},
        write(position, bytes) {return context.call(() => storage.write(position, bytes, {signal}));}
      }, signal, {unlimited: true});
      if (decoded.width !== width || decoded.height !== height) invalid("JPEG decoded dimensions mismatch");
    } catch (error) {
      context.checkpoint();
      if (error instanceof PandocError) throw error;
      invalid("Invalid JPEG encoded data");
    }
    return {width, height, encoding: "jpeg"};
  }
  return invalid("RTF pictures require valid PNG or JPEG resources");
}
