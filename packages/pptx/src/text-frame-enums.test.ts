import { expect, it } from "vitest";
import { MSO_ANCHOR, MSO_AUTO_SIZE, MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";

it.each([
  ["TOP", 1, "t"],
  ["MIDDLE", 3, "ctr"],
  ["BOTTOM", 4, "b"],
  ["MIXED", -2, null]
] as const)("exposes immutable anchor %s", (name, value, xml_value) => {
  expect(MSO_VERTICAL_ANCHOR[name]).toBe(value);
  const metadata = MSO_VERTICAL_ANCHOR.metadata(value);
  expect(metadata).toEqual({ name, value, xml_value });
  expect(Object.isFrozen(metadata)).toBe(true);
  if (xml_value === null) {
    expect(() => MSO_VERTICAL_ANCHOR.to_xml(value)).toThrow();
    expect(() => MSO_VERTICAL_ANCHOR.validate(value)).toThrow();
  } else {
    expect(MSO_VERTICAL_ANCHOR.to_xml(value)).toBe(xml_value);
    expect(MSO_VERTICAL_ANCHOR.from_xml(xml_value)).toBe(value);
    expect(MSO_VERTICAL_ANCHOR.validate(value)).toBeUndefined();
  }
});
it.each([
  ["NONE", 0],
  ["SHAPE_TO_FIT_TEXT", 1],
  ["TEXT_TO_FIT_SHAPE", 2],
  ["MIXED", -2]
] as const)("exposes immutable sizing %s", (name, value) => {
  expect(MSO_AUTO_SIZE[name]).toBe(value);
  expect(MSO_AUTO_SIZE.metadata(value)).toEqual({ name, value });
  expect(Object.isFrozen(MSO_AUTO_SIZE.metadata(value))).toBe(true);
});
it("shares the anchor alias and rejects unknown enum conversions", () => {
  expect(MSO_ANCHOR).toBe(MSO_VERTICAL_ANCHOR);
  expect(Object.isFrozen(MSO_AUTO_SIZE)).toBe(true);
  expect(Object.isFrozen(MSO_VERTICAL_ANCHOR)).toBe(true);
  expect(() => MSO_VERTICAL_ANCHOR.from_xml("middle")).toThrow();
  expect(() => MSO_VERTICAL_ANCHOR.metadata(999 as MSO_VERTICAL_ANCHOR)).toThrow();
  expect(() => MSO_AUTO_SIZE.metadata(999 as MSO_AUTO_SIZE)).toThrow();
});
