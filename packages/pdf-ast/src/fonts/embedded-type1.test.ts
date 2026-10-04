import { CFFCompiler, CFFParser, Stream, Type1Font } from "../vendor/pdfjs-fonts.mjs";
import { expect, it, vi } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../index.js";
import { parseEmbeddedType1Font } from "./type1.js";
import { bytesToString, stringToBytes } from "../bytes.js";

function type1Program(accent = false) {
  const number = (value: number): number[] => value >= -107 && value <= 107 ? [value + 139] : value > 0 ? [247 + Math.floor((value - 108) / 256), (value - 108) % 256] : [251 + Math.floor((-value - 108) / 256), (-value - 108) % 256];
  // A deliberately triangular A, with explicit 600-unit width and 700-unit height.
  const triangle = Uint8Array.from([...number(0), ...number(600), 13, 139, 139, 21, ...number(600), 139, 5, ...number(-300), ...number(700), 5, ...number(-300), ...number(-700), 5, 9, 14]);
  const seac = Uint8Array.from([...number(0), ...number(600), 13, 139, ...number(100), ...number(200), ...number(65), ...number(194), 12, 6]);
  const accentProgram = accent ? "/acute " + triangle.length + " RD " + bytesToString(triangle) + " ND\n/Aacute " + seac.length + " RD " + bytesToString(seac) + " ND\n" : "";
  const header = "%!PS-AdobeFont-1.0: TestTriangle 1.0\n11 dict begin\n/FontName /TestTriangle def\n/FontType 1 def\n/FontMatrix [0.001 0 0 0.001 0 0] def\n/FontBBox [0 0 600 700] def\n/Encoding 256 array 0 1 255 {1 index exch /.notdef put} for dup 65 /A put readonly def\ncurrentdict end\ncurrentfile eexec\n";
  const privateData = stringToBytes("\0\0\0\0dup /Private 8 dict dup begin\n/lenIV -1 def\n/RD {string currentfile exch readstring pop} executeonly def\n/ND {noaccess def} executeonly def\n/NP {noaccess put} executeonly def\n/Subrs 0 array def\n/CharStrings 4 dict dup begin\n/.notdef " + triangle.length + " RD " + bytesToString(triangle) + " ND\n/A " + triangle.length + " RD " + bytesToString(triangle) + " ND\n" + accentProgram + "end end readonly put\nnoaccess put\ndup /FontName get exch definefont pop\nmark currentfile closefile\n");
  let key = 55665;
  const encrypted = privateData.map(byte => { const cipher = byte ^ (key >> 8); key = ((cipher + key) * 52845 + 22719) & 65535; return cipher; });
  return { bytes: Uint8Array.from([...stringToBytes(header), ...encrypted]), length1: header.length, length2: encrypted.length };
}

it.each([false, true])("renders embedded Type 1 glyphs instead of substituting Helvetica (Differences: %s)", remap => {
  const doc = PdfDocument.create();
  const page = doc.addPage([100, 100]);
  const { bytes, length1, length2 } = type1Program();
  const fontFile = doc.cos.allocateObject(cosStream(bytes, { dict: cosDict({ Length1: cosNumber(length1), Length2: cosNumber(length2), Length3: cosNumber(0) }) }));
  const font = doc.cos.allocateObject(cosDict({
    Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("TestTriangle"), FirstChar: cosNumber(65), LastChar: cosNumber(66), Widths: cosArray([cosNumber(600), cosNumber(600)]),
    ...(remap ? { Encoding: cosDict({ Differences: cosArray([cosNumber(66), cosName("A")]) }) } : {}),
    FontDescriptor: cosDict({ Type: cosName("FontDescriptor"), FontName: cosName("TestTriangle"), Flags: cosNumber(32), FontBBox: cosArray([0, 0, 600, 700].map(n => cosNumber(n))), ItalicAngle: cosNumber(0), Ascent: cosNumber(700), Descent: cosNumber(0), CapHeight: cosNumber(700), StemV: cosNumber(80), FontFile: fontFile }),
  }));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
  page.setRawContentStream(`BT /F1 100 Tf 10 10 Td (${remap ? "B" : "A"}) Tj ET`);
  const glyph = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList().glyphs[0]!;
  expect(glyph.unicode).toBe("A");
  const segments = glyph.outline!.segments;
  const vertices = new Set(segments.flatMap(segment => segment.kind === "line" ? [`${Math.round(segment.x)},${Math.round(segment.y)}`] : []));
  expect(vertices).toEqual(new Set(["10,10", "70,10", "40,80"]));
  expect(segments.filter(segment => segment.kind === "cubic")).toHaveLength(0);
});

it.each(["binary", "hex", "pfb", "wrong-length"])("accepts the PDF.js-supported Type 1 %s container", format => {
  const source = type1Program();
  let bytes: Uint8Array = source.bytes;
  if (format === "hex") bytes = stringToBytes(bytesToString(bytes.subarray(0, source.length1)) + Array.from(bytes.subarray(source.length1), byte => byte.toString(16).padStart(2, "0")).join(""));
  if (format === "pfb") {
    const block = (type: number, data: Uint8Array) => [128, type, data.length & 255, (data.length >>> 8) & 255, (data.length >>> 16) & 255, data.length >>> 24, ...data];
    bytes = Uint8Array.from([...block(1, bytes.subarray(0, source.length1)), ...block(2, bytes.subarray(source.length1)), 128, 3]);
  }
  const original = bytes.slice();
  const font = parseEmbeddedType1Font(bytes, {
    length1: format === "wrong-length" ? 1 : source.length1, length2: source.length2,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0], bbox: [0, 0, 600, 700], widths: {},
    flags: 32, overridableEncoding: true,
  });
  const vertices = new Set(font.getGlyphOutline(65).flatMap(segment => segment.kind === "line" ? [`${Math.round(segment.x * 1000)},${Math.round(segment.y * 1000)}`] : []));
  expect(vertices).toEqual(new Set(["0,0", "600,0", "300,700"]));
  expect(bytes).toEqual(original);
});

it("uses the original .notdef outline without replacing extracted characters with NUL", () => {
  const source = type1Program();
  const font = parseEmbeddedType1Font(source.bytes, {
    length1: source.length1, length2: source.length2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    bbox: [0, 0, 600, 700], widths: {}, flags: 32, overridableEncoding: true,
  });
  expect(font.unicodeByCode.has(32)).toBe(false);
  expect(font.unicodeByCode.has(66)).toBe(false);
  expect(font.getGlyphOutline(66)).toEqual(font.getGlyphOutline(65));
});

it("positions a Type 1 seac accent using the original glyph IDs", async () => {
  const source = type1Program(true);
  const font = parseEmbeddedType1Font(source.bytes, {
    length1: source.length1, length2: source.length2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    bbox: [0, 0, 600, 700], widths: {}, flags: 32, overridableEncoding: true, baseEncodingName: "WinAnsiEncoding",
  });
  expect(font.unicodeByCode.get(193)).toBe("Á");
  const vertices = new Set(font.getGlyphOutline(193).flatMap(segment => segment.kind === "line" ? [`${Math.round(segment.x * 1000)},${Math.round(segment.y * 1000)}`] : []));
  expect(vertices).toEqual(new Set(["0,0", "600,0", "300,700", "100,200", "700,200", "400,900"]));
  const data = new Uint8Array(65536); let end = 0;
  const storage = { allocate(n: number) { const at = end; end += n; return at; }, async read(at: number, n: number) { return data.slice(at, at + n); }, async write(at: number, bytes: Uint8Array) { data.set(bytes, at); } };
  const backed = [];
  for await (const segment of font.storedSegments(193, storage)) backed.push(segment);
  expect(backed).toEqual(font.getGlyphOutline(193));
});

it("keeps CID-keyed Type 1 glyph IDs aligned after CFF conversion", () => {
  // PDF.js Type1Parser fixture layout, with a visible triangular CID 2.
  const notdef = [139, 248, 136, 13, 14]; // 0 500 hsbw endchar
  const triangle = [139, 248, 236, 13, 139, 139, 21, 248, 236, 139, 5, 251, 192, 249, 80, 5, 251, 192, 253, 80, 5, 9, 14];
  const binary = Uint8Array.of(4, 9, 9, 9 + triangle.length, ...notdef, ...triangle);
  const bytes = stringToBytes("%!PS-Adobe-3.0 Resource-CIDFont\n/CIDMapOffset 0 def\n/FDBytes 0 def\n/GDBytes 1 def\n/CIDCount 3 def\n/Private 5 dict dup begin /lenIV -1 def end def\n(Binary) " + binary.length + " StartData " + bytesToString(binary));
  const font = parseEmbeddedType1Font(bytes, {
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0], bbox: [0, 0, 600, 700], widths: {},
    composite: true, cMap: { charCodeOf: (cid: number) => cid },
  });
  expect(font.getGlyphOutline(0).filter(segment => segment.kind === "line")).toHaveLength(0);
  const vertices = new Set(font.getGlyphOutline(2).flatMap(segment => segment.kind === "line" ? [`${Math.round(segment.x * 1000)},${Math.round(segment.y * 1000)}`] : []));
  expect(vertices).toEqual(new Set(["0,0", "600,0", "300,700"]));
});


it("renders Type1 outlines without compiling a font and reparsing its bytes", () => {
  const source = type1Program(true);
  const compile = vi.spyOn(CFFCompiler.prototype, "compile").mockImplementation(() => { throw new Error("whole-font compilation"); });
  const parse = vi.spyOn(CFFParser.prototype, "parse").mockImplementation(() => { throw new Error("whole-font reparse"); });
  try {
    const font = parseEmbeddedType1Font(source.bytes, {
      length1: source.length1, length2: source.length2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      bbox: [0, 0, 600, 700], widths: {}, flags: 32, overridableEncoding: true, baseEncodingName: "WinAnsiEncoding",
    });
    expect(font.unicodeByCode.get(193)).toBe("Á");
    expect(font.getGlyphOutline(193).some(segment => segment.kind === "line")).toBe(true);
  } finally { compile.mockRestore(); parse.mockRestore(); }
});

it("keeps Type1 compiled font bytes available as a lazy convenience", () => {
  const source = type1Program();
  const compile = vi.spyOn(CFFCompiler.prototype, "compile");
  try {
    const font = new Type1Font("Triangle", new Stream(source.bytes), {
      length1: source.length1, length2: source.length2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      bbox: [0, 0, 600, 700], widths: {}, flags: 32, overridableEncoding: true,
    });
    expect(compile).not.toHaveBeenCalled();
    const bytes = font.data;
    expect(compile).toHaveBeenCalledTimes(1);
    expect(font.data).toBe(bytes);
    expect(new CFFParser(new Stream(Uint8Array.from(bytes)), {}, false).parse().charStrings.objects.length).toBeGreaterThan(1);
  } finally { compile.mockRestore(); }
});
