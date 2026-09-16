import { expect, it } from "vitest";
import { Table } from "./tables-model.js";
import { Length } from "./length.js";
import { MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";
import { createTableXml } from "./tables.js";
import { applyTableUpdate, readTable } from "./tables.js";
import { parseXmlPart } from "./xml.js";

function fixture(properties = "", cellProperties = "", attributes = "") {
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="2" name="Grid"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6" cy="4"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${properties}<a:tblGrid><a:gridCol w="3"/><a:gridCol w="3"/></a:tblGrid><a:tr h="4"><a:tc ${attributes}><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody>${cellProperties}</a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Coast</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    ),
    { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
  );
}

it.each([
  ["", "firstRow", false],
  ["<a:tblPr/>", "firstRow", false],
  ['<a:tblPr firstRow="1"/>', "firstRow", true],
  ['<a:tblPr firstRow="0"/>', "firstRow", false],
  ['<a:tblPr firstRow="true"/>', "firstRow", true],
  ['<a:tblPr firstRow="false"/>', "firstRow", false],
  ['<a:tblPr firstCol="1"/>', "firstCol", true],
  ['<a:tblPr lastRow="0"/>', "lastRow", false],
  ['<a:tblPr lastCol="true"/>', "lastCol", true],
  ['<a:tblPr bandRow="false"/>', "horzBand", false],
  ["<a:tblPr/>", "vertBand", false],
  ['<a:tblPr bandRow="1"/>', "horzBand", true],
  ['<a:tblPr bandCol="true"/>', "vertBand", true]
] as const)("reads style flag XML %s %s", (properties, key, expected) => {
  const doc = fixture(properties);
  expect(readTable(doc.root, doc)).toHaveProperty(key, expected);
});

it.each([
  ["firstRow", "firstRow"],
  ["lastRow", "lastRow"],
  ["firstCol", "firstCol"],
  ["lastCol", "lastCol"],
  ["horzBand", "bandRow"],
  ["vertBand", "bandCol"]
] as const)("writes style flag using its schema attribute %s", (key, attribute) => {
  const doc = fixture();
  const result = applyTableUpdate(doc, doc.root, { [key]: true });
  expect(result.markup(result.root)).toContain(`${attribute}="1"`);
});

it.each([
  ["marL", "marginLeft", 82296],
  ["marR", "marginRight", 73152],
  ["marT", "marginTop", 64008],
  ["marB", "marginBottom", 54864]
] as const)(
  "reads direct margin without replacing inherited formatting %s",
  (attribute, key, value) => {
    const doc = fixture("", `<a:tcPr ${attribute}="${value}"/>`);
    expect(readTable(doc.root, doc).cells[0]).toHaveProperty(key, value);
  }
);

it.each(["marginLeft", "marginRight", "marginTop", "marginBottom"] as const)(
  "sets and removes direct cell margin %s",
  (key) => {
    const doc = fixture();
    const changed = applyTableUpdate(doc, doc.root, {
      cell: { row: 0, column: 0 },
      [key]: { value: 73152, unit: "emu" }
    });
    expect(readTable(changed.root, changed).cells[0]).toHaveProperty(key, 73152);
    const cleared = applyTableUpdate(changed, changed.root, {
      cell: { row: 0, column: 0 },
      [key]: null
    });
    expect(readTable(cleared.root, cleared).cells[0]).toHaveProperty(key, null);
    expect(cleared.markup(cleared.root)).toContain(
      '<a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr>'
    );
  }
);

it.each([
  ["", null],
  ["t", "top"],
  ["ctr", "middle"],
  ["b", "bottom"]
] as const)("reads direct anchor %s", (anchor, expected) => {
  const doc = fixture("", anchor ? `<a:tcPr anchor="${anchor}"/>` : "");
  expect(readTable(doc.root, doc).cells[0]!.verticalAnchor).toBe(expected);
});

it.each([
  ["", false, false, 1, 1],
  ['gridSpan="1"', false, false, 1, 1],
  ['hMerge="1"', false, true, 1, 1],
  ['gridSpan="2" vMerge="1"', false, true, 2, 1],
  ['gridSpan="2"', true, false, 2, 1],
  ['rowSpan="2"', true, false, 1, 2],
  ['gridSpan="2" rowSpan="3"', true, false, 2, 3],
  ['rowSpan="2" hMerge="true"', false, true, 1, 2],
  ['rowSpan="42"', true, false, 1, 42],
  ['gridSpan="24"', true, false, 24, 1]
] as const)(
  "reports physical cell roles without collapsing grid positions %s",
  (attributes, isMergeOrigin, isSpanned, spanWidth, spanHeight) => {
    const doc = fixture("", "", attributes);
    const result = readTable(doc.root, doc);
    expect(result.cells).toHaveLength(2);
    expect(result.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      text: "",
      isMergeOrigin,
      isSpanned,
      spanWidth,
      spanHeight
    });
    expect(result.cells[1]).toMatchObject({
      row: 0,
      column: 1,
      text: "Coast",
      themeFill: "accent2"
    });
  }
);

it("keeps the exact bytes for unchanged empty cell text with themed neighbors", () => {
  const doc = fixture();
  expect(
    applyTableUpdate(doc, doc.root, { cell: { row: 0, column: 0 }, text: "" }).bytes()
  ).toEqual(doc.bytes());
});

it.each([
  ["", "firstRow", true, "firstRow"],
  ["", "firstRow", false, "firstRow"],
  ["<a:tblPr/>", "firstRow", true, "firstRow"],
  ["<a:tblPr/>", "firstRow", false, "firstRow"],
  ['<a:tblPr firstRow="true"/>', "firstRow", true, "firstRow"],
  ['<a:tblPr firstRow="false"/>', "firstRow", false, "firstRow"],
  ['<a:tblPr bandRow="1"/>', "firstRow", true, "firstRow"],
  ["", "firstCol", true, "firstCol"],
  ["", "lastRow", true, "lastRow"],
  ["", "lastCol", true, "lastCol"],
  ["", "horzBand", true, "bandRow"],
  ["", "vertBand", true, "bandCol"]
] as const)(
  "applies boolean formatting preserving unrelated flags %s %s %s",
  (properties, key, value, attribute) => {
    const doc = fixture(properties);
    const changed = applyTableUpdate(doc, doc.root, { [key]: value });
    expect(readTable(changed.root, changed)).toHaveProperty(key, value);
    const collect = (node: typeof changed.root): (typeof changed.root)[] => [
      node,
      ...node.children.flatMap(collect)
    ];
    const tableProperties = collect(changed.root).find((n) => n.name.localName === "tblPr");
    const actual = tableProperties?.attributes.find((a) => a.name.localName === attribute)?.value;
    if (value) expect(["1", "true"]).toContain(actual);
    else expect([undefined, "0", "false"]).toContain(actual);
    if (properties.includes('bandRow="1"'))
      expect(tableProperties?.attributes.find((a) => a.name.localName === "bandRow")?.value).toBe(
        "1"
      );
  }
);

it.each(["914400", "10pt"])("reads stored row and column lengths %s", (value) => {
  const doc = fixture();
  const nodes = (node: typeof doc.root): (typeof doc.root)[] => [
    node,
    ...node.children.flatMap(nodes)
  ];
  const row = nodes(doc.root).find((n) => n.name.localName === "tr")!;
  const changed = doc.merge(row, { attributes: [{ namespace: "", localName: "h", value }] });
  const column = nodes(changed.root).find((n) => n.name.localName === "gridCol")!;
  const sized = changed.merge(column, { attributes: [{ namespace: "", localName: "w", value }] });
  const table = new Table(sized);
  expect(table.rows.get(0).height.emu).toBe(value === "10pt" ? 127000 : 914400);
  expect(table.columns.get(0).width.emu).toBe(value === "10pt" ? 127000 : 914400);
});

it.each(["12pt", "1234"])("replaces stored row and column sizes with integer EMUs %s", (value) => {
  const doc = fixture();
  const nodes = (node: typeof doc.root): (typeof doc.root)[] => [
    node,
    ...node.children.flatMap(nodes)
  ];
  const row = nodes(doc.root).find((n) => n.name.localName === "tr")!;
  const changed = doc.merge(row, { attributes: [{ namespace: "", localName: "h", value }] });
  const column = nodes(changed.root).find((n) => n.name.localName === "gridCol")!;
  const table = new Table(
    changed.merge(column, { attributes: [{ namespace: "", localName: "w", value }] })
  );
  table.rows.get(0).height = new Length(914400);
  table.columns.get(0).width = new Length(914400);
  expect(table.rows.get(0).height.emu).toBe(914400);
  expect(table.columns.get(0).width.emu).toBe(914400);
});

it.each([1, 2, 3])("provides grid collections with explicit bounds for dimension %s", (count) => {
  const table = new Table(
    parseXmlPart(
      new TextEncoder().encode(
        createTableXml(2, {
          rows: count,
          columns: count,
          left: new Length(0),
          top: new Length(0),
          width: new Length(90),
          height: new Length(90)
        })
      ),
      { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
    )
  );
  expect(table.rows.length).toBe(count);
  expect(table.columns.length).toBe(count);
  expect([...table.rows]).toHaveLength(count);
  expect([...table.columns]).toHaveLength(count);
  expect([...table.iter_cells()]).toHaveLength(count * count);
  for (const row of table.rows) {
    expect(row.cells.length).toBe(count);
    expect([...row.cells]).toHaveLength(count);
    for (let i = 0; i < count; i++) expect(row.cells.get(i).text).toBe("");
    for (const i of [-1, count]) expect(() => row.cells.get(i)).toThrow();
  }
  for (const i of [-1, count]) {
    expect(() => table.rows.get(i)).toThrow();
    expect(() => table.columns.get(i)).toThrow();
  }
});

it.each([
  ["margin_left", "marL", 82296, 91440],
  ["margin_right", "marR", 73152, 91440],
  ["margin_top", "marT", 64008, 45720],
  ["margin_bottom", "marB", 54864, 45720]
] as const)(
  "reads defaults and explicit margins and validates assignments %s",
  (key, attribute, value, defaultValue) => {
    for (const properties of ["", "<a:tcPr/>"])
      expect(new Table(fixture("", properties)).cell(0, 0)[key].emu).toBe(defaultValue);
    const table = new Table(fixture("", `<a:tcPr ${attribute}="${value}"/>`));
    const cell = table.cell(0, 0);
    expect(cell[key].emu).toBe(value);
    cell[key] = new Length(73152);
    expect(cell[key].emu).toBe(73152);
    cell[key] = null;
    expect(cell[key].emu).toBe(defaultValue);
    expect(() => {
      cell[key] = "invalid" as unknown as Length;
    }).toThrow();
  }
);

it.each([
  ["", null],
  ["<a:tcPr/>", null],
  ['<a:tcPr anchor="t"/>', MSO_VERTICAL_ANCHOR.TOP],
  ['<a:tcPr anchor="ctr"/>', MSO_VERTICAL_ANCHOR.MIDDLE],
  ['<a:tcPr anchor="b"/>', MSO_VERTICAL_ANCHOR.BOTTOM]
] as const)("returns the neutral cell anchor enum %s", (properties, value) => {
  expect(new Table(fixture("", properties)).cell(0, 0).vertical_anchor).toBe(value);
});

it.each([
  ["", null],
  ["", MSO_VERTICAL_ANCHOR.TOP],
  ["", MSO_VERTICAL_ANCHOR.MIDDLE],
  ["", MSO_VERTICAL_ANCHOR.BOTTOM],
  ['<a:tcPr anchor="t"/>', MSO_VERTICAL_ANCHOR.MIDDLE],
  ['<a:tcPr anchor="ctr"/>', null]
] as const)("assigns and removes the neutral cell anchor %s %s", (properties, value) => {
  const cell = new Table(fixture("", properties)).cell(0, 0);
  cell.vertical_anchor = value;
  expect(cell.vertical_anchor).toBe(value);
});

it.each([
  "first_col",
  "first_row",
  "last_col",
  "last_row",
  "horz_banding",
  "vert_banding"
] as const)("sets each neutral model table flag %s", (key) => {
  const table = new Table(fixture());
  table[key] = true;
  expect(table[key]).toBe(true);
  table[key] = false;
  expect(table[key]).toBe(false);
});

it("reads and sets cell margins through complete model workflows", () => {
  const cell = new Table(
    fixture("", '<a:tcPr marL="182880" marT="274320" marR="365760" marB="457200"/>')
  ).cell(0, 0);
  expect([
    cell.margin_left.emu,
    cell.margin_top.emu,
    cell.margin_right.emu,
    cell.margin_bottom.emu
  ]).toEqual([182880, 274320, 365760, 457200]);
  cell.margin_left = new Length(182880);
  cell.margin_top = null;
  cell.margin_right = null;
  cell.margin_bottom = new Length(274320);
  expect([
    cell.margin_left.emu,
    cell.margin_top.emu,
    cell.margin_right.emu,
    cell.margin_bottom.emu
  ]).toEqual([182880, 45720, 91440, 274320]);
});

it("writes Unicode text through cells and text frames without losing empty neighbors", () => {
  const table = new Table(fixture());
  const cell = table.cell(0, 1);
  expect(cell.text).toBe("Coast");
  cell.text = "Côte\n港";
  expect(cell.text).toBe("Côte\n港");
  cell.text_frame.text = "River";
  expect(cell.text).toBe("River");
  expect(table.cell(0, 0).text).toBe("");
  table.columns.get(0).width = new Length(1371600);
  expect(table.columns.get(0).width.inches).toBe(1.5);
});

it.each([
  ["ctr", MSO_VERTICAL_ANCHOR.BOTTOM],
  ["b", null]
] as const)("replaces or clears existing vertical alignment %s", (anchor, value) => {
  const cell = new Table(fixture("", `<a:tcPr anchor="${anchor}"/>`)).cell(0, 0);
  cell.vertical_anchor = value;
  expect(cell.vertical_anchor).toBe(value);
});

it.each(["rows", "columns"] as const)(
  "rejects zero dimension at admitted table creation %s",
  (key) => {
    expect(() =>
      createTableXml(2, {
        rows: 1,
        columns: 1,
        [key]: 0,
        left: new Length(0),
        top: new Length(0),
        width: new Length(90),
        height: new Length(90)
      })
    ).toThrow();
  }
);

it("synchronizes frame extents from exact row and column sums", () => {
  const table = new Table(
    parseXmlPart(
      new TextEncoder().encode(
        createTableXml(2, {
          rows: 2,
          columns: 2,
          left: new Length(0),
          top: new Length(0),
          width: new Length(333),
          height: new Length(300)
        })
      ),
      { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
    )
  );
  table.columns[0]!.width = new Length(111);
  table.columns[1]!.width = new Length(222);
  table.rows[0]!.height = new Length(100);
  table.rows[1]!.height = new Length(200);
  expect(readTable(table.element, table.xml)).toMatchObject({
    width: 333,
    height: 300,
    columnWidths: [111, 222],
    rowHeights: [100, 200]
  });
});

it.each([
  ['gridSpan="3" rowSpan="2"', true, false, 2, 3],
  ['hMerge="1"', false, true, 1, 1],
  ["", false, false, 1, 1]
] as const)(
  "reads physical cell merge roles through the model %s",
  (attributes, origin, spanned, height, width) => {
    const cell = new Table(fixture("", "", attributes)).cell(0, 0);
    expect([cell.is_merge_origin, cell.is_spanned, cell.span_height, cell.span_width]).toEqual([
      origin,
      spanned,
      height,
      width
    ]);
  }
);

it.each(["", '<a:tcPr marL="42"/>'])(
  "clears an absent or explicit left margin %s",
  (properties) => {
    const table = new Table(fixture("", properties));
    table.cell(0, 0).margin_left = null;
    expect(table.cell(0, 0).margin_left.emu).toBe(91440);
    expect(readTable(table.element, table.xml).cells[0]!.marginLeft).toBeNull();
  }
);
