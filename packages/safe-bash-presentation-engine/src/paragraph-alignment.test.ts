import { describe, expect, it } from "vitest";
import { PP_ALIGN, PP_PARAGRAPH_ALIGNMENT } from "./paragraph-alignment.js";

describe("paragraph alignment conversion", () => {
  it.each([
    ["LEFT", 1, "l"],
    ["CENTER", 2, "ctr"],
    ["RIGHT", 3, "r"],
    ["JUSTIFY", 4, "just"],
    ["DISTRIBUTE", 5, "dist"],
    ["THAI_DISTRIBUTE", 6, "thaiDist"],
    ["JUSTIFY_LOW", 7, "justLow"]
  ] as const)("converts %s with immutable metadata", (name, value, xml_value) => {
    expect(PP_ALIGN).toBe(PP_PARAGRAPH_ALIGNMENT);
    expect(PP_ALIGN[name]).toBe(value);
    expect(PP_ALIGN.from_xml(xml_value)).toBe(value);
    expect(PP_ALIGN.to_xml(value)).toBe(xml_value);
    expect(() => PP_ALIGN.validate(value)).not.toThrow();
    expect(PP_ALIGN.metadata(value)).toEqual({ name, value, xml_value });
    expect(Object.isFrozen(PP_ALIGN.metadata(value))).toBe(true);
  });
  it("keeps mixed as a readable return-only sentinel", () => {
    expect(PP_ALIGN.MIXED).toBe(-2);
    expect(PP_ALIGN.metadata(PP_ALIGN.MIXED)).toEqual({
      name: "MIXED",
      value: -2,
      xml_value: null
    });
    expect(() => PP_ALIGN.to_xml(PP_ALIGN.MIXED)).toThrow();
    expect(() => PP_ALIGN.validate(PP_ALIGN.MIXED)).toThrow();
  });
  it.each([0, 8, 1.5, NaN, Infinity, "1", null, undefined, {}, true])(
    "rejects unknown enum value %s",
    (value) => {
      expect(() => PP_ALIGN.to_xml(value as never)).toThrow();
      expect(() => PP_ALIGN.validate(value as never)).toThrow();
      expect(() => PP_ALIGN.metadata(value as never)).toThrow();
    }
  );
  it.each(["", "center", "CTR", " l ", "mixed", null, 1])(
    "rejects unknown XML alignment %s",
    (value) => {
      expect(() => PP_ALIGN.from_xml(value as never)).toThrow();
    }
  );
});

it("freezes numeric symbols and conversion methods", () => {
  expect(Object.isFrozen(PP_ALIGN)).toBe(true);
  expect(Reflect.set(PP_ALIGN, "CENTER", 99)).toBe(false);
  expect(Reflect.set(PP_ALIGN, "from_xml", () => 99)).toBe(false);
  expect(PP_ALIGN.CENTER).toBe(2);
  expect(PP_ALIGN.from_xml("ctr")).toBe(2);
});
