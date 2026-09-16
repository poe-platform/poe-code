import { expect, it } from "vitest";
import { Adjustment, AdjustmentCollection } from "./shape-adjustments.js";
import { Shape, applyShapeUpdate, validateShapeOptions } from "./shapes.js";
import { parseXmlPart } from "./xml.js";
import { IndexError, ValueError } from "./errors.js";
import { shapePresets } from "./shape-presets.js";
import { shapeAdjustmentDefaults } from "./shape-adjustment-defaults.js";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
function shape(preset = "chevron", guides = "") {
  return new Shape(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}"><p:spPr><a:prstGeom prst="${preset}"><a:avLst>${guides}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>`
      ),
      { maxBytes: 10000, maxNodes: 100, maxDepth: 16 }
    )
  );
}
it("exposes normalized values, raw values and truncating assignment without clamping", () => {
  const adjustment = new Adjustment("radius", 32100);
  expect(adjustment.effective_value).toBe(0.321);
  expect(adjustment.val).toBe(32100);
  adjustment.effective_value = -1.234567;
  expect(adjustment.val).toBe(-123456);
  expect(adjustment.effective_value).toBe(-1.23456);
  expect(new Adjustment("radius", 32100, 0).val).toBe(0);
  expect(() => {
    adjustment.effective_value = NaN;
  }).toThrow(ValueError);
  expect(() => {
    adjustment.effective_value = Number.MAX_VALUE;
  }).toThrow(ValueError);
  expect(() => {
    adjustment.effective_value = "1" as unknown as number;
  }).toThrow();
});
it("loads declared defaults for every supported shape preset and iterates in guide order", () => {
  for (const [key, preset] of Object.entries(shapePresets)) {
    const values = shape(preset).adjustments;
    expect([...values]).toEqual(
      (shapeAdjustmentDefaults[key] ?? []).map(([, value]) => value / 100000)
    );
    expect(values.length).toBe((shapeAdjustmentDefaults[key] ?? []).length);
  }
  expect([...shape("wedgeRoundRectCallout").adjustments]).toEqual([-0.20833, 0.625, 0.16667]);
  expect([...shape("circularArrow").adjustments]).toEqual([0.125, 11.42319, 204.57681, 108, 0.125]);
});
it("numeric assignment writes the complete ordered effective guide list and preserves shape paint", () => {
  const owner = shape(
    "wedgeRoundRectCallout",
    '<a:gd name="adj2" fmla="val 0"/><a:gd name="extra" fmla="val 50"/>'
  );
  const adjustments = owner.adjustments;
  expect(owner.adjustments).toBe(adjustments);
  expect(adjustments[1]).toBe(0);
  expect(adjustments.at(-1)).toBe(0.16667);
  adjustments[0] = -2.34;
  expect([...adjustments]).toEqual([-2.34, 0, 0.16667]);
  const xml = owner.xml.markup(owner.element);
  expect(xml).toContain('name="adj1" fmla="val -234000"');
  expect(xml).toContain('name="adj3" fmla="val 16667"');
  expect(xml).not.toContain('name="extra"');
  expect(xml).toContain('val="112233"');
});
it("validates indices and formulas without partial edits", () => {
  const owner = shape();
  const before = owner.xml.bytes();
  expect(() => owner.adjustments[5]).toThrow(IndexError);
  expect(() => owner.adjustments[-1]).toThrow(IndexError);
  expect(() => {
    owner.adjustments[2] = 0.5;
  }).toThrow(IndexError);
  expect(() => {
    owner.adjustments[0] = Infinity;
  }).toThrow(ValueError);
  expect(owner.xml.bytes()).toEqual(before);
  expect(() => shape("chevron", '<a:gd name="adj" fmla="*/ width 2 3"/>').adjustments[0]).toThrow();
});

it("applies typed operation adjustments to the selected shape without changing its siblings", () => {
  const owner = shape("chevron");
  const result = applyShapeUpdate(owner.xml, owner.element, { adjustments: [0.73] });
  expect(new Shape(result).adjustments[0]).toBe(0.73);
  expect(() => applyShapeUpdate(owner.xml, owner.element, { adjustments: [0.1, 0.2] })).toThrow();
  expect(owner.adjustments[0]).toBe(0.5);
});
it("retains exact unassigned guide integers when normalization would lose a unit", () => {
  const owner = shape("downArrowCallout");
  owner.adjustments[0] = 0.1;
  expect(owner.xml.markup(owner.element)).toContain('name="adj4" fmla="val 64977"');
});
it("does not expose XML owner callbacks as runtime properties", () => {
  const adjustments = shape().adjustments;
  expect("read" in adjustments).toBe(false);
  expect("write" in adjustments).toBe(false);
});

it("rejects sparse and over-budget adjustment arrays during preflight", () => {
  expect(() => validateShapeOptions({ adjustments: new Array<number>(1) })).toThrow();
  expect(() =>
    validateShapeOptions({ adjustments: Array.from({ length: 4097 }, () => 0) })
  ).toThrow();
  const inherited = new Array<number>(1);
  Object.setPrototypeOf(inherited, { 0: 0.5, __proto__: Array.prototype });
  expect(() => validateShapeOptions({ adjustments: inherited })).toThrow();
});

it("rejects invalid replacement arrays before reading the XML owner", () => {
  const xml = shape().xml;
  let reads = 0;
  const values = new AdjustmentCollection(
    () => {
      reads++;
      return xml;
    },
    () => {
      throw new Error("Unexpected write");
    }
  );
  reads = 0;
  expect(() => values.replace(new Array<number>(1))).toThrow();
  expect(() => values.replace(Array.from({ length: 4097 }, () => 0))).toThrow();
  expect(reads).toBe(0);
});
