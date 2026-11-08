// Adapted from Mozilla PDF.js test/unit/cff_parser_spec.js (Apache-2.0).
// Revision and adaptation details: THIRD_PARTY_NOTICES.md.
import { beforeEach, expect, it } from "vitest";
import { CFFParser, CFFCompiler, Stream, type CffFont } from "../vendor/pdfjs-fonts.mjs";

// Example from Adobe's CFF specification, also used by PDF.js.
// Complete canonical byte string (kept literal so a codec change cannot alter the fixture).
const fontHex = "0100040100010101134142434445462b54696d65732d526f6d616e000101011ff81b00f81c02f81d03f819041c6f000dfb3cfb6efa7cfa1605e911b8f112000301010813183030312e30303754696d657320526f6d616e54696d657300000002010102030e0e7d99f92a99fb7695f7738b06f79a93fc7c8c077d99f85695f75e9908fb6e8cf87393f7108b09a70adf0bf78e14";
let cff: CffFont;
beforeEach(() => {
  const bytes = Uint8Array.from({ length: fontHex.length / 2 }, (_, i) => Number.parseInt(fontHex.slice(i * 2, i * 2 + 2), 16));
  cff = new CFFParser(new Stream(bytes), {}, true).parse();
});

it("parses the CFF header", () => {
  expect(cff.header).toMatchObject({ major: 1, minor: 0, hdrSize: 4, offSize: 1 });
});
it("parses the name index", () => { expect(cff.names).toEqual(["ABCDEF+Times-Roman"]); });
it("parses the string index", () => {
  expect(cff.strings.count).toBe(3);
  expect(cff.strings.get(0)).toBe(".notdef"); expect(cff.strings.get(391)).toBe("001.007");
});
it("parses the top dictionary", () => {
  for (const [name, value] of Object.entries({ version: 391, FullName: 392, FamilyName: 393, Weight: 389, UniqueID: 28416, FontBBox: [-168, -218, 1000, 898], CharStrings: 94, Private: [45, 102] })) {
    expect(cff.topDict.getByName(name)).toEqual(value);
  }
});
it("ignores an empty FontBBox when adjusting ascent/descent", () => {
  cff.topDict.setByName("FontBBox", [0, 0, 0, 0]);
  const properties: Record<string, unknown> = { ascent: 800, descent: -200 };
  new CFFParser(new Stream(Uint8Array.from(new CFFCompiler(cff).compile())), properties, true).parse();
  expect(properties).toMatchObject({ ascent: 800, descent: -200 });
  expect(properties.ascentScaled).toBeUndefined();
});
it.each([
  { stored: [0, 0, 0, 0], descriptor: [2974, -300, 64236, 900], expected: [-1300, -300, 2974, 900] },
  { stored: [65080, 65231, 2158, 989], descriptor: [-456, -305, 2158, 989], expected: [-456, -305, 2158, 989] },
  { stored: [65080, 65231, 2158, 989], descriptor: [0, 0, 0, 0], expected: [-456, -305, 2158, 989] },
])("repairs an invalid CFF FontBBox: $stored", ({ stored, descriptor, expected }) => {
  cff.topDict.setByName("FontBBox", stored);
  const properties: Record<string, unknown> = { bbox: descriptor };
  const decoded = new CFFParser(new Stream(Uint8Array.from(new CFFCompiler(cff).compile())), properties, true).parse();
  expect(decoded.topDict.getByName("FontBBox")).toEqual(expected);
  expect(properties.ascent).toBe(expected[3]); expect(properties.descent).toBe(expected[1]);
  expect(properties.ascentScaled).toBe(true);
});
