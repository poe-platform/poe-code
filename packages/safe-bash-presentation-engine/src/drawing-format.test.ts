import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { applyDrawingUpdate, readDrawingFormat } from "./drawing-format.js";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
function doc(body = "") {
  return parseXmlPart(
    new TextEncoder().encode(`<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:spPr>${body}</p:spPr></p:sp>`),
    { maxBytes: 50000, maxNodes: 1000, maxDepth: 32 }
  );
}
it("distinguishes omitted paint from transparent paint", () => {
  const xml = doc();
  expect(readDrawingFormat(xml.root).fill.kind).toBe("inherit");
  const next = applyDrawingUpdate(xml, xml.root, { fill: { kind: "none" } });
  expect(readDrawingFormat(next.root).fill.kind).toBe("none");
});
it("retains theme tokens and alpha with ordered gradient stops", () => {
  const xml = doc();
  const next = applyDrawingUpdate(xml, xml.root, {
    fill: {
      kind: "gradient",
      angle: -90,
      stops: [
        { position: 0, color: { theme: "accent2", opacity: 0.25 } },
        { position: 1, color: "112233" }
      ]
    }
  });
  expect(next.markup(next.root)).toContain('val="accent2"');
  expect(next.markup(next.root)).toContain('alpha val="25000"');
  expect(readDrawingFormat(next.root).fill).toMatchObject({ kind: "gradient", angle: 270 });
});
it("preserves complex effects and materials during fill edits", () => {
  const payload =
    '<a:effectDag name="retained"><a:cont type="tree"><a:blur rad="42"/></a:cont></a:effectDag><a:scene3d><a:camera prst="orthographicFront"/></a:scene3d><a:sp3d prstMaterial="metal"/>';
  const xml = doc(payload);
  const next = applyDrawingUpdate(xml, xml.root, { fill: { kind: "solid", color: "ABCDEF" } });
  expect(next.markup(next.root)).toContain(payload);
  expect(() => applyDrawingUpdate(xml, xml.root, { shadow: null })).toThrow();
});
it.each([-0.1, 1.1, NaN, Infinity])("rejects invalid alpha %s", (opacity) => {
  const xml = doc();
  expect(() =>
    applyDrawingUpdate(xml, xml.root, {
      fill: { kind: "solid", color: { theme: "accent1", opacity } }
    })
  ).toThrow();
});
it("requires gradient endpoints and bounds", () => {
  const xml = doc();
  expect(() =>
    applyDrawingUpdate(xml, xml.root, {
      fill: {
        kind: "gradient",
        angle: 0,
        stops: [
          { position: 0.1, color: "000000" },
          { position: 1, color: "FFFFFF" }
        ]
      }
    })
  ).toThrow();
});
it("authors a zero-offset shadow without removing unrelated effects", () => {
  const xml = doc('<a:effectLst><a:glow rad="2"><a:srgbClr val="112233"/></a:glow></a:effectLst>');
  const next = applyDrawingUpdate(xml, xml.root, {
    shadow: { blur: { value: 2, unit: "pt" }, color: { theme: "accent1" }, opacity: 0.5 }
  });
  expect(next.markup(next.root)).toContain('dist="0"');
  expect(next.markup(next.root)).toContain('<a:glow rad="2">');
  expect(readDrawingFormat(next.root).shadow).toMatchObject({ blur: 25400, opacity: 0.5 });
});
it.each([
  { shadow: false },
  { shadow: 0 },
  { shadow: "" },
  { line: { fill: null } },
  { fill: undefined },
  { line: { width: undefined } }
])("rejects malformed or empty updates with stable errors %j", (update) => {
  const xml = doc();
  expect(() => applyDrawingUpdate(xml, xml.root, update as never)).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
});
it("keeps pattern color nodes before extension metadata", async () => {
  const { Shape } = await import("./shapes.js");
  const model = new Shape(
    doc('<a:pattFill><a:extLst><a:ext uri="retained"/></a:extLst></a:pattFill>')
  );
  void model.fill.back_color;
  expect(model.xml.root.children[0]!.children[0]!.children.map((n) => n.name.localName)).toEqual([
    "bgClr",
    "extLst"
  ]);
});
it.each([{}, { left: 0, top: 0, right: 0 }, { left: 0, top: 0, right: 0, bottom: undefined }])(
  "requires all crop edges before serialization %j",
  (crop) => {
    const xml = doc();
    expect(() =>
      applyDrawingUpdate(xml, xml.root, {
        fill: { kind: "picture", relationshipId: "rId9", mode: "stretch", crop }
      } as never)
    ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  }
);
