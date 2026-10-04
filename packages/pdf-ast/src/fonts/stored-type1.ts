import { isStoredCidType1, parseStoredType1Cid } from "./stored-type1-cid.js";
import type { PdfPathSegment } from "../ast.js";
import {
  Type2Compiled,
  getEncoding,
  getGlyphsUnicode,
  recoverGlyphName,
  type Type1Properties
} from "../vendor/pdfjs-fonts.mjs";
import { FontProgramStore } from "./stored-program.js";
import { parseStoredType1Eexec } from "./stored-type1-program.js";
import { StoredType1Names, type1NameUnicode } from "./stored-type1-names.js";
import { StoredNumberRangeTree } from "./stored-range-tree.js";
import { createStoredCffRenderer } from "./stored-cff-renderer.js";
import type { StoredCidMap } from "./stored-cid-map.js";
import type { PdfFontAllocationOptions } from "./memory.js";

export async function parseStoredType1Font(
  source: StoredCidMap,
  properties: Type1Properties,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> & { signal?: AbortSignal } = {}
) {
  const { storage } = source,
    { signal } = options;
  signal?.throwIfAborted();
  options.onAllocation?.(262144);
  const input = new FontProgramStore(source, options),
    cid =
      properties.composite && (await isStoredCidType1(input.range()))
        ? await parseStoredType1Cid(input.range(), properties, storage, signal)
        : undefined,
    program = cid ?? (await parseStoredType1Eexec(input.range(), properties, storage, signal));
  const names = new StoredType1Names(
    async (gid) => (await program.glyph(gid))?.name ?? null,
    storage,
    signal
  );
  await names.build(program.count);
  const notdef = Math.max(0, await names.find(".notdef", 1)),
    standard = getEncoding("StandardEncoding")!;
  const base = properties.baseEncodingName
    ? getEncoding(properties.baseEncodingName as string)
    : standard;
  if (!properties.isInternalFont && properties.baseEncodingName && !base)
    throw new TypeError("Unknown Type1 base encoding");
  const composite = properties.composite ? new StoredNumberRangeTree(storage, signal) : undefined;
  let missingComposite = 0;
  if (composite) {
    const cmap = properties.cMap as { charCodeOf(gid: number): number };
    for (let gid = 0; gid < program.count - 1; gid++) {
      if (gid % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      const code = cmap.charCodeOf(gid);
      if (code === -1) missingComposite = gid + 1;
      else await composite.assign(code, code, gid + 1);
    }
  }
  const cache = new Map<number, number>(),
    differences = properties.differences as ReadonlyMap<number, string> | undefined;
  async function mapped(code: number): Promise<number> {
    if (cache.has(code)) return cache.get(code)!;
    let gid = 0;
    if (composite)
      gid =
        code === -1
          ? missingComposite
          : Number.isInteger(code) && code >= 0 && code <= 0xffffffff
            ? await composite.lookup(code)
            : 0;
    else if (differences?.has(code)) {
      const name = differences.get(code)!;
      gid = await names.find(name);
      if (gid < 0) gid = await names.find(recoverGlyphName(name, getGlyphsUnicode()));
    } else if (!properties.isInternalFont) {
      const symbolic = !!(Number(properties.flags) & 4);
      const name =
        properties.baseEncodingName || !symbolic
          ? base?.[code]
          : await program.header.encoding?.get(code);
      gid = await names.find(name);
    }
    gid = Math.max(0, gid);
    if (cache.size === 64) cache.delete(cache.keys().next().value!);
    cache.set(code, gid);
    return gid;
  }
  const glyphs = {
    length: program.count,
    async get(gid: number) {
      return (await program.glyph(gid))?.code;
    }
  };
  const renderer = new Type2Compiled({ glyphs }, [], program.header.matrix),
    glyphSegmentsById = createStoredCffRenderer(
      renderer,
      (gid) => glyphs.get(gid),
      storage,
      options
    );
  return {
    storedCff: true as const,
    unicodeByCode: new Map<number, string>(),
    glyphSegmentsById,
    async getUnicode(code: number) {
      const gid = await mapped(code),
        glyph = await program.glyph(gid);
      if (!glyph) return undefined;
      if (
        typeof glyph.name === "string"
          ? glyph.name === ".notdef"
          : await glyph.name?.equals(".notdef")
      )
        return undefined;
      return type1NameUnicode(glyph.name);
    },
    async *glyphSegments(code: number): AsyncGenerator<PdfPathSegment> {
      const gid = (await mapped(code)) || notdef,
        glyph = await program.glyph(gid),
        seac = glyph?.seac;
      if (seac) {
        const base = await names.find(standard[seac[2]!]!),
          accent = await names.find(standard[seac[3]!]!);
        if (base >= 0 && accent >= 0) {
          yield* glyphSegmentsById(base);
          const m = program.header.matrix,
            dx = seac[0]! * m[0]! + seac[1]! * m[2]! + m[4]!,
            dy = seac[0]! * m[1]! + seac[1]! * m[3]! + m[5]!;
          for await (const segment of glyphSegmentsById(accent)) {
            if (segment.kind === "close") yield segment;
            else if (segment.kind === "cubic")
              yield {
                ...segment,
                x: segment.x + dx,
                y: segment.y + dy,
                x1: segment.x1 + dx,
                y1: segment.y1 + dy,
                x2: segment.x2 + dx,
                y2: segment.y2 + dy
              };
            else yield { ...segment, x: segment.x + dx, y: segment.y + dy };
          }
          return;
        }
      }
      yield* glyphSegmentsById(gid);
    }
  };
}
