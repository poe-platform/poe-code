import { describe, expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { resolveTextStyles } from "./text-style-resolution.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const root = (xml: string) =>
  parseXmlPart(new TextEncoder().encode(xml), { maxBytes: 20000, maxNodes: 1000, maxDepth: 30 })
    .root;
const shape = (body: string, type = "body", idx = 7) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Article"/><p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
const drawing = (tag: string, body: string, tail = "") =>
  root(
    `<p:${tag} xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld>${tail}</p:${tag}>`
  );
function fixture(
  run = '<a:rPr b="0"><a:latin typeface="+mj-lt"/><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>',
  extra = ""
) {
  return {
    slide: {
      part: "/slide.xml",
      root: drawing(
        "sld",
        shape(
          `<a:lstStyle/><a:p><a:pPr><a:defRPr i="1"/></a:pPr><a:r>${run}<a:t>Harbor</a:t></a:r></a:p>`
        ),
        extra
      )
    },
    layout: {
      part: "/layout.xml",
      root: drawing(
        "sldLayout",
        shape('<a:lstStyle><a:lvl1pPr><a:defRPr b="1" sz="2400"/></a:lvl1pPr></a:lstStyle>', "body")
      )
    },
    master: {
      part: "/master.xml",
      root: drawing(
        "sldMaster",
        shape(
          '<a:lstStyle><a:lvl1pPr><a:defRPr><a:ea typeface="+mn-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></a:lstStyle>',
          "body",
          90
        ),
        '<p:clrMap tx1="dk1"/><p:txStyles><p:bodyStyle><a:lvl1pPr><a:defRPr u="sng"/></a:lvl1pPr></p:bodyStyle></p:txStyles>'
      )
    },
    theme: {
      part: "/theme.xml",
      root: root(
        `<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme name="Harbor"><a:dk1><a:srgbClr val="123456"/></a:dk1><a:accent2><a:srgbClr val="ABCDEF"/></a:accent2></a:clrScheme><a:fontScheme name="Harbor"><a:majorFont><a:latin typeface="Display"/><a:ea typeface="East Display"/><a:cs typeface="Complex Display"/></a:majorFont><a:minorFont><a:latin typeface="Body"/><a:ea typeface="East Body"/><a:cs typeface="Complex Body"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
      )
    }
  };
}
describe("effective text styles", () => {
  it("resolves each property independently and retains the originating token", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const [record] = resolveTextStyles(input);
    expect(record).toMatchObject({
      shapeId: "2",
      paragraph: 0,
      run: 0,
      properties: {
        bold: { value: false, token: "0", source: { part: "/slide.xml", layer: "run" } },
        italic: { value: true, source: { layer: "paragraph" } },
        size: { value: 24, source: { part: "/layout.xml", layer: "layout" } },
        latin: { value: "Display", token: "+mj-lt", references: [{ part: "/theme.xml" }] },
        eastAsia: { value: "East Body", source: { layer: "master" } },
        complex: { value: "Complex Display" },
        color: { value: "123456", token: "tx1", status: "resolved" }
      }
    });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(["+mj-lt", "+mn-lt", "+mj-ea", "+mn-ea", "+mj-cs", "+mn-cs"])(
    "resolves font variant %s",
    (token) => {
      const expected = {
        "+mj-lt": "Display",
        "+mn-lt": "Body",
        "+mj-ea": "East Display",
        "+mn-ea": "East Body",
        "+mj-cs": "Complex Display",
        "+mn-cs": "Complex Body"
      };
      expect(
        resolveTextStyles(fixture(`<a:rPr><a:latin typeface="${token}"/></a:rPr>`))[0]!.properties
          .latin.value
      ).toBe(expected[token as keyof typeof expected]);
    }
  );
  it("uses slide color overrides and reevaluates a destination theme", () => {
    const input = fixture(
      undefined,
      '<p:clrMapOvr><a:overrideClrMapping tx1="accent2"/></p:clrMapOvr>'
    );
    const color = resolveTextStyles(input)[0]!.properties.color;
    expect(color.value).toBe("ABCDEF");
    expect(color.references).toMatchObject([{ part: "/slide.xml" }, { part: "/theme.xml" }]);
    const destination = {
      part: "/destination.xml",
      root: root(
        `<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme><a:accent2><a:srgbClr val="987654"/></a:accent2></a:clrScheme></a:themeElements></a:theme>`
      )
    };
    const result = resolveTextStyles({ ...input, theme: destination })[0]!;
    expect(result.properties.color).toMatchObject({ value: "987654", token: "tx1" });
    expect(result.properties.latin).toMatchObject({
      value: null,
      token: "+mj-lt",
      status: "unresolved"
    });
  });
  it("distinguishes absence from unresolved local values without falling through", () => {
    const input = fixture(
      '<a:rPr><a:latin typeface="+future"/><a:solidFill><a:schemeClr val="unknown"/></a:solidFill></a:rPr>'
    );
    const properties = resolveTextStyles({ slide: input.slide })[0]!.properties;
    expect(properties.bold).toMatchObject({
      value: null,
      token: null,
      source: null,
      status: "absent"
    });
    expect(properties.latin).toMatchObject({ value: null, token: "+future", status: "unresolved" });
    expect(properties.color).toMatchObject({ value: null, token: "unknown", status: "unresolved" });
  });
  it("retains transformed colors unresolved instead of reporting the base RGB", () => {
    const input = fixture(
      '<a:rPr><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="60000"/></a:schemeClr></a:solidFill></a:rPr>'
    );
    expect(resolveTextStyles(input)[0]!.properties.color).toMatchObject({
      value: null,
      token: "tx1",
      status: "unresolved",
      reason: "color-transform"
    });
  });
  it("uses layout overrides unless the slide explicitly restores the master map", () => {
    const input = fixture();
    input.layout.root = drawing(
      "sldLayout",
      "",
      '<p:clrMapOvr><a:overrideClrMapping tx1="accent2"/></p:clrMapOvr>'
    );
    expect(resolveTextStyles(input)[0]!.properties.color.value).toBe("ABCDEF");
    input.slide = fixture(undefined, "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>").slide;
    expect(resolveTextStyles(input)[0]!.properties.color.value).toBe("123456");
  });
  it("uses master text defaults after absent placeholder values", () => {
    const input = fixture("<a:rPr/>");
    input.layout.root = drawing("sldLayout", shape("<a:lstStyle/>"));
    input.master.root = drawing(
      "sldMaster",
      "",
      '<p:txStyles><p:bodyStyle><a:lvl1pPr><a:defRPr sz="3200" b="1"/></a:lvl1pPr></p:bodyStyle></p:txStyles>'
    );
    const values = resolveTextStyles(input)[0]!.properties;
    expect(values.size).toMatchObject({ value: 32, source: { layer: "master-text" } });
    expect(values.bold).toMatchObject({ value: true, source: { layer: "master-text" } });
  });
  it("does not inherit a layout placeholder at a different sparse index", () => {
    const input = fixture("<a:rPr/>");
    input.layout.root = drawing(
      "sldLayout",
      shape('<a:lstStyle><a:lvl1pPr><a:defRPr sz="9900"/></a:lvl1pPr></a:lstStyle>', "body", 2)
    );
    expect(resolveTextStyles(input)[0]!.properties.size.status).toBe("absent");
  });
  it("uses font references when no more specific font is available", () => {
    const input = fixture("<a:rPr/>");
    input.slide.root = drawing(
      "sld",
      '<p:sp><p:nvSpPr><p:cNvPr id="9"/></p:nvSpPr><p:style><a:fontRef idx="minor"><a:schemeClr val="accent2"/></a:fontRef></p:style><p:txBody><a:p><a:r><a:t>Quay</a:t></a:r></a:p></p:txBody></p:sp>'
    );
    const values = resolveTextStyles(input)[0]!.properties;
    expect(values.latin).toMatchObject({
      value: "Body",
      token: "+mn-lt",
      source: { layer: "font-reference" }
    });
    expect(values.color).toMatchObject({ value: "ABCDEF", token: "accent2" });
  });
  it("uses theme overrides by scheme and does not fill missing fonts from an older scheme", () => {
    const input = fixture();
    const override = {
      part: "/override.xml",
      root: root(
        `<a:themeOverride xmlns:a="${a}"><a:fontScheme><a:majorFont><a:latin typeface="New Display"/></a:majorFont></a:fontScheme></a:themeOverride>`
      )
    };
    const values = resolveTextStyles({ ...input, themeOverrides: [override] })[0]!.properties;
    expect(values.latin).toMatchObject({
      value: "New Display",
      references: [{ part: "/override.xml" }]
    });
    expect(values.eastAsia).toMatchObject({ value: null, status: "unresolved" });
    expect(values.color.value).toBe("123456");
  });
  it("resolves master types from the matching layout when slide type is absent", () => {
    const input = fixture("<a:rPr/>");
    input.slide.root = drawing("sld", shape("<a:p><a:r><a:t>Quay</a:t></a:r></a:p>", "obj"));
    input.layout.root = drawing("sldLayout", shape("<a:lstStyle/>", "title"));
    input.master.root = drawing(
      "sldMaster",
      shape('<a:lstStyle><a:lvl1pPr><a:defRPr sz="4500"/></a:lvl1pPr></a:lstStyle>', "title")
    );
    expect(resolveTextStyles(input)[0]!.properties.size.value).toBe(45);
  });
  it.each([
    ["bold", "", null],
    ["bold", 'b="0"', false],
    ["bold", 'b="1"', true],
    ["italic", "", null],
    ["italic", 'i="0"', false],
    ["italic", 'i="1"', true],
    ["size", "", null],
    ["size", 'sz="2400"', 24]
  ] as const)("reads isolated %s from %s as %s", (property, attributes, expected) => {
    const slide = {
      part: "/plain.xml",
      root: drawing("sld", shape(`<a:p><a:r><a:rPr ${attributes}/><a:t>Harbor</a:t></a:r></a:p>`))
    };
    expect(resolveTextStyles({ slide })[0]!.properties[property].value).toBe(expected);
  });
  it.each([null, "Aperture"])("reads isolated typeface %s", (expected) => {
    const content = expected ? `<a:latin typeface="${expected}"/>` : "";
    const slide = {
      part: "/plain.xml",
      root: drawing(
        "sld",
        shape(`<a:p><a:r><a:rPr>${content}</a:rPr><a:t>Harbor</a:t></a:r></a:p>`)
      )
    };
    expect(resolveTextStyles({ slide })[0]!.properties.latin.value).toBe(expected);
  });
  it.each(["+unknown", "+mj-lt-extra"])(
    "preserves unknown font token %s without guessing",
    (token) => {
      const result = resolveTextStyles(fixture(`<a:rPr><a:latin typeface="${token}"/></a:rPr>`))[0]!
        .properties.latin;
      expect(result).toMatchObject({ value: null, token, status: "unresolved" });
    }
  );
  it("does not substitute a system fallback as a resolved theme color", () => {
    const input = fixture();
    input.theme.root = root(
      `<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="123456"/></a:dk1></a:clrScheme></a:themeElements></a:theme>`
    );
    expect(resolveTextStyles(input)[0]!.properties.color).toMatchObject({
      value: null,
      token: "tx1",
      status: "unresolved",
      reason: "color-kind-unavailable"
    });
  });
});

it("resolves inherited underline while retaining explicit zero and false formatting", () => {
  const [record] = resolveTextStyles(
    fixture(
      '<a:rPr b="0" lang="fr-CA" strike="noStrike" baseline="0" cap="none" spc="-125"><a:highlight><a:srgbClr val="A0B1C2"/></a:highlight></a:rPr>'
    )
  );
  expect(record!.properties).toMatchObject({
    bold: { value: false, source: { layer: "run" } },
    language: { value: "fr-CA", source: { layer: "run" } },
    underline: { value: "sng", source: { layer: "master-text" } },
    strike: { value: "none", source: { layer: "run" } },
    baseline: { value: 0, source: { layer: "run" } },
    capitalization: { value: "none", source: { layer: "run" } },
    spacing: { value: -1.25, source: { layer: "run" } },
    highlight: { value: "A0B1C2", source: { layer: "run" } }
  });
  const empty = resolveTextStyles(fixture("<a:rPr/>"))[0]!.properties;
  expect(empty).toMatchObject({
    language: { status: "absent", value: null },
    highlight: { status: "absent", value: null }
  });
});
