import { expect, it } from "vitest";
import { DocumentXmlEditor } from "./xml-write.js";
import { parseDocumentXml } from "./package-xml.js";
import { formattedRunProperties } from "./run-properties.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { w } from "../tests/fixtures/text.js";

function properties(source: string, options: DocxOperationArguments<"runs.set">) {
  const editor = new DocumentXmlEditor(new TextEncoder().encode(`<w:p xmlns:w="${w}"><w:r>${source}<w:t>coast</w:t></w:r></w:p>`));
  const result = formattedRunProperties(editor, editor.root.children[0]!, options);
  const parsed = parseDocumentXml(new TextEncoder().encode(`<w:r xmlns:w="${w}">${result}</w:r>`)).root.children[0];
  return { result, parsed };
}

it("inserts new properties in schema order without reordering existing properties", () => {
  expect(properties('<w:rPr><w:sz w:val="24"/></w:rPr>', { bold: true, italic: true, strike: true }).parsed!.children.map(c => c.localName)).toEqual(["b", "i", "strike", "sz"]);
});

it("preserves direct defaults, resets font slots individually and removes theme transforms with RGB", () => {
  const source = '<w:rPr><w:rFonts w:ascii="Coast" w:hAnsi="Coast" w:eastAsia="海" w:cs="ساحل" w:asciiTheme="majorAscii"/><w:color w:val="112233" w:themeColor="accent1" w:themeShade="40"/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr>';
  const { parsed } = properties(source, { ascii: null, highAnsi: "Survey", eastAsiaTheme: "minorEastAsia", complexScriptTheme: "majorBidi", color: "aabbcc", language: null });
  const attrs = (name: string) => Object.fromEntries(parsed!.children.find(c => c.localName === name)!.attributes.filter(a => a.namespace === w).map(a => [a.localName, a.value]));
  expect(attrs("rFonts")).toEqual({ hAnsi: "Survey", eastAsia: "海", cs: "ساحل", asciiTheme: "majorAscii", eastAsiaTheme: "minorEastAsia", cstheme: "majorBidi" });
  expect(attrs("color")).toEqual({ val: "AABBCC" });
  expect(attrs("lang")).toEqual({ bidi: "ar-SA" });
});

it("maps every admitted underline and highlight symbol to its XML value", () => {
  const underline = { NONE: "none", SINGLE: "single", WORDS: "words", DOUBLE: "double", DOTTED: "dotted", THICK: "thick", DASH: "dash", DOT_DASH: "dotDash", DOT_DOT_DASH: "dotDotDash", WAVY: "wave", DOTTED_HEAVY: "dottedHeavy", DASH_HEAVY: "dashedHeavy", DOT_DASH_HEAVY: "dashDotHeavy", DOT_DOT_DASH_HEAVY: "dashDotDotHeavy", WAVY_HEAVY: "wavyHeavy", DASH_LONG: "dashLong", WAVY_DOUBLE: "wavyDouble", DASH_LONG_HEAVY: "dashLongHeavy" } as const;
  const highlight = { AUTO: "default", BLACK: "black", BLUE: "blue", BRIGHT_GREEN: "green", DARK_BLUE: "darkBlue", DARK_RED: "darkRed", DARK_YELLOW: "darkYellow", GRAY_25: "lightGray", GRAY_50: "darkGray", GREEN: "darkGreen", PINK: "magenta", RED: "red", TEAL: "darkCyan", TURQUOISE: "cyan", VIOLET: "darkMagenta", WHITE: "white", YELLOW: "yellow" } as const;
  for (const name of Object.keys(underline) as (keyof typeof underline)[]) expect(properties("", { underline: { enum: "WD_UNDERLINE", name } }).parsed!.children[0]!.attributes.find(a => a.localName === "val")!.value).toBe(underline[name]);
  for (const name of Object.keys(highlight) as (keyof typeof highlight)[]) expect(properties("", { highlight: { enum: "WD_COLOR_INDEX", name } }).parsed!.children[0]!.attributes.find(a => a.localName === "val")!.value).toBe(highlight[name]);
});
