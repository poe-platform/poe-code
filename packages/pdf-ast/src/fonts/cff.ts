import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import type { PdfPathSegment } from "../ast.js";
import {
  CFFParser,
  DrawOPS,
  Stream,
  Type2Compiled,
  getEncoding,
  getGlyphsUnicode,
  type CffFont
} from "../vendor/pdfjs-fonts.mjs";

export interface CffGlyphRenderer {
  (glyphId: number): PdfPathSegment[];
  segments(glyphId: number): Generator<PdfPathSegment>;
}

export function createCffGlyphRenderer(
  cff: CffFont,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> = {}
): CffGlyphRenderer {
  const allocation = new PdfFontAllocation(options);
  allocation.admit(1024 + cff.charset.charset.length * 256);
  // Apply PDF.js CFFCompiler's CID matrix normalization directly. Compiling
  // another complete font merely for this mutation duplicates every index.
  if (cff.isCIDFont && cff.topDict.hasName("FontMatrix")) {
    const base = cff.topDict.getByName("FontMatrix")!;
    cff.topDict.removeByName("FontMatrix");
    for (const dict of cff.fdArray) {
      allocation.admit(128);
      const child = dict.hasName("FontMatrix") ? dict.getByName("FontMatrix")! : undefined;
      dict.setByName(
        "FontMatrix",
        child
          ? [
              base[0]! * child[0]! + base[2]! * child[1]!,
              base[1]! * child[0]! + base[3]! * child[1]!,
              base[0]! * child[2]! + base[2]! * child[3]!,
              base[1]! * child[2]! + base[3]! * child[3]!,
              base[0]! * child[4]! + base[2]! * child[5]! + base[4]!,
              base[1]! * child[4]! + base[3]! * child[5]! + base[5]!
            ]
          : base.slice()
      );
    }
  }
  const unicodeByName = getGlyphsUnicode();
  const glyphsByUnicode = new Map<number, number>();
  cff.charset.charset.forEach((name, gid) => {
    const unicode = typeof name === "string" ? unicodeByName[name] : undefined;
    if (unicode !== undefined) glyphsByUnicode.set(unicode, gid);
  });
  const cmap = [...glyphsByUnicode]
    .sort(([a], [b]) => a - b)
    .map(([code, gid]) => ({ start: code, end: code, idDelta: gid - code }));
  const renderer = new Type2Compiled(
    {
      glyphs: cff.charStrings.objects,
      subrs: cff.topDict.privateDict?.subrsIndex?.objects,
      gsubrs: cff.globalSubrIndex.objects,
      isCFFCIDFont: cff.isCIDFont,
      fdSelect: cff.fdSelect,
      fdArray: cff.fdArray
    },
    cmap,
    cff.topDict.getByName("FontMatrix") ?? [0.001, 0, 0, 0.001, 0, 0]
  );
  const paths = new Map<number, PdfPathSegment[]>();
  const maxCachedBytes = 256 * 1024;
  let cachedBytes = 0;
  const render = (glyphId: number): PdfPathSegment[] => {
    const cached = paths.get(glyphId);
    if (cached) return cached;
    const commands = renderer.compileGlyph(
      cff.charStrings.objects[glyphId] ?? new Uint8Array(),
      glyphId,
      (bytes) => allocation.admit(bytes)
    );
    allocation.admit(commands.length * 128);
    const path = [...commandSegments(commands)];
    const pathBytes = 64 + path.length * 128;
    if (pathBytes <= maxCachedBytes) {
      allocation.admit(64);
      while (cachedBytes + pathBytes > maxCachedBytes) {
        const oldest = paths.keys().next().value!;
        cachedBytes -= 64 + paths.get(oldest)!.length * 128;
        paths.delete(oldest);
      }
      paths.set(glyphId, path);
      cachedBytes += pathBytes;
    }
    return path;
  };
  let streamPeak = 0;
  return Object.assign(render, {
    *segments(glyphId: number): Generator<PdfPathSegment> {
      let streamBytes = 0;
      for (const commands of renderer.glyphCommands(
        cff.charStrings.objects[glyphId] ?? new Uint8Array(),
        glyphId,
        (bytes) => {
          streamBytes += bytes;
          if (streamBytes > streamPeak) {
            allocation.admit(streamBytes - streamPeak);
            streamPeak = streamBytes;
          }
        }
      )) {
        yield* commandSegments(commands);
      }
    }
  });
}

function* commandSegments(commands: ArrayLike<number>): Generator<PdfPathSegment> {
  for (let i = 0; i < commands.length; ) {
    const op = commands[i++];
    if (op === DrawOPS.moveTo) yield { kind: "move", x: commands[i++]!, y: commands[i++]! };
    else if (op === DrawOPS.lineTo) yield { kind: "line", x: commands[i++]!, y: commands[i++]! };
    else if (op === DrawOPS.curveTo)
      yield {
        kind: "cubic",
        x1: commands[i++]!,
        y1: commands[i++]!,
        x2: commands[i++]!,
        y2: commands[i++]!,
        x: commands[i++]!,
        y: commands[i++]!
      };
    else if (op === DrawOPS.closePath) yield { kind: "close" };
    else throw new Error(`Unsupported PDF.js CFF path operation: ${op}`);
  }
}

export interface EmbeddedCffFont {
  readonly unicodeByCode: ReadonlyMap<number, string>;
  getGlyphOutline(code: number): PdfPathSegment[];
  glyphSegments(code: number): Generator<PdfPathSegment>;
}

export function parseEmbeddedCffFont(
  bytes: Uint8Array,
  encodingName: string | undefined,
  differences: ReadonlyMap<number, string>,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> = {}
): EmbeddedCffFont {
  const allocation = new PdfFontAllocation(options);
  // PDF.js repairs charstrings in place; never mutate the document stream.
  allocation.admit(bytes.length);
  const cff = new CFFParser(new Stream(bytes.slice()), {}, false, (bytes) =>
    allocation.admit(bytes)
  ).parse();
  allocation.admit(65536 + cff.charset.charset.length * 192);
  const glyphIds = new Map<number, number>();
  const unicodeByCode = new Map<number, string>();
  if (cff.isCIDFont) {
    cff.charset.charset.forEach((cid, gid) => {
      if (typeof cid === "number") glyphIds.set(cid, gid);
    });
  } else {
    const encoding = encodingName ? getEncoding(encodingName) : undefined;
    const glyphsByName = new Map(cff.charset.charset.map((name, gid) => [name, gid]));
    const unicodeByName = getGlyphsUnicode();
    for (let code = 0; code < 256; code++) {
      const name = differences.get(code) ?? encoding?.[code];
      const gid = name === undefined ? cff.encoding?.encoding[code] : glyphsByName.get(name);
      if (gid === undefined) continue;
      glyphIds.set(code, gid);
      const glyphName = cff.charset.charset[gid];
      const unicode = typeof glyphName === "string" ? unicodeByName[glyphName] : undefined;
      if (unicode !== undefined) unicodeByCode.set(code, String.fromCodePoint(unicode));
    }
  }
  const renderGlyph = createCffGlyphRenderer(cff, options);
  return {
    unicodeByCode,
    getGlyphOutline: (code) => renderGlyph(glyphIds.get(code) ?? 0),
    glyphSegments: (code) => renderGlyph.segments(glyphIds.get(code) ?? 0)
  };
}
