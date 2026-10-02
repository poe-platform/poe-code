import { expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { Table } from "./tables-model.js";
import { parseXmlPart } from "./xml.js";

function grid(rows: number, columns: number, texts: string[] = [], attributes: string[] = []) {
  const cells = Array.from(
    { length: rows },
    (_, row) =>
      `<a:tr h="17">${Array.from({ length: columns }, (_, column) => {
        const index = row * columns + column;
        const paragraphs = (texts[index] ?? "")
          .split("\n")
          .map((text) => `<a:p>${text ? `<a:r><a:t>${text}</a:t></a:r>` : ""}</a:p>`)
          .join("");
        return `<a:tc ${attributes[index] ?? ""}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody><a:tcPr/></a:tc>`;
      }).join("")}</a:tr>`
  ).join("");
  return new Table(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="7" name="Schedule"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="${columns * 23}" cy="${rows * 17}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${'<a:gridCol w="23"/>'.repeat(columns)}</a:tblGrid>${cells}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
      ),
      { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
    )
  );
}

it.each([
  {
    label: "horizontal",
    rows: 1,
    columns: 2,
    from: [0, 0],
    to: [0, 1],
    spans: [
      [1, 2, true, false],
      [1, 1, false, true]
    ]
  },
  {
    label: "vertical",
    rows: 2,
    columns: 1,
    from: [0, 0],
    to: [1, 0],
    spans: [
      [2, 1, true, false],
      [1, 1, false, true]
    ]
  },
  {
    label: "reverse corners",
    rows: 2,
    columns: 2,
    from: [1, 0],
    to: [0, 1],
    spans: [
      [2, 2, true, false],
      [2, 1, false, true],
      [1, 2, false, true],
      [1, 1, false, true]
    ]
  },
  {
    label: "nine positions",
    rows: 3,
    columns: 3,
    from: [0, 0],
    to: [2, 2],
    spans: [
      [3, 3, true, false],
      [3, 1, false, true],
      [3, 1, false, true],
      [1, 3, false, true],
      [1, 1, false, true],
      [1, 1, false, true],
      [1, 3, false, true],
      [1, 1, false, true],
      [1, 1, false, true]
    ]
  },
  {
    label: "offset square",
    rows: 3,
    columns: 3,
    from: [1, 1],
    to: [2, 2],
    spans: [
      [1, 1, false, false],
      [1, 1, false, false],
      [1, 1, false, false],
      [1, 1, false, false],
      [2, 2, true, false],
      [2, 1, false, true],
      [1, 1, false, false],
      [1, 2, false, true],
      [1, 1, false, true]
    ]
  }
])(
  "marks every physical position and preserves dimensions for $label",
  ({ rows, columns, from, to, spans }) => {
    const table = grid(rows, columns);
    table.cell(from[0]!, from[1]!).merge(table.cell(to[0]!, to[1]!));
    expect(
      [...table.iter_cells()].map((cell) => [
        cell.span_height,
        cell.span_width,
        cell.is_merge_origin,
        cell.is_spanned
      ])
    ).toEqual(spans);
    expect([...table.rows].map((row) => row.height.emu)).toEqual(Array(rows).fill(17));
    expect([...table.columns].map((column) => column.width.emu)).toEqual(Array(columns).fill(23));
    const origin = [...table.iter_cells()].find((cell) => cell.is_merge_origin)!;
    origin.split();
    expect(
      [...table.iter_cells()].map((cell) => [
        cell.span_height,
        cell.span_width,
        cell.is_merge_origin,
        cell.is_spanned
      ])
    ).toEqual(Array(rows * columns).fill([1, 1, false, false]));
  }
);

it.each([
  ["empty pair", "", "", ""],
  ["empty origin", "", "Delta", "Delta"],
  ["empty neighbor", "Cove", "", "Cove"],
  ["two paragraphs", "Cove", "Delta", "Cove\nDelta"],
  ["trailing empty paragraphs", "Cove", "\n", "Cove\n\n"],
  ["leading empty paragraphs", "\n", "Delta", "\n\nDelta"]
])("moves paragraph content once for %s", (_label, left, right, expected) => {
  const table = grid(1, 2, [left!, right!]);
  table.cell(0, 0).merge(table.cell(0, 1));
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([expected, ""]);
  table.cell(0, 0).split();
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([expected, ""]);
});

it.each([
  ["horizontal defaults", 1, 2, []],
  ["horizontal explicit defaults", 1, 2, ['gridSpan="1"', 'hMerge="false"']],
  ["vertical defaults", 2, 1, []],
  ["vertical explicit defaults", 2, 1, ['rowSpan="1"', 'vMerge="false"']]
] as const)("accepts unmerged range with %s", (_label, rows, columns, attributes) => {
  const table = grid(rows, columns, [], [...attributes]);
  table.cell(0, 0).merge(table.cell(rows - 1, columns - 1));
  expect(table.cell(0, 0).is_merge_origin).toBe(true);
});

it("rejects foreign endpoints and non-origin splits without mutation", () => {
  const table = grid(2, 2),
    other = grid(2, 2),
    before = table.xml.bytes();
  expect(() => table.cell(0, 0).merge(other.cell(1, 1))).toThrow();
  expect(() => table.cell(0, 0).split()).toThrow();
  expect(table.xml.bytes()).toEqual(before);
  table.cell(0, 0).merge(table.cell(1, 1));
  const merged = table.xml.bytes();
  expect(() => table.cell(0, 1).split()).toThrow();
  expect(table.xml.bytes()).toEqual(merged);
});

it.each([
  ["horizontal", ['gridSpan="2"', 'hMerge="1"', "", ""], 0, 1, 1, 1],
  ["vertical", ['rowSpan="2"', "", 'vMerge="true"', ""], 1, 0, 1, 1]
] as const)(
  "rejects intersecting %s spans atomically",
  (_label, attributes, row, column, endRow, endColumn) => {
    const table = grid(2, 2, ["Cove", "", "", ""], [...attributes]);
    const before = table.xml.bytes();
    expect(() => table.cell(row, column).merge(table.cell(endRow, endColumn))).toThrow();
    expect(table.xml.bytes()).toEqual(before);
  }
);

it("collects only the rectangular paragraph owners in physical row order", () => {
  const table = grid(3, 3, [
    "Cove",
    "Delta",
    "Elm",
    "Fern",
    "Grove",
    "Hill",
    "Isle",
    "Juniper",
    "Knoll"
  ]);
  table.cell(0, 0).merge(table.cell(1, 1));
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([
    "Cove\nDelta\nFern\nGrove",
    "",
    "Elm",
    "",
    "",
    "Hill",
    "Isle",
    "Juniper",
    "Knoll"
  ]);
  table.cell(0, 0).split();
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([
    "Cove\nDelta\nFern\nGrove",
    "",
    "Elm",
    "",
    "",
    "Hill",
    "Isle",
    "Juniper",
    "Knoll"
  ]);
});

it("combines complete prior spans without duplicating their owned paragraphs", () => {
  const table = grid(2, 2, ["Cove", "Delta", "Fern", "Grove"]);
  table.cell(0, 0).merge(table.cell(0, 1));
  table.cell(0, 0).merge(table.cell(1, 1));
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([
    "Cove\nDelta\nFern\nGrove",
    "",
    "",
    ""
  ]);
  expect(table.cell(0, 0).span_height).toBe(2);
  expect(table.cell(0, 0).span_width).toBe(2);
});

it("serializes an offset rectangle with exact independent span attributes", () => {
  const table = grid(3, 3);
  table.cell(1, 1).merge(table.cell(2, 2));
  const cells: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === "tc")
      cells.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/")
            .map((attribute) => [attribute.name, attribute.value])
        )
      );
  });
  parser.write(new TextDecoder().decode(table.xml.bytes())).close();
  expect(cells).toEqual([
    {},
    {},
    {},
    {},
    { gridSpan: "2", rowSpan: "2" },
    { rowSpan: "2", hMerge: "1" },
    {},
    { gridSpan: "2", vMerge: "1" },
    { hMerge: "1", vMerge: "1" }
  ]);
});
