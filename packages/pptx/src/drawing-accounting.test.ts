import { describe, expect, it } from "vitest";
import { applyDrawingUpdate, readDrawingFormat, type DrawingUpdate } from "./drawing-format.js";
import { MSO_PATTERN, MSO_LINE } from "./drawing-enums.js";
import { Length } from "./length.js";
import { Shape } from "./shapes.js";
import { parseXmlPart } from "./xml.js";

function shape(properties = "", group = false) {
  const tag = group ? "grpSp" : "sp";
  const props = group ? "grpSpPr" : "spPr";
  return new Shape(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:${tag} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:${props} marker="retained">${properties}</p:${props}></p:${tag}>`
      ),
      { maxBytes: 16000, maxNodes: 200, maxDepth: 16 }
    )
  );
}
const choices = [
  "",
  "<a:noFill/>",
  "<a:solidFill/>",
  "<a:gradFill/>",
  "<a:blipFill/>",
  "<a:pattFill/>",
  "<a:grpFill/>"
];

describe("drawing model behavior accounting", () => {
  it.each(choices)(
    "replaces each existing fill choice without losing owner attributes: %s",
    (xml) => {
      for (const [method, type] of [
        ["background", 5],
        ["gradient", 3],
        ["solid", 1],
        ["patterned", 2]
      ] as const) {
        const model = shape(xml);
        model.fill[method]();
        expect(model.fill.type).toBe(type);
        expect(
          model.xml.root.children[0]!.attributes.find((a) => a.name.localName === "marker")?.value
        ).toBe("retained");
        expect(
          model.xml.root.children[0]!.children.filter((n) => n.name.localName.endsWith("Fill"))
        ).toHaveLength(1);
      }
    }
  );
  it.each([
    ["", null],
    ['<a:lin ang="0"/>', 0],
    ['<a:lin ang="2730000"/>', 314.5],
    ['<a:lin ang="16200000"/>', 90]
  ] as const)("reads counterclockwise gradient angle %s", (xml, expected) => {
    expect(shape(`<a:gradFill>${xml}</a:gradFill>`).fill.gradient_angle).toBe(expected);
  });
  it.each([
    [301.2, 3528000],
    [31.22, 19726800],
    [0, 0],
    [-460, 6000000],
    [42.42, 19054800],
    [270, 5400000],
    [480, 14400000],
    [-90, 5400000],
    [-942.4, 13344000]
  ] as const)("serializes angle %s independently as %s", (angle, expected) => {
    const model = shape('<a:gradFill><a:lin ang="0"/></a:gradFill>');
    model.fill.gradient_angle = angle;
    const gradient = model.xml.root.children[0]!.children[0]!;
    expect(
      gradient.children
        .find((n) => n.name.localName === "lin")
        ?.attributes.find((a) => a.name.localName === "ang")?.value
    ).toBe(String(expected));
    expect(model.fill.gradient_angle).toBeCloseTo(((angle % 360) + 360) % 360);
  });
  it("rejects gradient properties for a solid fill and angle for a path gradient", () => {
    for (const model of [
      shape("<a:solidFill/>"),
      shape('<a:gradFill><a:path path="circle"/></a:gradFill>')
    ]) {
      expect(() => model.fill.gradient_angle).toThrow();
      expect(() => {
        model.fill.gradient_angle = 12;
      }).toThrow();
    }
    expect(() => shape("<a:solidFill/>").fill.gradient_stops).toThrow();
  });
  it("distinguishes missing stops from an explicitly empty stop list", () => {
    expect(shape("<a:gradFill/>").fill.gradient_stops.length).toBe(2);
    expect(shape("<a:gradFill><a:gsLst/></a:gradFill>").fill.gradient_stops.length).toBe(0);
  });
  it.each([
    [0, 0.42, 42000],
    [42240, 1, 100000],
    [100000, 0, 0]
  ] as const)("reads and changes gradient position %s", (raw, value, expected) => {
    const model = shape(
      `<a:gradFill><a:gsLst><a:gs pos="${raw}"><a:schemeClr val="accent3"/></a:gs></a:gsLst></a:gradFill>`
    );
    const stop = model.fill.gradient_stops.at(0);
    expect(stop.position).toBe(raw / 100000);
    stop.position = value;
    expect(stop.position).toBe(expected / 100000);
    expect(stop.color.theme_color).toBe("accent3");
  });
  it.each([-0.42, 1.001, NaN, Infinity])("rejects out-of-bounds stop %s", (position) => {
    const model = shape();
    model.fill.gradient();
    expect(() => {
      model.fill.gradient_stops.at(0).position = position;
    }).toThrow();
  });
  it.each([false, true])("preserves explicit shadow inheritance states for group=%s", (group) => {
    for (const present of [false, true])
      for (const inherit of [false, true]) {
        const model = shape(present ? "<a:effectLst/>" : "", group);
        expect(model.shadow.inherit).toBe(!present);
        model.shadow.inherit = inherit;
        expect(model.shadow.inherit).toBe(inherit);
        expect(
          model.xml.root.children[0]!.children.some((n) => n.name.localName === "effectLst")
        ).toBe(!inherit);
      }
  });
  it.each(["fore_color", "back_color"] as const)(
    "creates only missing pattern %s containers",
    (property) => {
      const missing = shape("<a:pattFill/>");
      expect(missing.fill[property].rgb.toString()).toBe(
        property === "fore_color" ? "000000" : "FFFFFF"
      );
      const tag = property === "fore_color" ? "fgClr" : "bgClr";
      const empty = shape(`<a:pattFill><a:${tag}/></a:pattFill>`);
      expect(empty.fill[property].type).toBeNull();
      const themed = shape(
        `<a:pattFill><a:${tag}><a:schemeClr val="accent2"/></a:${tag}></a:pattFill>`
      );
      expect(themed.fill[property].theme_color).toBe("accent2");
    }
  );
  it("changes and clears pattern without inventing a missing preset", () => {
    const model = shape("<a:pattFill/>");
    expect(model.fill.pattern).toBeNull();
    for (const pattern of [MSO_PATTERN.WAVE, MSO_PATTERN.DIVOT, null] as const) {
      model.fill.pattern = pattern;
      expect(model.fill.pattern).toBe(pattern);
    }
  });
});

it.each([
  '<a:outerShdw blurRad="2"><a:schemeClr val="accent1"><a:alpha val="50000"/><a:extension/></a:schemeClr></a:outerShdw>',
  '<a:outerShdw blurRad="2"><a:schemeClr val="accent1"/><a:extension/></a:outerShdw>',
  '<a:outerShdw blurRad="2"><a:schemeClr val="accent1"/><x:outerShdw xmlns:x="urn:paint-extra" keep="yes"/></a:outerShdw>'
])("never discards unsupported nested shadow payload %s", (payload) => {
  const model = shape(`<a:effectLst>${payload}</a:effectLst>`);
  const before = model.xml.bytes();
  try {
    const changed = applyDrawingUpdate(model.xml, model.xml.root, {
      shadow: { blur: { value: 1, unit: "pt" }, color: "102030", opacity: 0.2 }
    });
    expect(changed.markup(changed.root)).toContain(payload);
  } catch (error) {
    expect(error).toMatchObject({ code: "unsupported-edit" });
  }
  expect(model.xml.bytes()).toEqual(before);
});
it("retains foreign fill and effect lookalikes alongside requested edits", () => {
  const payload =
    '<x:solidFill xmlns:x="urn:paint-extra" keep="yes"/><x:effectLst xmlns:x="urn:paint-extra"><x:outerShdw/></x:effectLst>';
  const model = shape(payload);
  const changed = applyDrawingUpdate(model.xml, model.xml.root, {
    fill: { kind: "solid", color: "102030" },
    shadow: { blur: { value: 0, unit: "pt" }, color: "405060", opacity: 0 }
  });
  expect(changed.markup(changed.root)).toContain(payload);
});
it.each([359.999999, 360, -360])(
  "normalizes gradient angles at revolution boundaries %s",
  (angle) => {
    const model = shape();
    const changed = applyDrawingUpdate(model.xml, model.xml.root, {
      fill: {
        kind: "gradient",
        angle,
        stops: [
          { position: 0, color: "102030" },
          { position: 1, color: "405060" }
        ]
      }
    });
    const gradient = changed.root.children[0]!.children.find(
      (n) => n.name.localName === "gradFill"
    )!;
    expect(
      gradient.children
        .find((n) => n.name.localName === "lin")
        ?.attributes.find((a) => a.name.localName === "ang")?.value
    ).toBe("0");
  }
);
it.each([NaN, Infinity, -Infinity, -1, "1", null])(
  "rejects coercing or nonfinite line widths %s",
  (value) => {
    const model = shape();
    expect(() =>
      applyDrawingUpdate(model.xml, model.xml.root, {
        line: { width: { value, unit: "pt" } }
      } as unknown as DrawingUpdate)
    ).toThrow();
  }
);
it.each([NaN, Infinity, -Infinity, -0.001, 1.001, "0.5", null])(
  "rejects coercing or unbounded shadow opacity %s",
  (opacity) => {
    const model = shape();
    expect(() =>
      applyDrawingUpdate(model.xml, model.xml.root, {
        shadow: { blur: { value: 0, unit: "pt" }, color: "102030", opacity }
      } as unknown as DrawingUpdate)
    ).toThrow();
  }
);
it.each([
  ["", null],
  ["<a:ln/>", null],
  ["<a:ln><a:prstDash/></a:ln>", null],
  ['<a:ln><a:prstDash val="dash"/></a:ln>', 4],
  ['<a:ln><a:prstDash val="solid"/></a:ln>', 1]
] as const)("reads line dash without creating defaults %s", (xml, expected) => {
  const model = shape(xml),
    before = model.xml.bytes();
  expect(model.line.dash_style).toBe(expected);
  expect(model.xml.bytes()).toEqual(before);
});
it.each([
  ["", MSO_LINE.DASH, "dash"],
  ["<a:ln/>", MSO_LINE.ROUND_DOT, "sysDot"],
  ["<a:ln><a:prstDash/></a:ln>", MSO_LINE.SOLID, "solid"],
  ["<a:ln><a:custDash/></a:ln>", MSO_LINE.DASH_DOT, "dashDot"],
  ['<a:ln><a:prstDash val="dash"/></a:ln>', MSO_LINE.LONG_DASH, "lgDash"],
  ['<a:ln><a:prstDash val="dash"/></a:ln>', null, null],
  ["<a:ln><a:custDash/></a:ln>", null, null]
] as const)("sets and clears preset dash from %s", (xml, value, token) => {
  const model = shape(xml);
  model.line.dash_style = value;
  expect(model.line.dash_style).toBe(value);
  const line = model.xml.root.children[0]!.children.find((n) => n.name.localName === "ln")!;
  expect(
    line.children
      .find((n) => n.name.localName === "prstDash")
      ?.attributes.find((a) => a.name.localName === "val")?.value ?? null
  ).toBe(token);
  expect(line.children.some((n) => n.name.localName === "custDash")).toBe(false);
});
it.each([
  [null, null],
  [null, 12700],
  [12700, 12700],
  [12700, 25400],
  [25400, null],
  [12700, 29718]
] as const)("reads and sets line width %s to %s", (initial, value) => {
  const model = shape(`<a:ln${initial === null ? "" : ` w="${initial}"`}/>`);
  expect(model.line.width.emu).toBe(initial ?? 0);
  model.line.width = value === null ? null : new Length(value);
  expect(model.line.width.emu).toBe(value ?? 0);
});
it.each(["", "<a:noFill/>", '<a:solidFill><a:schemeClr val="accent4"/></a:solidFill>'])(
  "line color accessor creates a solid choice only when required %s",
  (fill) => {
    const model = shape(`<a:ln>${fill}</a:ln>`);
    const color = model.line.color;
    expect(model.line.fill.type).toBe(1);
    expect(color.type).toBe(fill.includes("schemeClr") ? "SCHEME" : null);
    if (fill.includes("schemeClr")) expect(color.theme_color).toBe("accent4");
  }
);
it("new pattern fill keeps its preset inherited and unavailable properties fail", () => {
  const model = shape();
  model.fill.patterned();
  expect(model.fill.pattern).toBeNull();
  model.fill.solid();
  expect(() => model.fill.pattern).toThrow();
  expect(() => model.fill.back_color).toThrow();
});
it("default model gradient has an upward angle and documented themed transforms", () => {
  const model = shape();
  model.fill.gradient();
  expect(model.fill.gradient_angle).toBe(90);
  const fill = model.xml.root.children[0]!.children[0]!;
  const colors = fill.children
    .find((n) => n.name.localName === "gsLst")!
    .children.map((n) => n.children[0]!);
  expect(colors.map((n) => n.attributes.find((a) => a.name.localName === "val")?.value)).toEqual([
    "accent1",
    "accent1"
  ]);
  expect(
    colors.map((n) =>
      n.children.map((c) => [
        c.name.localName,
        c.attributes.find((a) => a.name.localName === "val")?.value
      ])
    )
  ).toEqual([
    [
      ["tint", "100000"],
      ["shade", "100000"],
      ["satMod", "130000"]
    ],
    [
      ["tint", "50000"],
      ["shade", "100000"],
      ["satMod", "350000"]
    ]
  ]);
});
it("gradient collections expose checked indices and inherited sequence operations", () => {
  const model = shape();
  model.fill.gradient();
  const stops = model.fill.gradient_stops;
  const first = stops.at(0),
    last = stops.at(-1);
  expect(stops.length).toBe(2);
  expect([...stops]).toEqual([first, last]);
  expect(stops.includes(first)).toBe(true);
  expect(stops.count(last)).toBe(1);
  expect(stops.index(last)).toBe(1);
  expect(stops.reversed()).toEqual([last, first]);
  for (const value of [-3, 2, 0.5, NaN]) expect(() => stops.at(value)).toThrow();
  const other = shape();
  other.fill.gradient();
  const foreign = other.fill.gradient_stops.at(0);
  expect(stops.includes(foreign)).toBe(false);
  expect(stops.count(foreign)).toBe(0);
  expect(() => stops.index(foreign)).toThrow();
});
it.each([
  ["", null],
  ["<a:noFill/>", 5],
  ["<a:solidFill/>", 1],
  ["<a:gradFill/>", 3],
  ["<a:blipFill/>", 6],
  ["<a:pattFill/>", 2],
  ["<a:grpFill/>", 101]
] as const)("classifies every local fill representation %s", (xml, expected) => {
  expect(shape(xml).fill.type).toBe(expected);
});
it.each([
  ["srgbClr", 'val="315273"', "RGB"],
  ["schemeClr", 'val="accent5"', "SCHEME"],
  ["scrgbClr", 'r="10000" g="20000" b="30000"', "SCRGB"],
  ["hslClr", 'hue="5400000" sat="50000" lum="25000"', "HSL"],
  ["prstClr", 'val="blue"', "PRESET"],
  ["sysClr", 'val="windowText" lastClr="315273"', "SYSTEM"]
] as const)("reads and adjusts alpha without converting %s", (kind, attrs, type) => {
  const model = shape(
    `<a:solidFill><a:${kind} ${attrs}><a:alpha val="25000"/></a:${kind}></a:solidFill>`
  );
  expect(model.fill.fore_color.type).toBe(type);
  expect(model.fill.fore_color.opacity).toBe(0.25);
  model.fill.fore_color.opacity = 0.75;
  const color = model.xml.root.children[0]!.children[0]!.children[0]!;
  expect(color.name.localName).toBe(kind);
  expect(
    color.children
      .find((n) => n.name.localName === "alpha")
      ?.attributes.find((a) => a.name.localName === "val")?.value
  ).toBe("75000");
});
it("reads picture fill layout and crop explicitly", () => {
  const model = shape(
    '<a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId9"/><a:srcRect l="10000" t="20000" r="30000" b="40000"/><a:tile/></a:blipFill>'
  );
  expect(readDrawingFormat(model.xml.root).fill).toMatchObject({
    kind: "picture",
    relationshipId: "rId9",
    mode: "tile",
    crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 }
  });
});
it("rejects color and pattern access on inherited fill", () => {
  const model = shape();
  expect(() => model.fill.fore_color).toThrow();
  expect(() => model.fill.back_color).toThrow();
  expect(() => model.fill.pattern).toThrow();
});
it("creating missing gradient stops retains the documented default transformations", () => {
  const model = shape("<a:gradFill/>");
  void model.fill.gradient_stops;
  const stops = model.xml.root.children[0]!.children[0]!.children.find(
    (n) => n.name.localName === "gsLst"
  )!;
  expect(
    stops.children.map((n) =>
      n.children[0]!.children.map((c) => [
        c.name.localName,
        c.attributes.find((a) => a.name.localName === "val")?.value
      ])
    )
  ).toEqual([
    [
      ["tint", "100000"],
      ["shade", "100000"],
      ["satMod", "130000"]
    ],
    [
      ["tint", "50000"],
      ["shade", "100000"],
      ["satMod", "350000"]
    ]
  ]);
});
