import { ADAM7_PASSES } from "./png-pixels.js";
import { PngPalette } from "./png-palette.js";
import { GifPalette } from "./gif-output-parts.js";
import {pngMetadataSteps} from "./png-metadata.js";
import {PNG_SIGNATURE, validPngTransparencyLength, pngCrc32, makeChunk, gammaChunk, canvasChunk, iccChunk, xmpChunk, textChunks} from "./png-chunks.js";
import {buildExifApp1Segment} from "./exif.js";
import {createByteCodec, defaultRuntime} from "@poe-code/compression";
import {checkLimitInputPixels} from "../limits.js";
import type {RgbaImage, SharpInputOptions, ImageDelayReader} from "../ast.js";
import {isPngBytes, type encodePngImage} from "./png.js";
import {paethPredictor, writePngPixel} from "./png-pixels.js";

/** Borrowed range bytes remain valid until the next read. The source stays caller-owned. */
export interface ImageByteSource {
  readonly size: number;
  read(position: number, length: number, options?: {readonly signal?: AbortSignal}): Promise<Uint8Array>;
}
/** Caller-owned scratch space; codecs never acquire a filesystem or close this storage. */
export interface ImageByteStorage extends Pick<ImageByteSource, "read"> {
  allocate(length: number): number;
  write(position: number, bytes: Uint8Array, options?: {readonly signal?: AbortSignal}): Promise<void>;
}
export interface StoredRgbaImage extends Omit<RgbaImage, "evaluateSamples" | "hueSamples" | "data" | "data16" | "dataFloat" | "pngIndices" | "miffPages" | "tiffPages" | "icoPages"> {
  readonly storedHueSamples?: number;
  storedEvaluateSamples?: number | undefined;
  readonly storedMiffPages?: { readonly length: number; at(index: number): Promise<StoredRgbaImage> };
  readonly storedIcoPages?: { readonly length: number; at(index: number): Promise<StoredRgbaImage> };
  readonly storedTiffPages?: { readonly length: number; at(index: number): Promise<StoredRgbaImage> };
  readonly storedPngIndices?: { readonly position: number; readonly width: number; readonly height: number };
  readonly position: number;
  /** Normalized float samples retain their unclamped values in caller storage. */
  readonly storedDataFloat?: {readonly position:number;readonly length:number};
  /** Original high-depth raw samples retain the same lifetime as buffered data16. */
  readonly storedData16?: {readonly position:number;readonly length:number};
  /** Frame delays can remain in caller storage instead of an unbounded metadata array. */
  readonly storedDelay?: ImageDelayReader;
  readonly storedDisposal?: ImageDelayReader;
  readonly storedGifFrame?: { at(index: number): Promise<NonNullable<RgbaImage["gifFrames"]>[number]> };
}

async function range(source: ImageByteSource, position: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0 || length > 4096 || position + length > source.size) throw new Error("Truncated PNG data");
  const bytes = await source.read(position, length, {signal});
  signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array)) throw new TypeError("PNG source must return byte chunks");
  if (bytes.length !== length) throw new Error("Truncated PNG data");
  return new Uint8Array(bytes);
}
async function* chunks(source: ImageByteSource, signal: AbortSignal) {
  let work = 0;
  for (let position = 8; position + 8 <= source.size;) {
    if (++work % 64 === 0) await defaultRuntime.yieldTurn(signal);
    const header = await range(source, position, 8, signal);
    const length = new DataView(header.buffer).getUint32(0);
    const name = String.fromCharCode(...header.subarray(4));
    const start = position + 8;
    if (start + length + 4 > source.size) throw new Error("Truncated PNG chunk");
    yield {name, start, length, typeBytes: header.subarray(4)};
    if (name === "IEND") return;
    position = start + length + 4;
  }
}

/** Read original PNG metadata without decoding pixels or reading compressed payloads. */
export async function readPngMetadataFromSource(source:ImageByteSource,signal:AbortSignal) {
  signal.throwIfAborted();
  if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
  const steps=pngMetadataSteps(source.size);let next=steps.next(),work=0;
  while(!next.done) {
    if(++work%64===0)await defaultRuntime.yieldTurn(signal);
    next=steps.next(await range(source,next.value.position,next.value.length,signal));
  }
  signal.throwIfAborted();return next.value;
}

async function* inflated(source: ImageByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const decoder = createByteCodec({direction: "decode", format: "zlib-or-gzip", chunkSize: 4096});
  try {
    for await (const chunk of chunks(source, signal)) {
      if (chunk.name !== "IDAT") continue;
      for (let offset = 0; offset < chunk.length; offset += 4096) {
        signal.throwIfAborted();
        const bytes = await range(source, chunk.start + offset, Math.min(4096, chunk.length - offset), signal);
        for (const decoded of decoder.push(bytes)) {signal.throwIfAborted(); yield decoded;}
        if (decoder.complete) return;
      }
    }
    for (const decoded of decoder.push(new Uint8Array(), true)) {signal.throwIfAborted(); yield decoded;}
  } finally {decoder.close();}
}

/** Decode using bounded ranges and caller backing, including scanlines wider than the cache. */
export async function decodePngToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: Pick<SharpInputOptions, "limitInputPixels" | "unlimited">): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 24 || !isPngBytes(await range(source, 0, 8, signal))) throw new Error("Invalid PNG header");
  let header: Uint8Array | undefined, palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  let hasIdat = false;
  for await (const chunk of chunks(source, signal)) {
    if (chunk.name === "IDAT") hasIdat = true;
    if ((chunk.typeBytes[0]! & 32) === 0 || chunk.name === "tRNS") {
      let crc = pngCrc32(chunk.typeBytes);
      for (let offset = 0; offset < chunk.length; offset += 4096) {
        crc = pngCrc32(await range(source, chunk.start + offset, Math.min(4096, chunk.length - offset), signal), crc);
        if (offset % (64 * 4096) === 0) await defaultRuntime.yieldTurn(signal);
      }
      const checksum = await range(source, chunk.start + chunk.length, 4, signal);
      if (crc !== new DataView(checksum.buffer).getUint32(0)) {
        if ((chunk.typeBytes[0]! & 32) === 0) throw new Error(`PNG ${chunk.name} CRC mismatch`);
        continue;
      }
    }
    if ((chunk.name.charCodeAt(0) & 32) === 0 && chunk.name !== "IHDR" && chunk.name !== "PLTE" && chunk.name !== "IDAT" && chunk.name !== "IEND") {
      throw new Error(`PNG unhandled critical chunk ${chunk.name}`);
    }
    if (chunk.name === "IHDR" && chunk.length >= 13) header = await range(source, chunk.start, 13, signal);
    else if (chunk.name === "PLTE") palette = await range(source, chunk.start, Math.min(chunk.length, 768), signal);
    else if (chunk.name === "tRNS" && !hasIdat && header && validPngTransparencyLength(header[9]!, chunk.length, palette?.length)) transparency ??= await range(source, chunk.start, chunk.length, signal);
  }
  if (!header) throw new Error("Invalid PNG header");
  const {size: ignoredSize, ...metadata} = await readPngMetadataFromSource(source, signal);
  const {width, height} = metadata, depth = header[8]!, color = header[9]!;
  if (width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 8)) throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  const allowedDepths: Record<number, readonly number[]> = {0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16]};
  if (!allowedDepths[color]?.includes(depth) || header[10] !== 0 || header[11] !== 0 || header[12]! > 1) throw new Error("Unsupported PNG encoding");
  const samples = color === 6 ? 4 : color === 4 ? 2 : color === 2 ? 3 : 1;
  const bits = samples * depth, pixelBytes = Math.max(1, Math.ceil(bits / 8));
  let work = 0;
  const cooperate = async (): Promise<void> => {
    signal.throwIfAborted();
    if (++work % 64 === 0) await defaultRuntime.yieldTurn(signal);
  };
  const readStorage = async (offset: number, length: number): Promise<Uint8Array> => {
    signal.throwIfAborted();
    const bytes = await storage.read(offset, length, {signal});
    signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array)) throw new TypeError("PNG storage must return byte chunks");
    if (bytes.length !== length) throw new Error("Truncated PNG backing storage");
    return new Uint8Array(bytes);
  };
  checkLimitInputPixels(width,height,options);
  const position = storage.allocate(width * height * 4);
  const storedPngIndices = color === 3 ? { position: storage.allocate(width * height), width, height } : undefined;
  const storedData16 = depth === 16 ? { position: storage.allocate(width * height * 8), length: width * height * 4 } : undefined;
  const passes = metadata.isProgressive ? [[0,0,8,8], [4,0,8,8], [0,4,4,8], [2,0,4,4], [0,2,2,4], [1,0,2,2], [0,1,1,2]] : [[0,0,1,1]];
  const iterator = inflated(source, signal);
  let pending: Uint8Array = new Uint8Array();
  let used = 0;
  const take = async (length: number): Promise<Uint8Array> => {
    const output = new Uint8Array(length);
    for (let offset = 0; offset < length;) {
      signal.throwIfAborted();
      if (used === pending.length) {
        const next = await iterator.next();
        if (next.done) throw new Error("Truncated PNG image data");
        pending = next.value; used = 0;
      }
      const count = Math.min(length - offset, pending.length - used);
      output.set(pending.subarray(used, used + count), offset); used += count; offset += count;
    }
    return output;
  };
  try {
    for (const pass of passes) {
      const [x0, y0, dx, dy] = pass as [number, number, number, number];
      const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy);
      if (w <= 0 || h <= 0) continue;
      const rowBytes = Math.ceil(w * bits / 8), rawPosition = storage.allocate(rowBytes * h);
      for (let y = 0; y < h; y++) {
        const filter = (await take(1))[0]!;
        if (filter > 4) throw new Error(`Invalid PNG row filter: ${filter}`);
        const left = new Uint8Array(pixelBytes), aboveLeft = new Uint8Array(pixelBytes);
        for (let offset = 0; offset < rowBytes; offset += 4096) {
          const count = Math.min(4096, rowBytes - offset), data = await take(count);
          const previous = y ? await readStorage(rawPosition + (y - 1) * rowBytes + offset, count) : new Uint8Array(count);
          for (let index = 0; index < count; index++) {
            const slot = (offset + index) % pixelBytes, a = left[slot]!, b = previous[index]!, c = aboveLeft[slot]!;
            const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >>> 1 : filter === 4 ? paethPredictor(a, b, c) : 0;
            data[index] = (data[index]! + predictor) & 255; left[slot] = data[index]!; aboveLeft[slot] = b;
          }
          await cooperate(); await storage.write(rawPosition + y * rowBytes + offset, data, {signal});
        }
        const pixelWindow = storedData16 ? 64 : 128;
        for (let x = 0; x < w; x += pixelWindow) {
          const count = Math.min(pixelWindow, w - x);
          const data = await readStorage(rawPosition + y * rowBytes + x * bits / 8, Math.ceil(count * bits / 8));
          const target = position + ((y0 + y * dy) * width + x0 + x * dx) * 4;
          const output = dx === 1 ? new Uint8Array(count * 4) : await readStorage(target, ((count - 1) * dx + 1) * 4);
          const target16 = storedData16 ? storedData16.position + (target - position) * 2 : 0;
          const bytes16 = storedData16 ? dx === 1 ? new Uint8Array(output.length * 2) : await readStorage(target16, output.length * 2) : undefined;
          const output16 = bytes16 ? new Uint16Array(bytes16.buffer, bytes16.byteOffset, bytes16.byteLength / 2) : undefined;
          for (let index = 0; index < count; index++) writePngPixel(data, 0, index, index * dx * 4, output, depth, color, palette, transparency, output16);
          if (storedPngIndices) {
            const indexTarget = storedPngIndices.position + (target - position) / 4;
            const indices = dx === 1 ? new Uint8Array(count) : await readStorage(indexTarget, (count - 1) * dx + 1);
            for (let index = 0; index < count; index++) indices[index * dx] = (data[(index * depth) >>> 3]! >>> (8 - depth - index * depth % 8)) & ((1 << depth) - 1);
            await storage.write(indexTarget, indices, {signal});
          }
          if (bytes16) await storage.write(target16, bytes16, {signal});
          await cooperate(); await storage.write(target, output, {signal});
        }
      }
    }
    // Drain the bounded decoder so trailing corruption and truncation retain
    // codec diagnostics even after all expected pixels have been produced.
    let excess = used < pending.length;
    for await (const bytes of iterator) {
      signal.throwIfAborted();
      if (bytes.length) excess = true;
    }
    if (excess) metadata.decodeWarnings = [...(metadata.decodeWarnings ?? []), "IDAT: Too much image data"];
  } finally {await iterator.return(undefined);}
  return {...metadata, position, ...(storedPngIndices && palette ? { storedPngIndices, pngPalette: { bytes: palette, depth, ...(transparency ? { transparency } : {}) } } : {}), ...(storedData16 ? {storedData16} : {}), space: color === 0 && transparency ? "srgb" : metadata.space, channels: color === 0 && transparency ? 4 : metadata.channels};
}

export type StoredPngEncodeOptions = Omit<NonNullable<Parameters<typeof encodePngImage>[1]>, "consumeInput">;

/** Encode caller-backed pixels; pulling the generator provides output backpressure. */
export async function* encodePngFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: StoredPngEncodeOptions = {}): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const {width, height, position} = image;
  if (!Number.isSafeInteger(width) || width <= 0 || width > 0xffffffff || !Number.isSafeInteger(height) || height <= 0 || height > 0xffffffff || !Number.isSafeInteger(width * height * 4) || !Number.isSafeInteger(position) || position < 0) throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  let work = 0;
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (++work % 64 === 0) await defaultRuntime.yieldTurn(signal);
    const bytes = await storage.read(offset, length, {signal});
    signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array)) throw new TypeError("PNG storage must return byte chunks");
    if (bytes.length !== length) throw new Error("Truncated PNG backing storage");
    return new Uint8Array(bytes);
  };
  const coder = options.pngCoder === "png00" ? undefined : options.pngCoder;
  const requestedColor = coder ? undefined : options.pngColorType;
  const palette = (coder === "png8" || requestedColor === 3) ? new GifPalette() : undefined;
  if (palette) {
    for (let offset = 0; offset < width * height * 4; offset += 4096) {
      const bytes = await read(position + offset, Math.min(4096, width * height * 4 - offset));
      for (let i = 0; i < bytes.length; i += 4) palette.add(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
    }
  }
  const pngPalette = palette?.finishPng();
  let alpha = Boolean(image.hasAlpha || image.channels === 4 || image.channels === 2);
  if (requestedColor === 0 || requestedColor === 2 || coder === "png24" || coder === "png48" || options.forceOpaque) alpha = false;
  else if (!alpha) {
    for (let offset = 0; offset < width * height * 4 && !alpha; offset += 4096) {
      const bytes = await read(position + offset, Math.min(4096, width * height * 4 - offset));
      for (let index = 3; index < bytes.length; index += 4) if (bytes[index]! < 255) {alpha = true; break;}
    }
  }
  if (requestedColor === 4 || requestedColor === 6 || coder === "png32" || coder === "png64") alpha = true;
  const gray = !coder && requestedColor !== 2 && requestedColor !== 3 && requestedColor !== 6 && (image.space === "b-w" || image.channels === 1 || image.channels === 2);
  const channels = gray ? alpha ? [0,3] : [0] : alpha ? [0,1,2,3] : [0,1,2];
  const monochrome = !coder && options.pngBitDepth === 1 && gray && !alpha && !palette;
  if (!coder && options.pngBitDepth === 1 && !monochrome) throw new Error("1-bit PNG requires grayscale without alpha");
  const sampleBytes = monochrome ? 1 : palette ? 1 : !coder && options.pngBitDepth ? options.pngBitDepth / 8 : coder === "png48" || coder === "png64" || (!coder && image.storedData16 && !(gray && !alpha && (image.depth === "uchar" || image.depth === "bit"))) ? 2 : 1;
  let exactPalette = options.palette && !options.forceOpaque && !options.pngCoder && options.pngBitDepth === undefined && requestedColor === undefined && !options.pngBitDepth && !gray && sampleBytes === 1 ? new PngPalette() : undefined;
  if (options.pngPreserveColormap && !options.forceOpaque && image.pngPalette && !coder && requestedColor === undefined && !options.pngBitDepth && sampleBytes === 1) exactPalette = new PngPalette(image.pngPalette);
  for (let offset = 0; exactPalette && offset < width * height * 4; offset += 4096) {
    if (!exactPalette.add(await read(position + offset, Math.min(4096, width * height * 4 - offset)))) exactPalette = undefined;
  }
  let grayDepth = monochrome ? 1 : 8;
  if (gray && !alpha && !palette && !exactPalette && !coder && options.pngBitDepth === undefined && sampleBytes === 1) {
    grayDepth = 1;
    for (let offset = 0; offset < width * height * 4 && grayDepth < 8; offset += 4096) {
      const bytes = await read(position + offset, Math.min(4096, width * height * 4 - offset));
      for (let i = 0; i < bytes.length && grayDepth < 8; i += 4) {
        while (bytes[i]! % (255 / (2 ** grayDepth - 1)) !== 0) grayDepth *= 2;
      }
    }
  }
  const packedGray = grayDepth < 8;
  const source16 = sampleBytes === 2 ? image.storedData16 : undefined;
  const sourceBytes = source16 ? 2 : 1;
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0,width); view.setUint32(4,height); header[8] = exactPalette?.depth ?? (packedGray ? grayDepth : sampleBytes * 8); header[9] = exactPalette || palette ? 3 : gray ? alpha ? 4 : 0 : alpha ? 6 : 2;
  header[12] = options.pngInterlace ? 1 : 0;
  yield new Uint8Array(PNG_SIGNATURE);
  signal.throwIfAborted(); yield makeChunk("IHDR",header);
  if (image.gamma !== undefined) yield gammaChunk(image.gamma);
  if (image.icc) {
    const chunk = iccChunk(image.icc);
    for (let offset = 0; offset < chunk.length; offset += 4096) {signal.throwIfAborted(); yield chunk.subarray(offset, offset + 4096);}
  }
  if (exactPalette) { yield makeChunk("PLTE", exactPalette.bytes); if (exactPalette.transparency) yield makeChunk("tRNS", exactPalette.transparency); }
  if (palette) { yield makeChunk("PLTE", pngPalette!.bytes); if (pngPalette!.transparency) yield makeChunk("tRNS", pngPalette!.transparency); }
  const density = options.density ?? image.density ?? 72;
  const resolution = options.density === undefined ? image.resolution : undefined;
  const scale = resolution?.unit === "inch" ? 1 / 0.0254 : resolution?.unit === "cm" ? 100 : 1;
  const physical = new Uint8Array(9), physicalView = new DataView(physical.buffer);
  // setUint32 truncates fractional pixels per meter, matching ImageMagick.
  physicalView.setUint32(0,resolution ? resolution.x * scale : density / 0.0254); physicalView.setUint32(4,resolution ? resolution.y * scale : density / 0.0254); physical[8] = resolution?.unit === "unknown" ? 0 : 1;
  if (!options.omitPngResolution && (resolution !== undefined || options.density !== undefined)) {signal.throwIfAborted(); yield makeChunk("pHYs",physical);}
  if (image.virtualCanvas !== undefined && (image.virtualCanvas.width !== image.width || image.virtualCanvas.height !== image.height || image.virtualCanvas.x !== 0 || image.virtualCanvas.y !== 0)) {signal.throwIfAborted(); yield canvasChunk(image.virtualCanvas);}
  for (const chunk of textChunks(image.properties)) {
    for (let offset = 0; offset < chunk.length; offset += 4096) {signal.throwIfAborted(); yield chunk.subarray(offset, offset + 4096);}
  }
  if (image.xmp) {
    const chunk = xmpChunk(image.xmp);
    for (let offset = 0; offset < chunk.length; offset += 4096) {signal.throwIfAborted(); yield chunk.subarray(offset, offset + 4096);}
  }
  const orientation = options.orientation ?? image.orientation;
  if (image.exif || (options.synthesizeExif !== false && orientation !== undefined)) {
    const chunk = makeChunk("eXIf",buildExifApp1Segment({exif:image.exif,orientation,density,resolution}).subarray(6));
    for (let offset = 0; offset < chunk.length; offset += 4096) {signal.throwIfAborted(); yield chunk.subarray(offset, offset + 4096);}
  } else if (orientation !== undefined) {
    signal.throwIfAborted();
    yield makeChunk("orNT", Uint8Array.of(orientation));
  }
  const encoder = createByteCodec({direction:"encode",format:"zlib",chunkSize:4084,level:Math.max(0,Math.min(9,options.compressionLevel ?? 6))});
  try {
    const passes = options.pngInterlace ? ADAM7_PASSES : [[0, 0, 1, 1] as const];
    for (const [x0, y0, dx, dy] of passes) {
      const passWidth = Math.max(0, Math.ceil((width - x0) / dx));
      if (!passWidth) continue;
      for (let y=y0;y<height;y+=dy) {
        signal.throwIfAborted();
        for (const bytes of encoder.push(Uint8Array.of(exactPalette || packedGray ? 0 : 1))) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
        const previous = new Uint8Array(channels.length * sampleBytes);
        const chunkPixels = 1024 / sampleBytes / dx;
        for (let x=0;x<passWidth;x+=chunkPixels) {
          const count = Math.min(chunkPixels,passWidth-x);
          const span = await read((source16?.position ?? position) + (y * width + x0 + x * dx) * 4 * sourceBytes, ((count - 1) * dx + 1) * 4 * sourceBytes);
          const pixels = dx === 1 ? span : new Uint8Array(count * 4 * sourceBytes);
          if (dx !== 1) for (let i = 0; i < count; i++) pixels.set(span.subarray(i * dx * 4 * sourceBytes, (i * dx + 1) * 4 * sourceBytes), i * 4 * sourceBytes);
          if (exactPalette) {
            const original = image.storedPngIndices;
            const indexSpan = original && original.width === width && original.height === height ? await read(original.position + y * width + x0 + x * dx, (count - 1) * dx + 1) : undefined;
            const indices = indexSpan && dx !== 1 ? Uint8Array.from({length: count}, (_, i) => indexSpan[i * dx]!) : indexSpan;
            for (const bytes of encoder.push(exactPalette.pack(pixels, indices))) {signal.throwIfAborted(); yield makeChunk("IDAT", bytes);}
            continue;
          }
          if (packedGray) {
            const raw = new Uint8Array(Math.ceil(count * grayDepth / 8));
            for (let i = 0; i < count; i++) {
              const value = Math.round(pixels[i * 4]! * (2 ** grayDepth - 1) / 255);
              raw[(i * grayDepth) >> 3]! |= value << (8 - grayDepth - i * grayDepth % 8);
            }
            for (const bytes of encoder.push(raw)) {signal.throwIfAborted(); yield makeChunk("IDAT", bytes);}
            continue;
          }
          const samples16 = source16 ? new Uint16Array(pixels.buffer, pixels.byteOffset, pixels.length / 2) : undefined;
          const raw = new Uint8Array(palette ? count : count * channels.length * sampleBytes);
          if (palette) {
            for (let index = 0; index < count; index++) {
              const value = pngPalette!.indices[palette.index(pixels[index * 4]!, pixels[index * 4 + 1]!, pixels[index * 4 + 2]!, pixels[index * 4 + 3]!)]!;
              raw[index] = (value - previous[0]!) & 255;
              previous[0] = value;
            }
          } else
          for(let index=0;index<count;index++) for(let channel=0;channel<channels.length;channel++) {
            const value=(samples16 ?? pixels)[index*4+channels[channel]!]! * (!samples16 && sampleBytes === 2 ? 257 : 1);
            for (let byte=0;byte<sampleBytes;byte++) {
              const offset = channel * sampleBytes + byte;
              const part = (value >>> ((sampleBytes - byte - 1) * 8)) & 255;
              raw[index*channels.length*sampleBytes+offset]=(part-previous[offset]!)&255;
              previous[offset]=part;
            }
          }
          for (const bytes of encoder.push(raw)) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
        }
      }
    }
    for(const bytes of encoder.push(new Uint8Array(),true)) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
  } finally {encoder.close();}
  signal.throwIfAborted(); yield makeChunk("IEND",new Uint8Array());
}
