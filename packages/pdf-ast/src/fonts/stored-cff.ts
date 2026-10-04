import type { PdfPathSegment } from "../ast.js";
import {
  CFFParser,
  Stream,
  Type2Compiled,
  getEncoding,
  getGlyphsUnicode
} from "../vendor/pdfjs-fonts.mjs";
import { createStoredCffRenderer } from "./stored-cff-renderer.js";
import { FontProgramStore, type FontProgramRange } from "./stored-program.js";
import { StoredFontValues } from "./stored-values.js";
import { readStoredCffMetadata } from "./stored-cff-metadata.js";
import type { StoredCidMap } from "./stored-cid-map.js";
import type { PdfFontAllocationOptions } from "./memory.js";

export interface StoredCffFont {
  readonly storedCff: true;
  readonly unicodeByCode: ReadonlyMap<number, string>;
  getUnicode?(code: number): Promise<string | undefined>;
  glyphSegments(code: number): AsyncGenerator<PdfPathSegment>;
  glyphSegmentsById(glyphId: number): AsyncGenerator<PdfPathSegment>;
}

/** Retained CFF parsing and execution use the caller's resource storage for both
 * mutable program bytes and variable validation state. */
export async function parseStoredCffFont(
  source: StoredCidMap,
  encodingName: string | undefined,
  differences: ReadonlyMap<number, string>,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> & { signal?: AbortSignal } = {}
): Promise<StoredCffFont> {
  const { storage } = source,
    { signal } = options;
  options.onAllocation?.(131072);
  const original = new FontProgramStore(source, options);
  const position = storage.allocate(source.byteLength);
  const program = new FontProgramStore(
    { storage, position, byteLength: source.byteLength },
    options
  );
  // Native repairs may overlap later INDEX/DICT bytes. Keep the parsed metadata
  // source immutable, while all executable views share the repaired copy.
  for (let at = 0; at < source.byteLength; at += 4096) {
    signal?.throwIfAborted();
    const bytes = await original.read(at, Math.min(4096, source.byteLength - at));
    await storage.write(position + at, bytes, signal ? { signal } : undefined);
  }
  const cff = await readStoredCffMetadata(original.range(), storage, signal, program.range());
  const ids = new StoredFontValues(storage, signal),
    cidGlyphs = new StoredFontValues(storage, signal);
  const nativeUnicode = getGlyphsUnicode(),
    encoding = encodingName ? getEncoding(encodingName) : undefined;
  const standardEncoding = getEncoding(
    cff.encodingOffset === 1 ? "ExpertEncoding" : "StandardEncoding"
  )!;
  const requested = new Set<string>();
  for (let code = 0; code < 256; code++) {
    const name = differences.get(code) ?? encoding?.[code];
    if (name !== undefined) requested.add(name);
  }
  const byName = new Map<string, number>(),
    byUnicode = new Map<number, number>();
  const predefined = new Map<number, number>();
  const maximumKnownLength = Math.max(...Object.keys(nativeUnicode).map((name) => name.length));
  async function identify(
    name: string | FontProgramRange | undefined
  ): Promise<string | undefined> {
    if (typeof name === "string" || name === undefined) return name;
    if (name.length <= maximumKnownLength) {
      let text = "";
      for (let i = 0; i < name.length; i++) text += String.fromCharCode((await name.byte(i))!);
      return text;
    }
    for (const candidate of requested) {
      if (candidate.length !== name.length) continue;
      let matches = true;
      for (let i = 0; i < name.length; i++)
        if (candidate.charCodeAt(i) !== (await name.byte(i))) {
          matches = false;
          break;
        }
      if (matches) return candidate;
    }
    return undefined;
  }
  let gid = 0;
  for await (const id of cff.charset()) {
    signal?.throwIfAborted();
    // Predefined charsets contain names; custom charsets contain SIDs/CIDs.
    await ids.set(gid, typeof id === "number" ? id : undefined);
    if (cff.isCID && typeof id === "number") await cidGlyphs.set(id, gid);
    const name =
      typeof id === "string" ? id : cff.isCID ? undefined : await identify(await cff.name(id));
    if (name !== undefined) {
      if (requested.has(name)) byName.set(name, gid);
      const unicode = nativeUnicode[name];
      if (unicode !== undefined) {
        if (!byUnicode.has(unicode)) options.onAllocation?.(96);
        byUnicode.set(unicode, gid);
      }
      const code = standardEncoding.indexOf(name);
      if (code !== -1) predefined.set(code, gid);
      // Supplements can reference any SID. Native indexOf chooses the first
      // matching charset name; re-scan on demand rather than retain all names.
    }
    gid++;
  }
  async function glyphName(glyphId: number): Promise<string | undefined> {
    const id = await ids.get(glyphId);
    if (id !== undefined) return identify(await cff.name(id));
    let at = 0;
    for await (const item of cff.charset()) {
      if (at++ === glyphId) return typeof item === "string" ? item : identify(await cff.name(item));
    }
    return undefined;
  }
  async function firstGlyph(sid: number): Promise<number> {
    const wanted = await cff.name(sid);
    // Compare arbitrary source strings without decoding or retaining them.
    async function equal(other: string | FontProgramRange | undefined) {
      if (other === undefined || wanted === undefined) return other === wanted;
      if (other.length !== wanted.length) return false;
      for (let at = 0; at < other.length; at++) {
        const a = typeof other === "string" ? other.charCodeAt(at) : await other.byte(at);
        const b = typeof wanted === "string" ? wanted.charCodeAt(at) : await wanted.byte(at);
        if (a !== b) return false;
      }
      return true;
    }
    let index = 0;
    for await (const item of cff.charset()) {
      if (await equal(await cff.name(item))) return index;
      index++;
    }
    return -1;
  }
  const internalEncoding = cff.encodingOffset <= 1 ? predefined : new Map<number, number>();
  if (!cff.isCID && cff.encodingOffset > 1) {
    let at = cff.encodingOffset;
    const format = (await cff.source.byte(at++))!;
    if ((format & 127) === 0) {
      const count = (await cff.source.byte(at++))!;
      for (let i = 1; i <= count; i++) internalEncoding.set((await cff.source.byte(at++))!, i);
    } else if ((format & 127) === 1) {
      const ranges = (await cff.source.byte(at++))!;
      let gid = 1;
      for (let i = 0; i < ranges; i++) {
        const start = (await cff.source.byte(at++))!,
          left = (await cff.source.byte(at++))!;
        for (let code = start; code <= start + left; code++) {
          if (code < 256) internalEncoding.set(code, gid);
          gid++;
        }
      }
    } else throw new Error("Unknown CFF encoding format");
    if (format & 128) {
      await cff.repairs.writeByte(cff.encodingOffset, format & 127);
      const count = (await cff.source.byte(at++))!;
      for (let i = 0; i < count; i++) {
        const code = (await cff.source.byte(at++))!,
          sid = ((await cff.source.byte(at++))! << 8) + (await cff.source.byte(at++))!;
        internalEncoding.set(code, await firstGlyph(sid));
      }
    }
  }
  const glyphIds = new Map<number, number>(),
    unicodeByCode = new Map<number, string>();
  if (!cff.isCID)
    for (let code = 0; code < 256; code++) {
      const name = differences.get(code) ?? encoding?.[code];
      const glyph = name === undefined ? internalEncoding.get(code) : byName.get(name);
      if (glyph === undefined) continue;
      glyphIds.set(code, glyph);
      const glyphLabel = await glyphName(glyph),
        unicode = glyphLabel === undefined ? undefined : nativeUnicode[glyphLabel];
      if (unicode !== undefined) unicodeByCode.set(code, String.fromCodePoint(unicode));
    }
  const invalid = new StoredFontValues(storage, signal),
    stack = new StoredFontValues(storage, signal);
  const parser = new CFFParser(new Stream(new Uint8Array()), {}, false);
  for (let glyph = 0; glyph < cff.glyphs.count; glyph++) {
    let valid = true,
      local = cff.subrs;
    if (cff.isCID && cff.fdArray.length) {
      const fd = await cff.fdSelect.getFDIndex(glyph);
      const dict = await cff.fdArray.get(fd);
      if (!dict) valid = false;
      else local = dict.privateDict.subrsIndex?.objects;
    }
    stack.clear();
    if (valid) {
      const state = {
        callDepth: 0,
        stackSize: 0,
        stack,
        hints: 0,
        firstStackClearing: true,
        seac: null,
        width: null,
        hasVStems: false
      };
      const steps = parser.parseCharStringSteps(
        state,
        (await cff.glyphs.get(glyph))!,
        local ?? null,
        cff.gsubrs
      );
      try {
        let step = steps.next(),
          requests = 0;
        while (!step.done) {
          if (++requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
          signal?.throwIfAborted();
          step = steps.next(await step.value);
        }
        valid = step.value;
      } finally {
        steps.return(false);
      }
    }
    await invalid.set(glyph, valid ? 0 : 1);
  }
  await program.flush();
  const glyphs = {
    length: cff.glyphs.count,
    async get(gid: number) {
      return (await invalid.get(gid)) ? new Uint8Array([14]) : await cff.glyphs.get(gid);
    }
  };
  const cmap = [...byUnicode]
    .sort(([a], [b]) => a - b)
    .map(([code, gid]) => ({ start: code, end: code, idDelta: gid - code }));
  const renderer = new Type2Compiled(
    {
      glyphs,
      subrs: cff.subrs,
      gsubrs: cff.gsubrs,
      isCFFCIDFont: cff.isCID,
      fdSelect: cff.fdSelect,
      fdArray: cff.fdArray
    },
    cmap,
    cff.matrix
  );
  const glyphSegmentsById = createStoredCffRenderer(
    renderer,
    (gid) => glyphs.get(gid),
    storage,
    options
  );
  return {
    storedCff: true,
    unicodeByCode,
    glyphSegmentsById,
    async *glyphSegments(code: number) {
      yield* glyphSegmentsById(
        cff.isCID ? ((await cidGlyphs.get(code)) ?? 0) : (glyphIds.get(code) ?? 0)
      );
    }
  };
}
