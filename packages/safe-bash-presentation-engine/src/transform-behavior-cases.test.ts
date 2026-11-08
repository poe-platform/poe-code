import { describe, expect, it } from "vitest";
import { applyShapeUpdate, readShape } from "./shapes.js";
import { Emu } from "./length.js";
import { parseXmlPart } from "./xml.js";

const kinds = ["sp", "pic", "graphicFrame", "grpSp", "cxnSp"] as const;
function drawing(kind: string, content: string, attributes = "", missing = false) {
  const transform = missing
    ? ""
    : `<${kind === "graphicFrame" ? "p" : "a"}:xfrm ${attributes}>${content}</${kind === "graphicFrame" ? "p" : "a"}:xfrm>`;
  const body =
    kind === "graphicFrame"
      ? transform
      : `<p:${kind === "grpSp" ? "grpSpPr" : "spPr"}>${transform}</p:${kind === "grpSp" ? "grpSpPr" : "spPr"}>`;
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:${kind} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</p:${kind}>`
    ),
    { maxBytes: 8192, maxNodes: 40, maxDepth: 8 }
  );
}
describe("drawing geometry value cases", () => {
  for (const kind of kinds) {
    it.each(["missing", "empty", "position"])(
      `reads ${kind} placement with %s transform`,
      (state) => {
        const xml = drawing(
          kind,
          state === "position" ? '<a:off x="123" y="456"/>' : "",
          "",
          state === "missing"
        );
        expect(readShape(xml.root)).toMatchObject({
          left: state === "position" ? 123 : null,
          top: state === "position" ? 456 : null
        });
      }
    );
    it.each([false, true])(`reads ${kind} dimensions when present=%s`, (present) => {
      const xml = drawing(kind, present ? '<a:ext cx="321" cy="654"/>' : "");
      expect(readShape(xml.root)).toMatchObject({
        width: present ? 321 : null,
        height: present ? 654 : null
      });
    });
    it(`creates ${kind} position and size pairs with explicit integers`, () => {
      let xml = drawing(kind, "");
      xml = applyShapeUpdate(xml, xml.root, {
        left: new Emu(123),
        top: new Emu(456),
        width: new Emu(321),
        height: new Emu(654)
      });
      const text = new TextDecoder().decode(xml.bytes());
      expect(text).toContain('x="123"');
      expect(text).toContain('y="456"');
      expect(text).toContain('cx="321"');
      expect(text).toContain('cy="654"');
      expect(readShape(xml.root)).toMatchObject({ left: 123, top: 456, width: 321, height: 654 });
    });
  }
  it.each([
    { kind: "sp", raw: null, expected: 0 },
    { kind: "sp", raw: 60000, expected: 1 },
    { kind: "sp", raw: 2545200, expected: 42.42 },
    { kind: "sp", raw: -60000, expected: 359 },
    { kind: "grpSp", raw: 2545200, expected: 42.42 }
  ])("reads precise angle $raw on $kind", ({ kind, raw, expected }) => {
    expect(
      readShape(drawing(kind, "", raw === null ? "" : `rot="${raw}"`, raw === null).root).rotation
    ).toBe(expected);
  });
  it.each([
    { kind: "sp", initial: 0, value: 1, raw: 60000 },
    { kind: "sp", initial: 60000, value: 0, raw: 0 },
    { kind: "sp", initial: 60000, value: -420, raw: 18000000 },
    { kind: "grpSp", initial: 0, value: 1, raw: 60000 }
  ])("writes angle $value on $kind from $initial", ({ kind, initial, value, raw }) => {
    const xml = drawing(kind, "", `rot="${initial}"`);
    const next = applyShapeUpdate(xml, xml.root, { rotation: value });
    expect(new TextDecoder().decode(next.bytes())).toContain(`rot="${raw}"`);
  });
  for (const row of [
    {
      kind: "sp",
      left: 1339552,
      top: 692696,
      width: 928192,
      height: 914400,
      angle: 10,
      assigned: 12.3,
      normalized: 12.3
    },
    {
      kind: "pic",
      left: 2711152,
      top: 1835696,
      width: 914400,
      height: 945232,
      angle: 20,
      assigned: 520.4,
      normalized: 160.4
    },
    {
      kind: "graphicFrame",
      left: 4082752,
      top: 2978696,
      width: 993304,
      height: 914400,
      angle: 0,
      assigned: 10,
      normalized: 10
    },
    {
      kind: "grpSp",
      left: 5454352,
      top: 4121696,
      width: 914400,
      height: 914400,
      angle: 40,
      assigned: -5.2,
      normalized: 354.8
    },
    {
      kind: "cxnSp",
      left: 6825952,
      top: 5264696,
      width: 986408,
      height: 828600,
      angle: 50,
      assigned: 50,
      normalized: 50
    }
  ]) {
    const input = () =>
      drawing(
        row.kind,
        `<a:off x="${row.left}" y="${row.top}"/><a:ext cx="${row.width}" cy="${row.height}"/>`,
        `rot="${row.angle * 60000}"`
      );
    it(`observes ${row.kind} authored placement`, () => {
      expect(readShape(input().root)).toMatchObject({ left: row.left, top: row.top });
    });
    it(`updates ${row.kind} placement independently`, () => {
      let xml = input();
      xml = applyShapeUpdate(xml, xml.root, { left: new Emu(row.top) });
      xml = applyShapeUpdate(xml, xml.root, { top: new Emu(row.left) });
      expect(readShape(xml.root)).toMatchObject({
        left: row.top,
        top: row.left,
        width: row.width,
        height: row.height
      });
    });
    it(`observes ${row.kind} authored dimensions`, () => {
      expect(readShape(input().root)).toMatchObject({ width: row.width, height: row.height });
    });
    it(`updates ${row.kind} dimensions independently`, () => {
      let xml = input();
      xml = applyShapeUpdate(xml, xml.root, { width: new Emu(row.top) });
      xml = applyShapeUpdate(xml, xml.root, { height: new Emu(row.left) });
      expect(readShape(xml.root)).toMatchObject({
        width: row.top,
        height: row.left,
        left: row.left,
        top: row.top
      });
    });
    it(`observes ${row.kind} authored rotation`, () => {
      expect(readShape(input().root).rotation).toBe(row.angle);
    });
    it(`updates ${row.kind} normalized rotation`, () => {
      const xml = input();
      expect(
        readShape(applyShapeUpdate(xml, xml.root, { rotation: row.assigned }).root).rotation
      ).toBe(row.normalized);
    });
  }
});
