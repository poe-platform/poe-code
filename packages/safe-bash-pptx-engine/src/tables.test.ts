import { describe, expect, it } from "vitest";
import { createTableXml, readTable, applyTableUpdate } from "./tables.js";
import { parseXmlPart } from "./xml.js";
const limits = { maxBytes: 1000000, maxNodes: 10000, maxDepth: 40 };
const len = (value: number) => ({ value, unit: "emu" as const });
const make = () =>
  parseXmlPart(
    new TextEncoder().encode(
      createTableXml(2, {
        rows: 2,
        columns: 3,
        left: len(0),
        top: len(0),
        width: len(11),
        height: len(5),
        data: [
          ["A", "", "C"],
          ["D\nE", "F\vG", "H"]
        ]
      })
    ),
    limits
  );
describe("table grid", () => {
  it("assigns remainder units earliest and round-trips empty paragraphs and soft breaks", () => {
    const doc = make();
    expect(readTable(doc.root, doc)).toMatchObject({
      rows: 2,
      columns: 3,
      rowHeights: [3, 2],
      columnWidths: [4, 4, 3],
      data: [
        ["A", "", "C"],
        ["D\nE", "F\vG", "H"]
      ]
    });
  });
  it("retains bytes for equal text, dimensions and empty updates", () => {
    const doc = make();
    for (const update of [{}, { rows: 2, columns: 3 }, { cell: { row: 0, column: 0 }, text: "A" }])
      expect(applyTableUpdate(doc, doc.root, update).bytes()).toEqual(doc.bytes());
  });
  it("updates selected row and column and their summed extents", () => {
    const doc = make();
    const result = applyTableUpdate(doc, doc.root, {
      cell: { row: 1, column: 2 },
      rowHeight: len(7),
      columnWidth: len(8)
    });
    expect(readTable(result.root, result)).toMatchObject({
      rowHeights: [3, 7],
      columnWidths: [4, 4, 8],
      height: 10,
      width: 16
    });
  });
  it.each([
    { rows: 0 },
    { columns: 4 },
    { data: [["short"]] },
    { text: "missing origin" },
    { cell: { row: -1, column: 0 }, text: "x" }
  ])("rejects invalid grid intent %j", (update) => {
    const doc = make();
    expect(() => applyTableUpdate(doc, doc.root, update)).toThrow();
  });
  it("sets style, direct fill, edge widths and explicit zero margins", () => {
    const doc = make();
    const result = applyTableUpdate(doc, doc.root, {
      cell: { row: 0, column: 1 },
      style: "{original-style}",
      fill: "123456",
      borderColor: "ABCDEF",
      borderWidth: len(9),
      marginLeft: len(0)
    });
    expect(readTable(result.root, result)).toMatchObject({ style: "{original-style}" });
    expect(result.markup(result.root)).toContain('marL="0"');
    expect(result.markup(result.root)).toContain('val="ABCDEF"');
    expect(readTable(result.root, result).cells[0]!.fill).toBeNull();
    expect(readTable(result.root, result).cells[1]!.fill).toBe("123456");
  });
});
it("rejects blocked table mutation without changing source bytes", () => {
  const original = make();
  const nv = original.root.children[0]!.children[1]!;
  const locked = original.spliceChildren(nv, 0, 0, [
    '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noSelect="1"/>'
  ]);
  expect(() =>
    applyTableUpdate(locked, locked.root, { cell: { row: 0, column: 0 }, text: "blocked" })
  ).toThrow("locked");
});
it("rejects sparse arrays and accessors without invoking them", () => {
  const doc = make();
  let calls = 0;
  const row = ["a", "b", "c"];
  Object.defineProperty(row, "0", {
    get() {
      calls++;
      return "x";
    }
  });
  expect(() => applyTableUpdate(doc, doc.root, { data: [row, ["d", "e", "f"]] })).toThrow();
  expect(calls).toBe(0);
  expect(() =>
    applyTableUpdate(doc, doc.root, { data: [new Array<string>(3), ["d", "e", "f"]] })
  ).toThrow();
});
it.each(["width", "height", "left", "top", "rowHeight", "columnWidth"])(
  "rejects null nonnullable length %s",
  (key) => {
    const doc = make();
    expect(() => applyTableUpdate(doc, doc.root, { [key]: null })).toThrow();
  }
);
it("reports each supported border with its direct and theme color separate", () => {
  const original = make(),
    frame = original.root;
  const tbl = frame.children[2]!.children[0]!.children[0]!,
    row = tbl.children[2]!,
    cell = row.children[0]!,
    pr = cell.children[1]!;
  const doc = original.spliceChildren(pr, 0, 0, [
    '<a:lnL xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" w="12"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:lnL>',
    '<a:lnB xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" w="24"><a:solidFill><a:srgbClr val="A1B2C3"/></a:solidFill></a:lnB>'
  ]);
  expect(readTable(doc.root, doc).cells[0]!.borders).toEqual({
    left: { fillType: "solidFill", width: 12, color: null, themeColor: "accent4" },
    right: { fillType: null, width: null, color: null, themeColor: null },
    top: { fillType: null, width: null, color: null, themeColor: null },
    bottom: { fillType: "solidFill", width: 24, color: "A1B2C3", themeColor: null }
  });
});
it("rejects row size totals beyond the drawing coordinate bound", () => {
  const doc = make();
  expect(() => applyTableUpdate(doc, doc.root, { rowHeight: len(27273042316900) })).toThrow(
    "total"
  );
});
it("classifies malformed physical cell cardinality as document data", () => {
  const original = make(),
    tbl = original.root.children[2]!.children[0]!.children[0]!,
    row = tbl.children[2]!;
  const malformed = original.spliceChildren(row, 0, 1, []);
  expect(() => readTable(malformed.root, malformed)).toThrow(
    expect.objectContaining({ code: "invalid-xml", phase: "parse" })
  );
});
it.each([null, "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"])(
  "distinguishes direct fill kind from inheritance for cells and borders %s",
  (kind) => {
    const original = make(),
      tbl = original.root.children[2]!.children[0]!.children[0]!,
      pr = tbl.children[2]!.children[0]!.children[1]!;
    const fill =
      kind === null
        ? ""
        : kind === "solidFill"
          ? '<a:solidFill><a:schemeClr val="accent5"/></a:solidFill>'
          : `<a:${kind}/>`;
    const doc = original.spliceChildren(pr, 0, 0, [
      `<a:lnL xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${fill}</a:lnL>`,
      ...(fill
        ? [
            `<a:${kind} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${kind === "solidFill" ? '<a:schemeClr val="accent5"/>' : ""}</a:${kind}>`
          ]
        : [])
    ]);
    const cell = readTable(doc.root, doc).cells[0]!;
    expect(cell.fillType).toBe(kind);
    expect(cell.borders.left.fillType).toBe(kind);
    expect(cell.borders.right.fillType).toBeNull();
    expect(cell.themeFill).toBe(kind === "solidFill" ? "accent5" : null);
    expect(cell.borders.left.themeColor).toBe(kind === "solidFill" ? "accent5" : null);
    expect(applyTableUpdate(doc, doc.root, {}).bytes()).toEqual(doc.bytes());
  }
);
