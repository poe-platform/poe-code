import { describe, expect, it } from "vitest";
import { readXmlCoordinate } from "./xml-scalars.js";
import { parseXmlPart } from "./xml.js";
import { readShapeGeometry } from "./shape-transforms.js";
import { readRunColor, RGBColor } from "./text-run-color.js";

const limits = { maxBytes: 8192, maxNodes: 100, maxDepth: 12 };
const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main";
const parse = (text: string) => parseXmlPart(new TextEncoder().encode(text), limits);
function geometry(value: string, width = "100", rotation = "0") {
  const xml = parse(
    `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:spPr><a:xfrm rot="${rotation}"><a:off x="${value}" y="0"/><a:ext cx="${width}" cy="200"/></a:xfrm></p:spPr></p:sp>`
  );
  return readShapeGeometry(xml.root, xml.root);
}

describe("XML scalar admission through drawing readers", () => {
  it.each([
    ["42", 42],
    ["-42", -42],
    ["-0042", -42],
    ["1.2in", 1097280],
    ["42mm", 1512000],
    ["0024cm", 8640000],
    ["-42pt", -533400],
    ["-036.214pc", -5519014],
    ["0pi", 0]
  ] as const)("reads coordinate %s as %s EMU", (value, expected) => {
    expect(geometry(value)?.corners[0]).toEqual({ x: expected, y: 0 });
  });
  it.each(["", "word", "42.42", "0x0a3", "1e3", "Infinity", "9007199254740992"])(
    "rejects invalid coordinate token %s",
    (value) => expect(() => geometry(value)).toThrow()
  );
  it.each([
    ["12.34%", 0.1234],
    ["42%", 0.42],
    ["024%", 0.24],
    ["-42%", -0.42],
    ["-036.214%", -0.36214],
    ["0%", 0],
    ["42000", 0.42]
  ] as const)("reads literal brightness %s", (value, expected) => {
    const xml = parse(
      `<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="123456"><a:lumOff val="${value}"/></a:srgbClr></a:solidFill>`
    );
    expect(readRunColor(xml.root)?.brightness).toBeCloseTo(expected, 8);
  });
  it.each(["", "0x10", "1e3", "NaN", "2%%"])("rejects malformed brightness %s", (value) => {
    const xml = parse(
      `<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="123456"><a:lumOff val="${value}"/></a:srgbClr></a:solidFill>`
    );
    expect(() => readRunColor(xml.root)).toThrowError(
      expect.objectContaining({ code: "invalid-xml" })
    );
  });
  it.each(["012345", "ABCDEF", "deadbf", "0A1B3C", "0a1b3c"])("canonicalizes RGB %s", (value) => {
    expect(RGBColor.from_string(value).toString()).toBe(value.toUpperCase());
  });
  it.each([null, 123456, "F00BAR", "F00b"])("rejects invalid RGB %s", (value) => {
    expect(() => RGBColor.from_string(value as never)).toThrow();
  });
});

it.each([
  ["0.00005cm", 18],
  ["0.00005mm", 2],
  ["-0.00005mm", -2],
  ["0.000125mm", 5],
  ["-0.000125mm", -5],
  ["9007199254740991", 9007199254740991]
] as const)("uses safe coordinate rounding for %s", (value, expected) => {
  expect(readXmlCoordinate(value)).toBe(expected);
});
it.each(["1IN", "1PT", "1e2mm", ".mm", "1..2in", "9007199254740992mm"])(
  "rejects unsupported coordinate spelling %s",
  (value) => expect(() => geometry(value)).toThrow()
);

it("requires integer extent tokens even when offsets admit units", () => {
  expect(() => geometry("1.2in", "2in")).toThrow();
});

it.each(["0x10", "1e3", "1pt"])("rejects nondecimal rotation %s", (value) => {
  expect(() => geometry("0", "100", value)).toThrow();
});

it.each([" 42 ", "\t42\n", " 1.2in ", "\r1.2in\t", "&#9;42&#10;", "&#13;1.2in&#9;"])(
  "collapses surrounding XML numeric whitespace %s",
  (value) => {
    expect(geometry(value)?.corners[0]).toEqual({ x: value.includes("in") ? 1097280 : 42, y: 0 });
  }
);
it.each(["4 2", "1 .2in", "1.2 in", "\u00a042\u00a0"])(
  "rejects nonlexical coordinate whitespace %s",
  (value) => {
    expect(() => geometry(value)).toThrow();
  }
);
it("collapses percentage XML whitespace without accepting internal gaps", () => {
  const valid = parse(
    `<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="123456"><a:lumOff val=" 42% "/></a:srgbClr></a:solidFill>`
  );
  expect(readRunColor(valid.root)?.brightness).toBe(0.42);
  const invalid = parse(
    `<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="123456"><a:lumOff val="42 %"/></a:srgbClr></a:solidFill>`
  );
  expect(() => readRunColor(invalid.root)).toThrow();
});
