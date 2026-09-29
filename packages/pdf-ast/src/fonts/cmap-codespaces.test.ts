/* Selected codespace/bfrange cases adapted from Mozilla PDF.js
 * test/unit/cmap_spec.js, Apache-2.0; see THIRD_PARTY_NOTICES.md. */
import { expect, it } from "vitest";
import { parseToUnicodeCMap } from "./cmap.js";
const parse = (source: string) => parseToUnicodeCMap(new TextEncoder().encode(source));

it("decodes PDF.js mixed one- and four-byte codespace ranges", () => {
  const cmap = parse("1 begincodespacerange\n<01> <02>\n<00000003> <00000004>\nendcodespacerange\n2 beginbfchar\n<01> <0041>\n<00000003> <0042>\nendbfchar");
  expect(cmap.decodeBytes(Uint8Array.of(1, 0, 0, 0, 3))).toEqual([{ charCode: 1, unicode: "A" }, { charCode: 3, unicode: "B" }]);
});

it("decodes PDF.js four-byte codespace values as unsigned integers", () => {
  const cmap = parse("1 begincodespacerange\n<8EA1A1A1> <8EA1FEFE>\nendcodespacerange\n1 beginbfchar\n<8EA1A1A1> <0041>\nendbfchar");
  expect(cmap.decodeBytes(Uint8Array.of(0x8e, 0xa1, 0xa1, 0xa1))).toEqual([{ charCode: 0x8ea1a1a1, unicode: "A" }]);
});

it("decodes mixed one-, two-, and three-byte codes without depending on total string length", () => {
  const cmap = parse("3 begincodespacerange\n<20> <7F>\n<8000> <80FF>\n<900000> <90FFFF>\nendcodespacerange\n3 beginbfchar\n<41> <0041>\n<8001> <00660069>\n<900002> <D83DDE00>\nendbfchar");
  expect(cmap.decodeBytes(Uint8Array.of(65, 128, 1, 144, 0, 2))).toEqual([{ charCode: 65, unicode: "A" }, { charCode: 0x8001, unicode: "fi" }, { charCode: 0x900002, unicode: "😀" }]);
});

it("keeps a valid two-byte prefix when a string ends with an incomplete code", () => {
  const cmap = parse("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfchar\n<0102> <0041>\nendbfchar");
  expect(cmap.decodeBytes(Uint8Array.of(1, 2, 0)).map(item => item.unicode).join("")).toBe("A");
});

it("accepts the PDF.js numeric bfrange recovery case", () => {
  const cmap = parse("1 beginbfrange\n<06> <0B> 0\nendbfrange");
  expect(cmap.map.get(0x06)).toBe("\0");
  expect(cmap.map.get(0x0b)).toBe("\x05");
  expect(cmap.map.get(0x0c)).toBeUndefined();
});

it("accepts the PDF.js bfrange array recovery case", () => {
  const cmap = parse("1 beginbfrange\n<0D> <12> [ 0 1 2 3 4 5 ]\nendbfrange");
  expect(cmap.map.get(0x0d)).toBe("\0");
  expect(cmap.map.get(0x12)).toBe("\x05");
  expect(cmap.map.get(0x13)).toBeUndefined();
});

it("parses the PDF.js bfchar case", () => {
  const cmap = parse("2 beginbfchar\n<03> <00>\n<04> <01>\nendbfchar");
  expect(cmap.map.get(3)).toBe("\0");
  expect(cmap.map.get(4)).toBe("\x01");
  expect(cmap.map.get(5)).toBeUndefined();
});

it("parses the PDF.js cidchar case used by some ToUnicode streams", () => {
  const cmap = parse("1 begincidchar\n<14> 0\nendcidchar");
  expect(cmap.map.get(0x14)).toBe("\0");
  expect(cmap.map.get(0x15)).toBeUndefined();
});

it("parses the PDF.js cidrange case", () => {
  const cmap = parse("1 begincidrange\n<0016> <001B> 0\nendcidrange");
  expect(cmap.map.get(0x15)).toBeUndefined();
  expect(cmap.map.get(0x16)).toBe("\0");
  expect(cmap.map.get(0x1b)).toBe("\x05");
  expect(cmap.map.get(0x1c)).toBeUndefined();
});

it("ignores the PDF.js oversized range without affecting later ranges", () => {
  const cmap = parse("1 begincidrange\n<00000000> <FFFFFFFF> 0\nendcidrange\n1 begincidrange\n<0000> <0001> 5\nendcidrange");
  expect(cmap.map.get(0)).toBe("\x05");
  expect(cmap.map.get(1)).toBe("\x06");
  expect(cmap.map.get(2)).toBeUndefined();
});

it("restores omitted leading UTF-16BE zeros as in PDF.js issue 18099", () => {
  const cmap = parse("1 beginbfchar\n<41> <010203>\nendbfchar");
  expect(cmap.map.get(65)).toBe("\x01\u0203");
});

it("preserves fixed-width compatibility when the codespace declaration is absent", () => {
  const cmap = parse("1 beginbfchar\n<0001> <0041>\nendbfchar");
  expect(cmap.isTwoByte).toBe(true);
  expect(cmap.decodeBytes(Uint8Array.of(0, 1))).toEqual([{ charCode: 1, unicode: "A" }]);
});

it("accepts literal byte strings in mapping entries", () => {
  const cmap = parse("1 beginbfchar\n(A) (\\000B)\nendbfchar");
  expect(cmap.decodeBytes(Uint8Array.of(65))).toEqual([{ charCode: 65, unicode: "B" }]);
});

it("does not throw when an unmapped four-byte code exceeds Unicode", () => {
  const cmap = parse("1 begincodespacerange\n<8EA1A1A1> <8EA1FEFE>\nendcodespacerange");
  expect(cmap.decodeBytes(Uint8Array.of(0x8e, 0xa1, 0xa1, 0xa1))).toEqual([{ charCode: 0x8ea1a1a1, unicode: "" }]);
});

it("extracts mixed-width Unicode through the document API", async () => {
  const { PdfDocument, cosArray, cosDict, cosName, cosStream, dictSet } = await import("../index.js");
  const doc = PdfDocument.create();
  const page = doc.addPage([400, 100]);
  const toUnicode = cosStream(new TextEncoder().encode("3 begincodespacerange\n<20> <7F>\n<8000> <80FF>\n<900000> <90FFFF>\nendcodespacerange\n3 beginbfchar\n<41> <0041>\n<8001> <00660069>\n<900002> <D83DDE00>\nendbfchar"));
  const font = cosDict({ Type: cosName("Font"), Subtype: cosName("Type0"), BaseFont: cosName("Helvetica"), ToUnicode: doc.cos.allocateObject(toUnicode), DescendantFonts: cosArray([cosDict({ Subtype: cosName("CIDFontType2") })]) });
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: doc.cos.allocateObject(font) }) }));
  page.setRawContentStream("BT /F1 20 Tf 20 40 Td <418001900002> Tj ET");
  expect(PdfDocument.load(doc.save()).extractText()).toBe("Afi😀");
});
