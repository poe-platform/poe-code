import {pngMetadataSteps} from "./png-metadata.js";
import {exifMetadataSteps} from "./exif-metadata.js";
import {PNG_SIGNATURE, makeChunk} from "./png-chunks.js";
import {buildExifApp1Segment} from "./exif.js";
import {createByteCodec, defaultRuntime} from "@poe-code/compression";
import {checkLimitInputPixels} from "../limits.js";
import type {RgbaImage, SharpInputOptions} from "../ast.js";
import {isPngBytes, readPngMetadata, type encodePngImage} from "./png.js";
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
export interface StoredRgbaImage extends Omit<RgbaImage, "data" | "data16"> {
  readonly position: number;
  /** Frame delays can remain in caller storage instead of an unbounded metadata array. */
  readonly storedDelay?: {
    readonly length: number;
    at(index: number, options?: {readonly signal?: AbortSignal}): Promise<number | undefined>;
  };
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
    yield {name, start, length};
    if (name === "IEND") return;
    position = start + length + 4;
  }
}

async function exif(source:ImageByteSource,start:number,length:number,signal:AbortSignal) {
  const steps=exifMetadataSteps(length,start);let next=steps.next(),work=0;
  while(!next.done) {
    if(++work%64===0)await defaultRuntime.yieldTurn(signal);
    next=steps.next(await range(source,next.value.position,next.value.length,signal));
  }
  return next.value;
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
  let density = 72, orientation: number | undefined;
  for await (const chunk of chunks(source, signal)) {
    if (chunk.name === "IHDR" && chunk.length >= 13) header = await range(source, chunk.start, 13, signal);
    else if (chunk.name === "PLTE") palette = await range(source, chunk.start, Math.min(chunk.length, 768), signal);
    else if (chunk.name === "tRNS") transparency = await range(source, chunk.start, Math.min(chunk.length, 256), signal);
    else if (chunk.name === "pHYs" && chunk.length >= 9) {
      const data = await range(source, chunk.start, 9, signal); const x = new DataView(data.buffer).getUint32(0);
      if (x > 0) density = data[8] === 1 ? Math.max(1, Math.round(x * 0.0254)) : x;
    } else if (chunk.name === "eXIf") {
      const metadata = await exif(source, chunk.start, chunk.length, signal);
      density = metadata.density ?? density; orientation = metadata.orientation ?? orientation;
    }
  }
  if (!header) throw new Error("Invalid PNG header");
  // Reuse the buffered metadata policy with a bounded synthetic header; payloads
  // and ancillary chunks remain in the caller's source.
  const metadataBytes = new Uint8Array(transparency ? 45 : 33);
  metadataBytes.set([137,80,78,71,13,10,26,10]);
  metadataBytes.set([0,0,0,13,73,72,68,82], 8); metadataBytes.set(header, 16);
  if (transparency) metadataBytes.set([0,0,0,0,116,82,78,83], 33);
  const {size: ignoredSize, ...metadata} = readPngMetadata(metadataBytes);
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
        for (let x = 0; x < w; x += 128) {
          const count = Math.min(128, w - x);
          const data = await readStorage(rawPosition + y * rowBytes + x * bits / 8, Math.ceil(count * bits / 8));
          const target = position + ((y0 + y * dy) * width + x0 + x * dx) * 4;
          const output = dx === 1 ? new Uint8Array(count * 4) : await readStorage(target, ((count - 1) * dx + 1) * 4);
          for (let index = 0; index < count; index++) writePngPixel(data, 0, index, index * dx * 4, output, depth, color, palette, transparency);
          await cooperate(); await storage.write(target, output, {signal});
        }
      }
    }
    // Drain the bounded decoder so trailing corruption and truncation retain
    // codec diagnostics even after all expected pixels have been produced.
    while (!(await iterator.next()).done) signal.throwIfAborted();
  } finally {await iterator.return(undefined);}
  return {...metadata, position, density, ...(orientation === undefined ? {} : {orientation}), space: color === 0 && transparency ? "srgb" : metadata.space, channels: color === 0 && transparency ? 4 : metadata.channels};
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
  let alpha = Boolean(image.hasAlpha || image.channels === 4 || image.channels === 2);
  if (options.forceOpaque) alpha = false;
  else if (!alpha) {
    for (let offset = 0; offset < width * height * 4 && !alpha; offset += 4096) {
      const bytes = await read(position + offset, Math.min(4096, width * height * 4 - offset));
      for (let index = 3; index < bytes.length; index += 4) if (bytes[index]! < 255) {alpha = true; break;}
    }
  }
  const gray = image.space === "b-w" || image.channels === 1 || image.channels === 2;
  const channels = gray ? alpha ? [0,3] : [0] : alpha ? [0,1,2,3] : [0,1,2];
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0,width); view.setUint32(4,height); header[8] = 8; header[9] = gray ? alpha ? 4 : 0 : alpha ? 6 : 2;
  yield new Uint8Array(PNG_SIGNATURE);
  signal.throwIfAborted(); yield makeChunk("IHDR",header);
  const density = options.density ?? image.density ?? 72;
  const physical = new Uint8Array(9), physicalView = new DataView(physical.buffer);
  physicalView.setUint32(0,Math.round(density / 0.0254)); physicalView.setUint32(4,Math.round(density / 0.0254)); physical[8] = 1;
  signal.throwIfAborted(); yield makeChunk("pHYs",physical);
  const orientation = options.orientation ?? image.orientation;
  if (orientation !== undefined) {signal.throwIfAborted(); yield makeChunk("eXIf",buildExifApp1Segment({orientation,density}).subarray(6));}
  const encoder = createByteCodec({direction:"encode",format:"zlib",chunkSize:4084,level:Math.max(0,Math.min(9,options.compressionLevel ?? 6))});
  try {
    for (let y=0;y<height;y++) {
      signal.throwIfAborted();
      for (const bytes of encoder.push(Uint8Array.of(1))) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
      const previous = new Uint8Array(channels.length);
      for (let x=0;x<width;x+=1024) {
        const count = Math.min(1024,width-x);
        const pixels = await read(position + (y * width + x) * 4,count * 4);
        const raw = new Uint8Array(count * channels.length);
        for(let index=0;index<count;index++) for(let channel=0;channel<channels.length;channel++) {
          const value=pixels[index*4+channels[channel]!]!;
          raw[index*channels.length+channel]=(value-previous[channel]!)&255;
          previous[channel]=value;
        }
        for (const bytes of encoder.push(raw)) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
      }
    }
    for(const bytes of encoder.push(new Uint8Array(),true)) {signal.throwIfAborted(); yield makeChunk("IDAT",bytes);}
  } finally {encoder.close();}
  signal.throwIfAborted(); yield makeChunk("IEND",new Uint8Array());
}
