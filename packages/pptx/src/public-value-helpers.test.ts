import { describe, expect, it } from "vitest";
import { Length, Emu, Inches, Cm, Mm, Pt, Centipoints } from "./length.js";
import { ColorFormat, ColorPropertyAccessError, RGBColor } from "./text-run-color.js";
import { PropertyAccessError } from "./errors.js";
import { parseXmlPart } from "./xml.js";

const units = [Length, Emu, Inches, Cm, Mm, Pt, Centipoints] as const;

describe("public unit values", () => {
  it.each(units)("rejects implicit absence and nonfinite input in %s", (Unit) => {
    for (const input of [null, undefined, false, "0", NaN, Infinity, -Infinity])
      expect(() => new Unit(input as never)).toThrow();
    expect(new Unit(0).emu).toBe(0);
    expect(Object.is(new Unit(-0).emu, -0)).toBe(false);
  });
  it("preserves safe integer edges and both halfway directions", () => {
    for (const input of [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])
      expect(new Length(input).emu).toBe(input);
    expect(new Emu(0.5).emu).toBe(1);
    expect(new Emu(-0.5).emu).toBe(-1);
    expect(new Emu(-0.49).emu).toBe(0);
    expect(new Centipoints(-0.5).emu).toBe(-64);
    expect(new Length(-1).centipoints).toBe(-1);
  });
  it.each(units)("rejects unsafe converted values in %s", (Unit) => {
    expect(() => new Unit(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => new Unit(Number.MIN_SAFE_INTEGER - 1)).toThrow();
  });
});

describe("public RGB value protocols", () => {
  const rgb = new RGBColor(0, 17, 255);
  it.each([-1, 3, 100, 0.5, NaN, Infinity])("rejects bracket position %s", (index) => {
    expect(() => Reflect.get(rgb, String(index))).toThrowError(
      expect.objectContaining({ name: "IndexError", code: "index-out-of-range" })
    );
  });
  it.each([-4, 3, 0.5, NaN, Infinity])("reports checked at position %s", (index) => {
    expect(() => rgb.at(index)).toThrowError(
      expect.objectContaining({ name: "IndexError", code: "index-out-of-range" })
    );
  });
  it("retains valid zero positions, negative at positions and immutable channels", () => {
    expect([rgb[0], rgb[1], rgb[2], rgb.at(-3), rgb.at(-2), rgb.at(-1)]).toEqual([
      0, 17, 255, 0, 17, 255
    ]);
    expect([...rgb]).toEqual([0, 17, 255]);
    expect(Object.isFrozen(rgb)).toBe(true);
    expect(Reflect.set(rgb, "0", 1)).toBe(false);
    expect(rgb.toString()).toBe("0011FF");
  });
  it.each([
    [undefined, undefined, 1, [0, 17, 255]],
    [undefined, undefined, -1, [255, 17, 0]],
    [-20, 20, 2, [0, 255]],
    [20, -20, -2, [255, 0]],
    [undefined, -1, -1, []],
    [-2, undefined, 1, [17, 255]],
    [2, 0, 1, []],
    [0, 2, -1, []]
  ] as const)("maps slice %s %s %s", (start, end, step, expected) => {
    const snapshot = rgb.slice(start, end, step);
    expect(snapshot).toEqual(expected);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
  it.each([0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "reports invalid slice step %s",
    (step) => {
      expect(() => rgb.slice(undefined, undefined, step)).toThrowError(
        expect.objectContaining({ name: "ValueError", code: "invalid-value" })
      );
    }
  );
  it.each(["12345", "1234000", "1234560", " 0011FF", "0011FF\n", "００１１ＦＦ", "GG0011"])(
    "rejects noncanonical hex input %s",
    (input) => expect(() => RGBColor.from_string(input)).toThrow()
  );
  it("compares channel values without coercing unrelated objects", () => {
    expect(rgb.equals(new RGBColor(0, 17, 255))).toBe(true);
    expect(rgb.equals(new RGBColor(0, 17, 254))).toBe(false);
    for (const value of [null, false, 0, "0011FF", [0, 17, 255]])
      expect(rgb.equals(value as never)).toBe(false);
  });
});

it("reports absent color through the shared property error category", () => {
  const xml = parseXmlPart(
    new TextEncoder().encode(
      '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>'
    ),
    { maxBytes: 1024, maxNodes: 100, maxDepth: 10 }
  );
  const color = new ColorFormat(xml);
  expect(() => color.rgb).toThrow(PropertyAccessError);
  expect(() => color.theme_color).toThrow(PropertyAccessError);
  expect(ColorPropertyAccessError).toBe(PropertyAccessError);
});

it("uses documented color symbols for model properties and preserves XML tokens", async () => {
  const { MSO_COLOR_TYPE, MSO_THEME_COLOR_INDEX: theme } = await import("./color-enums.js");
  const xml = parseXmlPart(
    new TextEncoder().encode(
      '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="accent2"/></a:solidFill>'
    ),
    { maxBytes: 1024, maxNodes: 100, maxDepth: 10 }
  );
  const color = new ColorFormat(xml);
  expect(color.type).toBe(MSO_COLOR_TYPE.SCHEME);
  expect(color.theme_color).toBe(theme.ACCENT_2);
  color.theme_color = theme.ACCENT_5 as never;
  expect(color.theme_color).toBe(theme.ACCENT_5);
  expect(color.xml.root.children[0]!.attributes[0]!.value).toBe("accent5");
  for (const value of [theme.NOT_THEME_COLOR, theme.MIXED, 999, "accent1", null])
    expect(() => {
      color.theme_color = value as never;
    }).toThrow();
  expect(color.theme_color).toBe(theme.ACCENT_5);
  color.rgb = new RGBColor(0, 0, 0);
  expect(color.type).toBe(MSO_COLOR_TYPE.RGB);
  expect(color.theme_color).toBe(theme.NOT_THEME_COLOR);
});

it("reports invalid numeric values through the documented value category", () => {
  for (const construct of [
    () => new Length(Infinity),
    () => new Length(Number.MAX_SAFE_INTEGER + 1),
    () => new RGBColor(-1, 0, 0),
    () => new RGBColor(0, 256, 0),
    () => new RGBColor(0, 0, 0.5)
  ])
    expect(construct).toThrowError(
      expect.objectContaining({ name: "ValueError", code: "invalid-value" })
    );
});

it.each(units)("distinguishes nonnumeric constructor inputs in %s", (Unit) => {
  for (const input of [null, undefined, false, "0", {}, 0n])
    expect(() => new Unit(input as never)).toThrowError(
      expect.objectContaining({ name: "TypeError", code: "invalid-type" })
    );
});
it("distinguishes wrong RGB channel types at every position", () => {
  for (const input of [null, undefined, false, "0", {}, 0n])
    for (const channels of [
      [input, 0, 0],
      [0, input, 0],
      [0, 0, input]
    ])
      expect(() => new RGBColor(...(channels as [number, number, number]))).toThrowError(
        expect.objectContaining({ name: "TypeError", code: "invalid-type" })
      );
});
it("distinguishes nonstring RGB parsing inputs from malformed hexadecimal", () => {
  for (const input of [null, undefined, false, 0, {}, ["0011FF"]])
    expect(() => RGBColor.from_string(input as never)).toThrowError(
      expect.objectContaining({ name: "TypeError", code: "invalid-type" })
    );
  for (const input of ["12345", "0011FF0", "GG0011"])
    expect(() => RGBColor.from_string(input)).toThrowError(
      expect.objectContaining({ name: "ValueError", code: "invalid-value" })
    );
});
