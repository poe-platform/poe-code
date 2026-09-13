import { describe, expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import {
  ColorFormat,
  colorMerge,
  colorBrightnessMerge,
  readRunColor,
  RGBColor,
  validateRunColor
} from "./text-run-color.js";

const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (body: string) =>
  parseXmlPart(new TextEncoder().encode(`<a:solidFill xmlns:a="${ns}">${body}</a:solidFill>`), {
    maxBytes: 8192,
    maxNodes: 100,
    maxDepth: 12
  });
const choices = [
  ["none", "", null],
  ["hsl", '<a:hslClr hue="7200000" sat="40000" lum="60000"/>', "HSL"],
  ["preset", '<a:prstClr val="blue"/>', "PRESET"],
  ["theme", '<a:schemeClr val="accent1"/>', "SCHEME"],
  ["linear", '<a:scrgbClr r="10000" g="20000" b="30000"/>', "SCRGB"],
  ["rgb", '<a:srgbClr val="123456"/>', "RGB"],
  ["system", '<a:sysClr val="windowText" lastClr="445566"/>', "SYSTEM"]
] as const;
const attributes = (node: ReturnType<typeof parse>["root"]) =>
  Object.fromEntries(
    node.attributes.filter((a) => a.name.namespace === "").map((a) => [a.name.localName, a.value])
  );

describe("run color values", () => {
  it.each(choices)("exposes bounded color model properties for %s", (_label, xml, type) => {
    const color = new ColorFormat(parse(xml));
    expect(color.type).toBe(type);
    if (type === "RGB") expect(color.rgb.toString()).toBe("123456");
    else expect(() => color.rgb).toThrowError("RGB color is unavailable.");
    if (type === null) {
      expect(() => color.theme_color).toThrowError("Theme color is unavailable.");
      expect(() => {
        color.brightness = 0.5;
      }).toThrow();
    } else expect(color.theme_color).toBe(type === "SCHEME" ? "accent1" : "NOT_THEME_COLOR");
  });
  it.each(choices)("sets bounded color model RGB and theme for %s", (_label, xml) => {
    const color = new ColorFormat(parse(xml));
    color.rgb = new RGBColor(18, 52, 86);
    expect(color.xml.root.children.map((n) => [n.name.localName, attributes(n)])).toEqual([
      ["srgbClr", { val: "123456" }]
    ]);
    color.theme_color = "accent6";
    expect(color.xml.root.children.map((n) => [n.name.localName, attributes(n)])).toEqual([
      ["schemeClr", { val: "accent6" }]
    ]);
  });
  it("rejects arbitrary RGB assignments and brightness bounds in the model", () => {
    const color = new ColorFormat(parse('<a:srgbClr val="123456"/>'));
    expect(() => {
      color.rgb = [18, 52, 86] as unknown as RGBColor;
    }).toThrow();
    for (const value of [-1.1, 1.1])
      expect(() => {
        color.brightness = value;
      }).toThrow();
  });
  it.each(choices)("reads the %s color choice without converting it", (_label, xml, type) => {
    const doc = parse(xml);
    expect(readRunColor(doc.root)?.type ?? null).toBe(type);
    expect(readRunColor(doc.root)?.rgb ?? null).toBe(type === "RGB" ? "123456" : null);
    expect(readRunColor(doc.root)?.theme ?? null).toBe(type === "SCHEME" ? "accent1" : null);
  });
  it.each(choices)("replaces %s with a literal RGB choice", (_label, xml) => {
    const doc = parse(xml);
    const result = doc.merge(doc.root, colorMerge("abcdef", ns));
    expect(result.root.children.map((n) => [n.name.localName, attributes(n)])).toEqual([
      ["srgbClr", { val: "ABCDEF" }]
    ]);
  });
  it.each(choices)("replaces %s with a theme choice", (_label, xml) => {
    const doc = parse(xml);
    const result = doc.merge(doc.root, colorMerge({ theme: "accent6" }, ns));
    expect(result.root.children.map((n) => [n.name.localName, attributes(n)])).toEqual([
      ["schemeClr", { val: "accent6" }]
    ]);
  });
  it.each([
    ["hslClr", 'hue="7200000" sat="40000" lum="60000"', 55000, 45000, 0.45],
    ["prstClr", 'val="blue"', null, null, 0],
    ["schemeClr", 'val="accent1"', 15000, null, -0.85],
    ["scrgbClr", 'r="10000" g="20000" b="30000"', 15000, 85000, 0.85],
    ["srgbClr", 'val="123456"', null, null, 0],
    ["sysClr", 'val="windowText"', 23000, null, -0.77]
  ] as const)("reads brightness for %s", (kind, attrs, mod, off, expected) => {
    const doc = parse(
      `<a:${kind} ${attrs}>${mod === null ? "" : `<a:lumMod val="${mod}"/>`}${off === null ? "" : `<a:lumOff val="${off}"/>`}</a:${kind}>`
    );
    expect(readRunColor(doc.root)?.brightness).toBeCloseTo(expected);
  });
  it.each([
    ["srgbClr", null, null, 0, []],
    ["hslClr", null, null, -0.4, [["lumMod", "60000"]]],
    [
      "prstClr",
      85000,
      15000,
      0.25,
      [
        ["lumMod", "75000"],
        ["lumOff", "25000"]
      ]
    ],
    ["schemeClr", 85000, 15000, -0.15, [["lumMod", "85000"]]],
    [
      "scrgbClr",
      75000,
      null,
      0.4,
      [
        ["lumMod", "60000"],
        ["lumOff", "40000"]
      ]
    ],
    ["srgbClr", 70000, null, -0.4, [["lumMod", "60000"]]],
    ["sysClr", 60000, null, 0, []]
  ] as const)("updates %s brightness from %s/%s to %s", (kind, mod, off, value, expected) => {
    const doc = parse(
      `<a:${kind} val="123456" custom="kept">${mod === null ? "" : `<a:lumMod val="${mod}"/>`}${off === null ? "" : `<a:lumOff val="${off}"/>`}<a:alpha val="75000"/></a:${kind}>`
    );
    const result = doc.merge(doc.root.children[0]!, colorBrightnessMerge(value, ns));
    const clr = result.root.children[0]!;
    expect(attributes(clr)).toEqual({ val: "123456", custom: "kept" });
    expect(
      clr.children
        .filter((n) => n.name.localName !== "alpha")
        .map((n) => [n.name.localName, attributes(n).val])
    ).toEqual(expected);
    expect(clr.children.find((n) => n.name.localName === "alpha")?.attributes[0]?.value).toBe(
      "75000"
    );
  });
  it("preserves foreign color extension content when replacing the known choice", () => {
    const doc = parse('<a:srgbClr val="123456"/><x:srgbClr xmlns:x="urn:extension" val="opaque"/>');
    const result = doc.merge(doc.root, colorMerge({ rgb: "223344", brightness: 0.4 }, ns));
    expect(
      result.root.children.find((n) => n.name.namespace === "urn:extension")?.attributes[0]?.value
    ).toBe("opaque");
    expect(readRunColor(result.root)).toEqual({
      type: "RGB",
      rgb: "223344",
      theme: null,
      brightness: 0.4
    });
  });
  it.each([1.1, -1.1, NaN, Infinity])("rejects brightness %s", (value) => {
    expect(() => colorBrightnessMerge(value, ns)).toThrow();
    expect(() => validateRunColor({ rgb: "123456", brightness: value })).toThrow();
  });
  it.each([
    "12345",
    "1234000",
    "1234560",
    "GGGGGG",
    "12345 ",
    123456,
    null,
    { rgb: "123456", theme: "accent1" },
    { theme: "unknown" },
    { rgb: "123456", extra: true }
  ])("rejects invalid color %j", (value) => {
    expect(() => validateRunColor(value)).toThrow();
  });
  it.each([
    ["deadbf", "DEADBF"],
    ["012345", "012345"],
    ["0a1b3c", "0A1B3C"],
    ["ABCDEF", "ABCDEF"],
    ["0A1B3C", "0A1B3C"]
  ])("normalizes exact hexadecimal %s to %s", (input, expected) => {
    validateRunColor(input);
    const doc = parse("");
    const result = doc.merge(doc.root, colorMerge(input, ns));
    expect(attributes(result.root.children[0]!).val).toBe(expected);
  });
  it.each(["F00BAR", "F00b"])("rejects malformed hexadecimal %s", (input) => {
    expect(() => validateRunColor(input)).toThrow();
  });
  it("preserves exact XML color tokens and percentage boundaries", () => {
    const theme = new ColorFormat(parse('<a:schemeClr val="bg1"/>'));
    expect(theme.theme_color).toBe("bg1");
    theme.theme_color = "accent1";
    expect(attributes(theme.xml.root.children[0]!)).toEqual({ val: "accent1" });
    const color = new ColorFormat(parse('<a:srgbClr val="123456"/>'));
    color.rgb = RGBColor.from_string("987654");
    expect(attributes(color.xml.root.children[0]!)).toEqual({ val: "987654" });
    for (const [tag, token, expected] of [
      ["lumMod", "33333", -0.66667],
      ["lumOff", "66666", 0.66666],
      ["lumMod", "99999", -0.00001]
    ] as const) {
      const view = new ColorFormat(
        parse(`<a:schemeClr val="bg1"><a:${tag} val="${token}"/></a:schemeClr>`)
      );
      expect(view.brightness).toBeCloseTo(expected);
    }
  });
  it.each([
    ["srgbClr", -0.25, [["lumMod", "75000"]]],
    [
      "schemeClr",
      0.4,
      [
        ["lumMod", "60000"],
        ["lumOff", "40000"]
      ]
    ],
    ["srgbClr", 0, []]
  ] as const)("reopens independently expected %s brightness XML at %s", (kind, value, expected) => {
    const color = new ColorFormat(
      parse(`<a:${kind} val="${kind === "schemeClr" ? "accent2" : "123456"}"/>`)
    );
    color.brightness = value;
    expect(
      color.xml.root.children[0]!.children.map((n) => [n.name.localName, attributes(n).val])
    ).toEqual(expected);
    const reopened = new ColorFormat(
      parseXmlPart(color.xml.bytes(), { maxBytes: 8192, maxNodes: 100, maxDepth: 12 })
    );
    expect(reopened.brightness).toBeCloseTo(value);
  });
  it("provides checked RGB value protocols", () => {
    const color = new RGBColor(18, 52, 86);
    expect(color.length).toBe(3);
    expect([color[0], color[1], color[2]]).toEqual([18, 52, 86]);
    expect(color.at(-1)).toBe(86);
    expect(color.slice(0, 2)).toEqual([18, 52]);
    expect(color.slice(undefined, undefined, -1)).toEqual([86, 52, 18]);
    expect(color.equals(new RGBColor(18, 52, 86))).toBe(true);
    expect(color.equals(new RGBColor(18, 52, 87))).toBe(false);
    expect(() => color.at(3)).toThrow();
    expect(() => color.at(0.5)).toThrow();
    expect(() => color.slice(0, 3, 0)).toThrow();
  });
  it("uses bounded immutable RGB channel values and exact hexadecimal parsing", () => {
    const rgb = new RGBColor(18, 52, 86);
    expect([...rgb]).toEqual([18, 52, 86]);
    expect(rgb.toString()).toBe("123456");
    expect(RGBColor.from_string("abcdef").toString()).toBe("ABCDEF");
    for (const channels of [
      [-1, 34, 56],
      [12, 256, 56],
      [12, 34, 0.5],
      ["12", "34", "56"]
    ]) {
      expect(() => new RGBColor(...(channels as [number, number, number]))).toThrow();
    }
    expect(Object.isFrozen(rgb)).toBe(true);
  });
});
