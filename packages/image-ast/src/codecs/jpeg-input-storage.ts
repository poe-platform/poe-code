import { readJpegFrame } from "./jpeg-frame.js";
import { JpegTables } from "./jpeg-tables.js";
import { jpegColor } from "./jpeg-color.js";
import { defaultRuntime } from "@poe-code/compression";
import type { ImageMetadata, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { isJpegBytes, idct8x8, idctScaledBlock } from "./jpeg.js";
import { applyJpegMetadata, type JpegMetadataState } from "./jpeg-metadata.js";
import { createJpegScan, type JpegComponentState } from "./jpeg-decode-kernel.js";

/** A block consumes at most 1986 wire bytes, including malformed spectral bands. */
class EntropyWindow {
  private pages = new Map<number, Uint8Array>();
  private work = 0;
  constructor(
    private readonly source: ImageByteSource,
    private readonly signal: AbortSignal
  ) {}
  async prepare(position: number) {
    this.signal.throwIfAborted();
    if (++this.work % 256 === 0) await defaultRuntime.yieldTurn(this.signal);
    const first = Math.floor(position / 4096);
    for (const key of this.pages.keys()) if (key < first || key > first + 1) this.pages.delete(key);
    for (let key = first; key <= first + 1 && key * 4096 < this.source.size; key++)
      if (!this.pages.has(key)) {
        const length = Math.min(4096, this.source.size - key * 4096),
          bytes = await this.source.read(key * 4096, length, { signal: this.signal });
        this.signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || bytes.length !== length)
          throw new Error("Truncated JPEG source");
        this.pages.set(key, new Uint8Array(bytes));
      }
  }
  at(position: number): number | undefined {
    if (position >= this.source.size) return undefined;
    const page = this.pages.get(Math.floor(position / 4096));
    if (!page) throw new Error("JPEG block exceeded prepared source window");
    return page[position % 4096];
  }
}
interface CachedPage {
  position: number;
  bytes: Uint8Array;
  dirty: boolean;
}
/** One cache for every component and output plane, independent of image dimensions. */
class BackingCache {
  private pages = new Map<string, CachedPage>();
  private work = 0;
  constructor(
    private readonly storage: ImageByteStorage,
    private readonly signal: AbortSignal
  ) {}
  async checkpoint() {
    this.signal.throwIfAborted();
    if (++this.work % 16384 === 0) await defaultRuntime.yieldTurn(this.signal);
  }
  private async write(page: CachedPage) {
    if (page.dirty) {
      this.signal.throwIfAborted();
      await this.storage.write(page.position, page.bytes, { signal: this.signal });
      this.signal.throwIfAborted();
      page.dirty = false;
    }
  }
  async allocate(length: number): Promise<Region> {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0)
      throw new RangeError("Invalid JPEG backing length");
    const position = this.storage.allocate(length);
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + length))
      throw new RangeError("Invalid JPEG backing allocation");
    const zeros = new Uint8Array(Math.min(4096, length));
    for (let offset = 0; offset < length; offset += 4096) {
      this.signal.throwIfAborted();
      if (offset % 65536 === 0) await defaultRuntime.yieldTurn(this.signal);
      await this.storage.write(
        position + offset,
        zeros.subarray(0, Math.min(4096, length - offset)),
        { signal: this.signal }
      );
      this.signal.throwIfAborted();
    }
    return new Region(position, length, this);
  }
  async page(region: Region, offset: number): Promise<CachedPage> {
    await this.checkpoint();
    const index = Math.floor(offset / 4096),
      key = region.position + ":" + index;
    let page = this.pages.get(key);
    if (!page) {
      if (this.pages.size === 32) {
        const [oldKey, old] = this.pages.entries().next().value!;
        await this.write(old);
        this.pages.delete(oldKey);
      }
      const length = Math.min(4096, region.length - index * 4096),
        position = region.position + index * 4096;
      const bytes = await this.storage.read(position, length, { signal: this.signal });
      this.signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array) || bytes.length !== length)
        throw new Error("Truncated JPEG backing storage");
      page = { position, bytes: new Uint8Array(bytes), dirty: false };
      this.pages.set(key, page);
    }
    return page;
  }
  async flush() {
    for (const page of this.pages.values()) await this.write(page);
  }
}
class Region {
  constructor(
    readonly position: number,
    readonly length: number,
    private readonly cache: BackingCache
  ) {}
  async at(offset: number): Promise<number> {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.length) return NaN;
    return (await this.cache.page(this, offset)).bytes[offset % 4096]!;
  }
  async set(offset: number, value: number) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.length) return;
    const page = await this.cache.page(this, offset);
    page.bytes[offset % 4096] = value;
    page.dirty = true;
  }
  /** Own bounded spans; never retain a borrowed backing page across cache I/O. */
  async read(offset: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(Number.isInteger(offset) && offset >= 0
      ? Math.max(0, Math.min(length, this.length - offset)) : 0);
    for (let used = 0; used < bytes.length;) {
      const page = await this.cache.page(this, offset + used);
      const local = (offset + used) % 4096;
      const count = Math.min(bytes.length - used, page.bytes.length - local);
      bytes.set(page.bytes.subarray(local, local + count), used);
      used += count;
    }
    return bytes;
  }
  async write(offset: number, bytes: Uint8Array): Promise<void> {
    for (let used = 0; used < bytes.length;) {
      const page = await this.cache.page(this, offset + used);
      const local = (offset + used) % 4096;
      const count = Math.min(bytes.length - used, page.bytes.length - local);
      page.bytes.set(bytes.subarray(used, used + count), local);
      page.dirty = true;
      used += count;
    }
  }
  async coefficients(offset: number) {
    const block = new Int16Array(Math.max(0, Math.min(64, (this.length - offset) / 2)));
    for (let i = 0; i < block.length; i++)
      block[i] = (await this.at(offset + i * 2)) | ((await this.at(offset + i * 2 + 1)) << 8);
    return block;
  }
  async storeCoefficients(offset: number, block: Int16Array) {
    for (let i = 0; i < block.length; i++) {
      await this.set(offset + i * 2, block[i]! & 255);
      await this.set(offset + i * 2 + 1, block[i]! >>> 8);
    }
  }
}
interface StoredComponent extends JpegComponentState {
  id: number;
  h: number;
  v: number;
  qId: number;
  blocksX: number;
  blocksY: number;
  blocksFlat?: Region;
  pixels?: Region;
  stripPixels?: Region;
}
async function payloadBytes(reader: SourceBytes, start: number, length: number) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (await reader.at(start + i))!;
  return bytes;
}
export async function readJpegMetadataFromSource(source:ImageByteSource,signal:AbortSignal):Promise<ImageMetadata> {
  signal.throwIfAborted();
  const reader=new SourceBytes(source,signal,"JPEG");
  if (!isJpegBytes(await payloadBytes(reader, 0, Math.min(3, source.size))))
    throw new Error("Invalid JPEG signature");
  const state: JpegMetadataState = {
    width: 0,
    height: 0,
    channels: 3,
    isProgressive: false,
    density: 72,
    orientation: undefined
  };
  for (let position = 2; position + 4 <= source.size; ) {
    if ((await reader.at(position)) !== 255) {
      position++;
      continue;
    }
    while (position < source.size && (await reader.at(position)) === 255) position++;
    if (position >= source.size) break;
    const marker = (await reader.at(position++))!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 1) {
      if (marker === 0xd9) break;
      continue;
    }
    if (position + 2 > source.size) break;
    const length = ((await reader.at(position))! << 8) | (await reader.at(position + 1))!;
    if (length < 2 || position + length > source.size) break;
    if (
      marker === 0xe0 ||
      marker === 0xe1 ||
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2
    ) {
      const payload = await payloadBytes(
        reader,
        position + 2,
        Math.min(length - 2, marker === 0xe0 ? 12 : marker === 0xe1 ? 65533 : 6)
      );
      if (applyJpegMetadata(state, marker, payload)) break;
    }
    position += length;
  }
  signal.throwIfAborted();
  const { width, height, channels, isProgressive, density, orientation } = state;
  if (width <= 0 || height <= 0) throw new Error("Invalid JPEG dimensions");
  return {
    format: "jpeg",
    width,
    height,
    space: channels === 1 ? "b-w" : channels === 4 ? "cmyk" : "srgb",
    channels,
    depth: "uchar",
    density,
    hasAlpha: false,
    ...(orientation === undefined ? {} : { orientation }),
    isProgressive,
    size: source.size
  };
}
export async function decodeJpegToStorage(
  source: ImageByteSource,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: SharpInputOptions
): Promise<StoredRgbaImage> {
  const scratchCoeffs = new Int32Array(64);
  const reader = new SourceBytes(source, signal, "JPEG"),
    window = new EntropyWindow(source, signal),
    cache = new BackingCache(storage, signal);
  const meta = await readJpegMetadataFromSource(source, signal);
  checkLimitInputPixels(meta.width, meta.height, options);

  const tables = new JpegTables();
  const { quantTables, dcTrees, acTrees } = tables;

  let width = 0;
  let height = 0;
  let scaleDenom: 1 | 2 | 4 = 1;
  let blockStep: 8 | 4 | 2 = 8;
  let outWidth = 0;
  let outHeight = 0;
  let useStripDecode = false;
  let outRgba: Region | undefined;
  let maxH = 1;
  let maxV = 1;
  let mcusX = 0;
  let mcusY = 0;
  const components: StoredComponent[] = [];

  let pos = 2;
  while (pos + 2 <= source.size) {
    if ((await reader.at(pos)) !== 0xff) {
      pos++;
      continue;
    }
    while (pos < source.size && (await reader.at(pos)) === 0xff) pos++;
    if (pos >= source.size) break;
    const marker = (await reader.at(pos))!;
    pos++;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (pos + 2 > source.size) break;
    const segLen = ((await reader.at(pos))! << 8) | (await reader.at(pos + 1))!;
    if (segLen < 2 || pos + segLen > source.size) break;
    if (![0xdb, 0xc4, 0xdd, 0xc0, 0xc1, 0xc2, 0xda].includes(marker)) {
      pos += segLen;
      continue;
    }
    const payload = await payloadBytes(reader, pos + 2, segLen - 2);

    if (tables.read(marker, payload)) {
      pos += segLen;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const frame = readJpegFrame(
        payload,
        meta.isProgressive ?? false,
        options,
        scaleDenom,
        blockStep
      );
      ({
        width,
        height,
        outWidth,
        outHeight,
        maxH,
        maxV,
        mcusX,
        mcusY,
        useStripDecode,
        scaleDenom,
        blockStep
      } = frame);
      components.length = 0;
      components.push(...frame.components);
      checkLimitInputPixels(width, height, options);
      for (const comp of components) {
        comp.blocksX = mcusX * comp.h;
        comp.blocksY = mcusY * comp.v;
        if (meta.isProgressive) {
          comp.blocksFlat = await cache.allocate(comp.blocksX * comp.blocksY * 128);
        } else if (useStripDecode) {
          comp.stripPixels = await cache.allocate(comp.blocksX * blockStep * comp.v * blockStep);
        } else {
          comp.pixels = await cache.allocate(comp.blocksX * blockStep * comp.blocksY * blockStep);
        }
      }
    } else if (marker === 0xda) {
      // SOS
      const scanCompsCount = payload[0]!;
      const scanComps: StoredComponent[] = [];
      for (let i = 0; i < scanCompsCount; i++) {
        const compId = payload[1 + i * 2]!;
        const tdta = payload[1 + i * 2 + 1]!;
        const comp = components.find((c) => c.id === compId);
        if (!comp) throw new Error("Unknown JPEG scan component");
        comp.dcId = tdta >>> 4;
        comp.acId = tdta & 0x0f;
        scanComps.push(comp);
      }
      if (!meta.isProgressive && scanCompsCount < components.length) {
        useStripDecode = false;
        for (const comp of components) {
          if (!comp.pixels) {
            comp.pixels = await cache.allocate(comp.blocksX * blockStep * comp.blocksY * blockStep);
          }
        }
      }
      if (useStripDecode && !outRgba) {
        outRgba = await cache.allocate(outWidth * outHeight * 4);
      }
      const ssPos = 1 + scanCompsCount * 2;
      const spectralStart = payload[ssPos] ?? 0;
      const spectralEnd = payload[ssPos + 1] ?? 63;
      const ahAl = payload[ssPos + 2] ?? 0;
      const approxHigh = ahAl >>> 4;
      const approxLow = ahAl & 0x0f;

      // Decode entropy-coded data starting after SOS segment
      const scan = createJpegScan(
        (position) => window.at(position),
        source.size,
        pos + segLen,
        dcTrees,
        acTrees,
        spectralStart,
        spectralEnd,
        approxHigh,
        approxLow
      );
      const blockOut = new Uint8Array(64);
      const decodeAndStoreBaselineBlock = async (
        comp: StoredComponent,
        bx: number,
        by: number,
        stripVy: number
      ): Promise<void> => {
        await window.prepare(scan.position);
        const maxK = scan.decodeBaseline(comp, scratchCoeffs);
        const quant = quantTables[comp.qId];
        if (!quant) throw new Error("Missing JPEG quantization table");
        idctScaledBlock(scratchCoeffs, quant, blockOut, maxK, blockStep);
        const stride = comp.blocksX * blockStep;
        const dst = useStripDecode ? comp.stripPixels! : comp.pixels!;
        const baseRow = (useStripDecode ? stripVy : by) * blockStep;
        const baseCol = bx * blockStep;
        for (let y = 0; y < blockStep; y++) {
          const dstOff = (baseRow + y) * stride + baseCol;
          const srcOff = y * blockStep;
          await dst.write(dstOff, blockOut.subarray(srcOff, srcOff + blockStep));
        }
      };

      let mcuCounter = 0;
      let restartCounter = 0;
      const consumeRestart = async (): Promise<void> => {
        let scanPos = scan.position;
        if ((await reader.at(scanPos++)) !== 0xff) throw new Error("Missing JPEG restart marker");
        while ((await reader.at(scanPos)) === 0xff) scanPos++;
        if ((await reader.at(scanPos++)) !== 0xd0 + (restartCounter % 8))
          throw new Error("Invalid JPEG restart sequence");
        restartCounter++;
        for (const comp of scanComps) comp.dcPred = 0;
        scan.restart(scanPos);
      };
      if (
        scanComps.length === 1 &&
        (spectralStart > 0 || (scanCompsCount === 1 && components.length > 1))
      ) {
        const comp = scanComps[0]!;
        const blocksCols = Math.ceil(width / (8 * (maxH / comp.h)));
        const blocksRows = Math.ceil(height / (8 * (maxV / comp.v)));
        for (let by = 0; by < blocksRows; by++) {
          for (let bx = 0; bx < blocksCols; bx++) {
            if (
              tables.restartInterval > 0 &&
              mcuCounter > 0 &&
              mcuCounter % tables.restartInterval === 0
            ) {
              await consumeRestart();
            }
            if (meta.isProgressive) {
              const off = (by * comp.blocksX + bx) * 64;
              await window.prepare(scan.position);
              const block = await comp.blocksFlat!.coefficients(off * 2);
              scan.decodeProgressive(comp, block);
              await comp.blocksFlat!.storeCoefficients(off * 2, block);
            } else {
              await decodeAndStoreBaselineBlock(comp, bx, by, by % comp.v);
            }
            mcuCounter++;
          }
        }
      } else {
        const mcuRowH = maxV * blockStep;
        for (let my = 0; my < mcusY; my++) {
          for (let mx = 0; mx < mcusX; mx++) {
            if (
              tables.restartInterval > 0 &&
              mcuCounter > 0 &&
              mcuCounter % tables.restartInterval === 0
            ) {
              await consumeRestart();
            }
            for (const comp of scanComps) {
              for (let vy = 0; vy < comp.v; vy++) {
                for (let hx = 0; hx < comp.h; hx++) {
                  const bx = mx * comp.h + hx;
                  const by = my * comp.v + vy;
                  if (meta.isProgressive) {
                    const off = (by * comp.blocksX + bx) * 64;
                    await window.prepare(scan.position);
                    const block = await comp.blocksFlat!.coefficients(off * 2);
                    scan.decodeProgressive(comp, block);
                    await comp.blocksFlat!.storeCoefficients(off * 2, block);
                  } else {
                    await decodeAndStoreBaselineBlock(comp, bx, by, vy);
                  }
                }
              }
            }
            mcuCounter++;
          }
          if (useStripDecode && outRgba) {
            const yStart = my * mcuRowH;
            const yEnd = Math.min(outHeight, yStart + mcuRowH);
            // Convert at most 1024 pixels per span. Plane bytes are owned before
            // another cache read can evict them; no per-pixel Promise allocation.
            const row = new Uint8Array(4096);
            const count = components.length === 1 ? 1 : components.length === 4 ? 4 : components.length >= 3 ? 3 : 0;
            let work = 0;
            for (let y = yStart; y < yEnd; y++) {
              const ly = y - yStart;
              for (let xStart = 0; xStart < outWidth; xStart += 1024) {
                const xEnd = Math.min(outWidth, xStart + 1024);
                const planes: { bytes: Uint8Array; start: number; h: number }[] = [];
                for (let plane = 0; plane < count; plane++) {
                  const comp = components[plane]!;
                  const start = comp.h === maxH ? xStart : Math.floor(xStart * comp.h / maxH);
                  const end = comp.h === maxH ? xEnd - 1 : Math.floor((xEnd - 1) * comp.h / maxH);
                  const rowIndex = comp.v === maxV ? ly : Math.floor(ly * comp.v / maxV);
                  planes.push({ bytes: await comp.stripPixels!.read(rowIndex * comp.blocksX * blockStep + start, end - start + 1), start, h: comp.h });
                }
                const sample = (plane: number, x: number) => {
                  const entry = planes[plane]!;
                  return entry.bytes[(entry.h === maxH ? x : Math.floor(x * entry.h / maxH)) - entry.start] ?? NaN;
                };
                for (let x = xStart; x < xEnd; x++) {
                  const at = (x - xStart) * 4;
                  if (components.length === 1) {
                    const g = sample(0, x);
                    row[at] = g; row[at + 1] = g; row[at + 2] = g;
                  } else if (components.length >= 3) {
                    const rgb = jpegColor(sample(0, x), sample(1, x) - 128, sample(2, x) - 128, components.length === 4 ? sample(3, x) : undefined, true);
                    row[at] = rgb & 255; row[at + 1] = (rgb >>> 8) & 255; row[at + 2] = rgb >>> 16;
                  }
                  row[at + 3] = 255;
                }
                if (components.length === 1 || components.length >= 3)
                  await outRgba.write((y * outWidth + xStart) * 4, row.subarray(0, (xEnd - xStart) * 4));
                work += xEnd - xStart;
                if (work >= 16384) { await defaultRuntime.yieldTurn(signal); work = 0; }
              }
            }
          }
        }
      }

      pos = scan.position;
      continue;
    }
    pos += segLen;
  }

  if (useStripDecode && outRgba) {
    await cache.flush();
    return {
      width: outWidth,
      height: outHeight,
      position: outRgba.position,
      format: "jpeg",
      space: meta.space,
      channels: meta.channels,
      depth: "uchar",
      density: meta.density,
      hasAlpha: false,
      ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
      ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
    };
  }

  const compPixels = [];
  for (const comp of components) {
    if (!meta.isProgressive && comp.pixels) {
      compPixels.push({ comp, pixels: comp.pixels, stride: comp.blocksX * blockStep });
      continue;
    }
    const pixels = await cache.allocate(comp.blocksX * 8 * comp.blocksY * 8);
    const blockOut = new Uint8Array(64);
    const quant = quantTables[comp.qId];
    if (!quant) throw new Error("Missing JPEG quantization table");
    const blocksFlat = comp.blocksFlat!;
    for (let by = 0; by < comp.blocksY; by++) {
      for (let bx = 0; bx < comp.blocksX; bx++) {
        const off = (by * comp.blocksX + bx) * 64;
        idct8x8(await blocksFlat.coefficients(off * 2), quant, blockOut, 63);
        for (let y = 0; y < 8; y++) {
          const dstOffset = (by * 8 + y) * (comp.blocksX * 8) + bx * 8;
          for (let x = 0; x < 8; x++) {
            await pixels.set(dstOffset + x, blockOut[y * 8 + x]!);
          }
        }
      }
    }
    compPixels.push({ comp, pixels, stride: comp.blocksX * 8 });
  }

  const samplePlane = async (
    plane: { readonly comp: StoredComponent; readonly pixels: Region; readonly stride: number },
    x: number,
    y: number
  ): Promise<number> => {
    const h = plane.comp.h;
    const v = plane.comp.v;
    if (h === maxH && v === maxV) {
      return await plane.pixels.at(y * plane.stride + x);
    }
    const maxCx = Math.max(0, Math.ceil((width * h) / maxH) - 1);
    const maxCy = Math.max(0, Math.ceil((height * v) / maxV) - 1);
    const sx = ((x + 0.5) * h) / maxH - 0.5;
    const sy = ((y + 0.5) * v) / maxV - 0.5;
    const rawX0 = Math.floor(sx);
    const rawY0 = Math.floor(sy);
    const x0 = Math.max(0, Math.min(maxCx, rawX0));
    const x1 = Math.max(0, Math.min(maxCx, rawX0 + 1));
    const y0 = Math.max(0, Math.min(maxCy, rawY0));
    const y1 = Math.max(0, Math.min(maxCy, rawY0 + 1));
    const fx = Math.max(0, Math.min(1, sx - rawX0));
    const fy = Math.max(0, Math.min(1, sy - rawY0));
    const p00 = await plane.pixels.at(y0 * plane.stride + x0);
    const p10 = await plane.pixels.at(y0 * plane.stride + x1);
    const p01 = await plane.pixels.at(y1 * plane.stride + x0);
    const p11 = await plane.pixels.at(y1 * plane.stride + x1);
    const top = p00 + (p10 - p00) * fx;
    const bot = p01 + (p11 - p01) * fx;
    return top + (bot - top) * fy;
  };

  const rgba = await cache.allocate(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;
      if (compPixels.length === 1) {
        const c0 = compPixels[0]!;
        const g = await c0.pixels.at(y * c0.stride + x);
        await rgba.set(outIdx, g);
        await rgba.set(outIdx + 1, g);
        await rgba.set(outIdx + 2, g);
        await rgba.set(outIdx + 3, 255);
      } else if (compPixels.length >= 3) {
        const cY = compPixels[0]!;
        const cCb = compPixels[1]!;
        const cCr = compPixels[2]!;
        const yVal = await samplePlane(cY, x, y);
        const cbVal = (await samplePlane(cCb, x, y)) - 128;
        const crVal = (await samplePlane(cCr, x, y)) - 128;

        const cK = compPixels.length === 4 ? compPixels[3] : undefined;
        const kVal = cK
          ? await cK.pixels.at(
              Math.floor((y * cK.comp.v) / maxV) * cK.stride + Math.floor((x * cK.comp.h) / maxH)
            )
          : undefined;
        const rgb = jpegColor(yVal, cbVal, crVal, kVal, false);
        await rgba.set(outIdx, rgb & 255);
        await rgba.set(outIdx + 1, (rgb >>> 8) & 255);
        await rgba.set(outIdx + 2, rgb >>> 16);
        await rgba.set(outIdx + 3, 255);
      }
    }
  }

  await cache.flush();
  return {
    width,
    height,
    position: rgba.position,
    format: "jpeg",
    space: meta.space,
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: false,
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
    ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
  };
}
