import { parseStoredCffFont } from "./stored-cff.js";
import type { PdfPathSegment } from "../ast.js";
import type { StoredCidMap } from "./stored-cid-map.js";
import { PdfError } from "../errors.js";
import { MacStandardGlyphOrdering } from "../vendor/pdfjs-fonts.mjs";
import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";

interface Options extends PdfFontAllocationOptions {
  readonly signal?: AbortSignal;
}

/** Detached, fixed-size cache: backends may lend a buffer until the next call. */
class FontReader {
  private bytes = new Uint8Array();
  private start = -1;
  private calls = 0;
  constructor(
    readonly source: StoredCidMap,
    readonly signal?: AbortSignal
  ) {}
  async unsigned(at: number, length: number): Promise<number> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(at) || at < 0 || at + length > this.source.byteLength)
      throw new RangeError("Offset is outside the bounds of the DataView");
    if (++this.calls % 4096 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.signal?.throwIfAborted();
    }
    if (at < this.start || at + length > this.start + this.bytes.length) {
      const size = Math.min(4096, this.source.byteLength - at);
      const bytes = await this.source.storage.read(
        this.source.position + at,
        size,
        this.signal ? { signal: this.signal } : undefined
      );
      this.signal?.throwIfAborted();
      if (bytes.length !== size) throw new PdfError("E_PARSE", "Incomplete TrueType font range");
      this.bytes = bytes.slice();
      this.start = at;
    }
    let value = 0;
    for (let i = 0; i < length; i++) value = value * 256 + this.bytes[at - this.start + i]!;
    return value;
  }
  async signed(at: number): Promise<number> {
    const value = await this.unsigned(at, 2);
    return value & 0x8000 ? value - 65536 : value;
  }
  async byte(at: number): Promise<number> {
    return at >= this.source.byteLength ? 0 : this.unsigned(at, 1);
  }
}

export interface StoredTrueTypeFont {
  readonly unitsPerEm: number;
  readonly hasCmap: boolean;
  readonly isSymbolicCmap: boolean;
  getGlyphId(codePoint: number): Promise<number>;
  getAdvanceWidthUnits(glyphId: number): Promise<number>;
  findGlyphName(name: string): Promise<number>;
  glyphSegments(glyphId: number): AsyncGenerator<PdfPathSegment>;
}

/** Rendering view of an sfnt font. Source, point scratch and output paths stay
 * in caller storage; only table descriptors and one input cache are resident.
 * CFF programs are handled by the CFF parser, not interpreted as glyf data. */
export async function parseStoredTrueTypeFont(
  source: StoredCidMap,
  options: Options = {}
): Promise<StoredTrueTypeFont | undefined> {
  options.signal?.throwIfAborted();
  const allocation = new PdfFontAllocation(options);
  // Cache replacement overlap, fixed table descriptors, and seven compound frames.
  allocation.admit(32768);
  const input = new FontReader(source, options.signal),
    u16 = (at: number) => input.unsigned(at, 2),
    u32 = (at: number) => input.unsigned(at, 4);
  if (source.byteLength < 12) throw new PdfError("E_PARSE", "TrueType font is too short");
  const version = await u32(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(version))
    throw new PdfError("E_PARSE", `Unsupported sfnt header signature: 0x${version.toString(16)}`);
  const tables = new Map<string, { offset: number; length: number }>();
  const count = await u16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (at + 16 > source.byteLength) break;
    let tag = "";
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(await input.byte(at + j));
    if (["head", "hhea", "maxp", "hmtx", "cmap", "post", "loca", "glyf", "CFF "].includes(tag))
      tables.set(tag, { offset: await u32(at + 8), length: await u32(at + 12) });
  }
  const head = tables.get("head"),
    hhea = tables.get("hhea"),
    maxp = tables.get("maxp"),
    hmtx = tables.get("hmtx");
  if (!head || !hhea || !maxp || !hmtx)
    throw new PdfError("E_PARSE", "TrueType font missing required tables (head/hhea/maxp/hmtx)");
  const cffTable = !tables.has("glyf") ? tables.get("CFF ") : undefined;
  if (cffTable && (cffTable.length === 0 || cffTable.offset + cffTable.length > source.byteLength))
    throw new PdfError("E_PARSE", "OpenType CFF table is outside the font program");
  const cff = cffTable
    ? await parseStoredCffFont(
        {
          storage: source.storage,
          position: source.position + cffTable.offset,
          byteLength: cffTable.length
        },
        undefined,
        new Map(),
        options
      )
    : undefined;
  const unitsPerEm = Math.max(1, await u16(head.offset + 18)),
    format = await input.signed(head.offset + 50);
  const numGlyphs = Math.max(1, await u16(maxp.offset + 4)),
    metrics = Math.max(1, await u16(hhea.offset + 34));
  const cmap = tables.get("cmap");
  let f4 = 0,
    f12 = 0,
    s4 = false,
    s12 = false;
  const cmapCount = cmap ? await u16(cmap.offset + 2) : 0;
  for (let i = 0; i < cmapCount; i++) {
    const at = cmap!.offset + 4 + i * 8;
    if (at + 8 > source.byteLength) break;
    const platform = await u16(at),
      encoding = await u16(at + 2),
      sub = cmap!.offset + (await u32(at + 4));
    if (sub + 4 > source.byteLength) continue;
    const kind = await u16(sub);
    if (kind === 12 && (platform === 3 || platform === 0)) {
      f12 = sub;
      s12 = platform === 3 && encoding === 0;
    } else if (kind === 4 && (platform === 3 || platform === 0)) {
      f4 = sub;
      s4 = platform === 3 && encoding === 0;
    }
  }
  let ranges = 0,
    ordered = true,
    previous = -1,
    endStart = 0,
    startStart = 0,
    deltaStart = 0,
    rangeStart = 0;
  if (f12)
    ranges = Math.min(
      await u32(f12 + 12),
      Math.max(0, Math.floor((source.byteLength - f12 - 16) / 12))
    );
  else if (f4) {
    const segments = (await u16(f4 + 6)) >> 1;
    endStart = f4 + 14;
    startStart = endStart + segments * 2 + 2;
    deltaStart = startStart + segments * 2;
    rangeStart = deltaStart + segments * 2;
    for (; ranges < segments; ranges++) {
      const end = await u16(endStart + ranges * 2),
        start = await u16(startStart + ranges * 2);
      if (start === 65535 && end === 65535) break;
      await u16(deltaStart + ranges * 2);
      await u16(rangeStart + ranges * 2);
    }
  }
  const start = (i: number) => (f12 ? u32(f12 + 16 + i * 12) : u16(startStart + i * 2));
  const end = async (i: number) =>
    f12 ? Math.min(await u32(f12 + 20 + i * 12), (await start(i)) + 65535) : u16(endStart + i * 2);
  for (let i = 0; i < ranges; i++) {
    const low = await start(i),
      high = await end(i);
    if (low <= previous || high < low) ordered = false;
    previous = high;
  }
  async function glyph(i: number, cp: number): Promise<number | undefined> {
    if (f12) return (await u32(f12 + 24 + i * 12)) + cp - (await start(i));
    const delta = await input.signed(deltaStart + i * 2),
      pos = rangeStart + i * 2,
      range = await u16(pos);
    let gid = 0;
    if (range === 0) gid = (cp + delta) & 65535;
    else {
      const at = pos + range + (cp - (await start(i))) * 2;
      if (at + 2 <= source.byteLength) {
        gid = await u16(at);
        if (gid) gid = (gid + delta) & 65535;
      }
    }
    return gid > 0 && gid < numGlyphs ? gid : undefined;
  }
  async function getGlyphId(cp: number): Promise<number> {
    if (!Number.isInteger(cp) || cp < 0) return 0;
    if (ordered) {
      let low = 0,
        high = ranges - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (cp < (await start(middle))) high = middle - 1;
        else if (cp > (await end(middle))) low = middle + 1;
        else return (await glyph(middle, cp)) ?? 0;
      }
    } else
      for (let i = ranges - 1; i >= 0; i--) {
        if (cp < (await start(i)) || cp > (await end(i))) continue;
        const gid = await glyph(i, cp);
        if (gid !== undefined) return gid;
      }
    return 0;
  }
  // Validate optional post names once. Store custom name offsets, never strings
  // or an index proportional to the font, in the caller's backing.
  const post = tables.get("post");
  let postVersion = 0,
    nameOffsets = -1,
    customCount = 0;
  if (post && post.offset + post.length <= source.byteLength && post.length >= 32) {
    postVersion = await u32(post.offset);
    if (postVersion === 0x00020000) {
      if (post.length < 34 + numGlyphs * 2 || (await u16(post.offset + 32)) !== numGlyphs)
        postVersion = 0;
      else {
        for (let i = 0; i < numGlyphs; i++)
          if ((await u16(post.offset + 34 + i * 2)) >= 32768) {
            postVersion = 0;
            break;
          }
        if (postVersion) {
          // uint16 glyph-name indices can address at most 32510 custom names.
          nameOffsets = source.storage.allocate(
            Math.min(32510, post.length - 34 - numGlyphs * 2) * 8
          );
          const record = new Uint8Array(8),
            view = new DataView(record.buffer);
          for (let at = post.offset + 34 + numGlyphs * 2; at < post.offset + post.length; ) {
            const length = await input.byte(at);
            if (at + 1 + length > post.offset + post.length) {
              postVersion = 0;
              break;
            }
            if (customCount < 32510) {
              view.setFloat64(0, at, true);
              await source.storage.write(
                nameOffsets + customCount * 8,
                record,
                options.signal ? { signal: options.signal } : undefined
              );
            }
            customCount++;
            at += length + 1;
          }
        }
      }
    }
  }
  async function findGlyphName(name: string): Promise<number> {
    if (postVersion === 0x00010000) {
      const gid = MacStandardGlyphOrdering.indexOf(name);
      return gid < numGlyphs ? gid : -1;
    }
    if (postVersion !== 0x00020000) return -1;
    for (let gid = 0; gid < numGlyphs; gid++) {
      const index = await u16(post!.offset + 34 + gid * 2);
      if (index < 258) {
        if (MacStandardGlyphOrdering[index] === name) return gid;
        continue;
      }
      if (index - 258 >= customCount) continue;
      options.signal?.throwIfAborted();
      const bytes = await source.storage.read(
        nameOffsets + (index - 258) * 8,
        8,
        options.signal ? { signal: options.signal } : undefined
      );
      if (bytes.length !== 8) throw new PdfError("E_PARSE", "Incomplete TrueType name offset");
      const at = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true),
        length = await input.byte(at);
      if (length !== name.length) continue;
      let match = true;
      for (let i = 0; i < length; i++)
        if ((await input.byte(at + 1 + i)) !== name.charCodeAt(i)) {
          match = false;
          break;
        }
      if (match) return gid;
    }
    return -1;
  }
  const loca = tables.get("loca"),
    glyf = tables.get("glyf");
  let freeScratch: { position: number; points: number } | undefined;
  async function* glyphSegments(gid: number, depth = 0): AsyncGenerator<PdfPathSegment> {
    options.signal?.throwIfAborted();
    if (gid < 0 || gid >= numGlyphs || depth > 6) return;
    if (cff) {
      yield* cff.glyphSegmentsById(gid);
      return;
    }
    if (!loca || !glyf) return;
    const offset =
      format === 0 ? (await u16(loca.offset + gid * 2)) * 2 : await u32(loca.offset + gid * 4);
    const next =
      format === 0
        ? (await u16(loca.offset + (gid + 1) * 2)) * 2
        : await u32(loca.offset + (gid + 1) * 4);
    if (offset >= next || glyf.offset + next > source.byteLength) return;
    const base = glyf.offset + offset,
      contours = await input.signed(base);
    if (contours < 0) {
      let at = base + 10,
        flags = 32;
      while ((flags & 32) !== 0 && at + 4 <= glyf.offset + next) {
        flags = await u16(at);
        const child = await u16(at + 2);
        at += 4;
        let dx = 0,
          dy = 0;
        if (flags & 1) {
          if (flags & 2) {
            dx = await input.signed(at);
            dy = await input.signed(at + 2);
          }
          at += 4;
        } else {
          if (flags & 2) {
            dx = ((await input.byte(at)) << 24) >> 24;
            dy = ((await input.byte(at + 1)) << 24) >> 24;
          }
          at += 2;
        }
        let a = 1,
          b = 0,
          c = 0,
          d = 1;
        if (flags & 8) {
          a = d = (await input.signed(at)) / 16384;
          at += 2;
        } else if (flags & 64) {
          a = (await input.signed(at)) / 16384;
          d = (await input.signed(at + 2)) / 16384;
          at += 4;
        } else if (flags & 128) {
          a = (await input.signed(at)) / 16384;
          b = (await input.signed(at + 2)) / 16384;
          c = (await input.signed(at + 4)) / 16384;
          d = (await input.signed(at + 6)) / 16384;
          at += 8;
        }
        const tx = dx / unitsPerEm,
          ty = dy / unitsPerEm;
        for await (const seg of glyphSegments(child, depth + 1)) {
          if (seg.kind === "move" || seg.kind === "line")
            yield { kind: seg.kind, x: seg.x * a + seg.y * c + tx, y: seg.x * b + seg.y * d + ty };
          else if (seg.kind === "cubic")
            yield {
              kind: "cubic",
              x1: seg.x1 * a + seg.y1 * c + tx,
              y1: seg.x1 * b + seg.y1 * d + ty,
              x2: seg.x2 * a + seg.y2 * c + tx,
              y2: seg.x2 * b + seg.y2 * d + ty,
              x: seg.x * a + seg.y * c + tx,
              y: seg.x * b + seg.y * d + ty
            };
          else yield seg;
        }
      }
      return;
    }
    if (!contours) return;
    const points = (await u16(base + 10 + (contours - 1) * 2)) + 1;
    const capacity = 2 ** Math.ceil(Math.log2(points));
    const lease =
      freeScratch && freeScratch.points >= points
        ? freeScratch
        : { position: source.storage.allocate(capacity * 12), points: capacity };
    if (lease === freeScratch) freeScratch = undefined;
    const scratch = lease.position,
      record = new Uint8Array(12),
      view = new DataView(record.buffer);
    try {
      const selected = options.signal ? { signal: options.signal } : undefined;
      let at = base + 12 + contours * 2 + (await u16(base + 10 + contours * 2));
      for (let i = 0; i < points; i++) {
        const flags = await input.byte(at++);
        record.fill(0);
        record[0] = flags;
        await source.storage.write(scratch + i * 12, record, selected);
        if (flags & 8) {
          const repeat = await input.byte(at++);
          for (let j = 0; j < repeat && i + 1 < points; j++)
            await source.storage.write(scratch + ++i * 12, record, selected);
        }
      }
      // Read each fixed record afresh: source and scratch share a backend which
      // may invalidate borrowed buffers on either read or write.
      async function load(i: number): Promise<void> {
        options.signal?.throwIfAborted();
        const bytes = await source.storage.read(scratch + i * 12, 12, selected);
        if (bytes.length !== 12) throw new PdfError("E_PARSE", "Incomplete TrueType point record");
        record.set(bytes);
      }
      for (const axis of [0, 1]) {
        let coordinate = 0;
        const short = axis === 0 ? 2 : 4,
          same = axis === 0 ? 16 : 32;
        for (let i = 0; i < points; i++) {
          await load(i);
          const flags = record[0]!;
          if (flags & short) {
            const delta = await input.byte(at++);
            coordinate += flags & same ? delta : -delta;
          } else if (!(flags & same)) {
            coordinate += await input.signed(at);
            at += 2;
          }
          view.setInt32(4 + axis * 4, coordinate, true);
          await source.storage.write(scratch + i * 12, record, selected);
        }
      }
      async function point(i: number) {
        if (i >= points) return { x: NaN, y: NaN, onCurve: false };
        await load(i);
        return {
          x: view.getInt32(4, true) / unitsPerEm,
          y: view.getInt32(8, true) / unitsPerEm,
          onCurve: (record[0]! & 1) !== 0
        };
      }
      let firstIndex = 0;
      for (let contour = 0; contour < contours; contour++) {
        const endIndex = await u16(base + 10 + contour * 2);
        if (endIndex >= firstIndex) {
          const first = await point(firstIndex),
            last = await point(endIndex),
            n = endIndex - firstIndex + 1;
          const sx = first.onCurve ? first.x : last.onCurve ? last.x : (first.x + last.x) * 0.5,
            sy = first.onCurve ? first.y : last.onCurve ? last.y : (first.y + last.y) * 0.5;
          yield { kind: "move", x: sx, y: sy };
          let x = sx,
            y = sy,
            index = first.onCurve ? 1 : 0;
          while (index < n) {
            const pt = await point(firstIndex + index);
            if (pt.onCurve) {
              yield { kind: "line", x: pt.x, y: pt.y };
              x = pt.x;
              y = pt.y;
              index++;
            } else {
              const nextPt = await point(firstIndex + ((index + 1) % n)),
                ex = nextPt.onCurve ? nextPt.x : (pt.x + nextPt.x) * 0.5,
                ey = nextPt.onCurve ? nextPt.y : (pt.y + nextPt.y) * 0.5;
              yield {
                kind: "cubic",
                x1: x + (2 / 3) * (pt.x - x),
                y1: y + (2 / 3) * (pt.y - y),
                x2: ex + (2 / 3) * (pt.x - ex),
                y2: ey + (2 / 3) * (pt.y - ey),
                x: ex,
                y: ey
              };
              x = ex;
              y = ey;
              index += nextPt.onCurve ? 2 : 1;
            }
          }
          yield { kind: "close" };
        }
        firstIndex = endIndex + 1;
      }
    } finally {
      if (!freeScratch || freeScratch.points < lease.points) freeScratch = lease;
    }
  }
  return {
    unitsPerEm,
    hasCmap: cmap !== undefined,
    isSymbolicCmap: f12 > 0 ? s12 : s4,
    getGlyphId,
    findGlyphName,
    glyphSegments,
    async getAdvanceWidthUnits(gid) {
      if (!Number.isInteger(gid) || gid < 0 || gid >= numGlyphs) gid = 0;
      const available = Math.max(0, Math.floor((source.byteLength - hmtx.offset - 2) / 4) + 1),
        index = Math.min(gid, metrics - 1, available - 1);
      return index < 0 ? 500 : u16(hmtx.offset + index * 4);
    }
  };
}
