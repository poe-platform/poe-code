import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  FillFormat,
  Inches,
  MSO_VERTICAL_ANCHOR,
  RGBColor,
  Presentation,
  GraphicFrame,
  createPresentation,
  addTable,
  Table,
  TableCell,
  TableColumns,
  TableRows,
  parseXmlPart,
  type XmlElement
} from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const limits = { maxBytes: 100000, maxNodes: 2000, maxDepth: 30 };
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: limits,
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
function tableFixture(rows = 2, columns = 2, properties = ""): Table {
  const cells = Array.from(
    { length: rows },
    (_, row) =>
      `<a:tr h="914400">${Array.from(
        { length: columns },
        (_, column) =>
          `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Station ${row + 1}.${column + 1}</a:t></a:r></a:p></a:txBody><a:tcPr ${properties}/></a:tc>`
      ).join("")}</a:tr>`
  ).join("");
  const markup = `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="7" name="Field observations"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="${columns * 914400}" cy="${rows * 914400}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${Array.from({ length: columns }, () => '<a:gridCol w="914400"/>').join("")}</a:tblGrid>${cells}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  return new Table(parseXmlPart(new TextEncoder().encode(markup), limits));
}
function elements(root: XmlElement, localName: string): XmlElement[] {
  return [root, ...root.children.flatMap((child) => elements(child, localName))].filter(
    (node) =>
      node.name.localName === localName &&
      node.name.namespace === "http://schemas.openxmlformats.org/drawingml/2006/main"
  );
}
function attribute(node: XmlElement, name: string): string | undefined {
  return node.attributes.find((item) => item.name.localName === name)?.value;
}
function persisted(table: Table): Table {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/table.xml", table.xml.bytes());
  return new Table(
    parseXmlPart(new Uint8Array(volume.readFileSync("/table.xml") as Buffer), limits)
  );
}

it.each([
  ["first_col", "firstCol"],
  ["first_row", "firstRow"],
  ["last_col", "lastCol"],
  ["last_row", "lastRow"],
  ["horz_banding", "bandRow"],
  ["vert_banding", "bandCol"]
] as const)("persists %s style toggles with independent table attributes", (property, xmlName) => {
  const table = tableFixture();
  for (const value of [true, false]) {
    table[property] = value;
    expect(table[property]).toBe(value);
    expect(attribute(elements(table.xml.root, "tblPr")[0]!, xmlName)).toBe(value ? "1" : "0");
    expect(persisted(table)[property]).toBe(value);
  }
});

it("exposes concrete table collections and traverses nine cells in row order", () => {
  const small = tableFixture();
  expect(small.cell(0, 0)).toBeInstanceOf(TableCell);
  expect(small.columns).toBeInstanceOf(TableColumns);
  expect(small.rows).toBeInstanceOf(TableRows);
  expect(small.rows.length).toBe(2);
  expect(small.columns.length).toBe(2);
  const table = tableFixture(3, 3);
  expect([...table.iter_cells()].map((cell) => cell.text)).toEqual([
    "Station 1.1",
    "Station 1.2",
    "Station 1.3",
    "Station 2.1",
    "Station 2.2",
    "Station 2.3",
    "Station 3.1",
    "Station 3.2",
    "Station 3.3"
  ]);
});

it("persists a one-and-a-half inch column width and updates the frame extent", () => {
  const table = tableFixture();
  table.columns[0]!.width = new Inches(1.5);
  expect(table.columns[0]!.width.inches).toBe(1.5);
  expect(elements(table.xml.root, "gridCol").map((node) => attribute(node, "w"))).toEqual([
    "1371600",
    "914400"
  ]);
  expect(attribute(elements(table.xml.root, "ext")[0]!, "cx")).toBe("2286000");
  expect(persisted(table).columns[0]!.width.emu).toBe(1371600);
});

it.each([
  [0, 0, true, false],
  [1, 1, false, true],
  [2, 2, false, false]
] as const)(
  "preserves cell identity and discovers the role at %i,%i",
  (row, column, origin, spanned) => {
    const table = tableFixture(3, 3);
    table.cell(0, 0).merge(table.cell(1, 1));
    const cell = table.cell(row, column);
    expect(cell.equals(new TableCell(table, row, column))).toBe(true);
    expect(cell.equals(table.cell(0, 2))).toBe(false);
    expect(cell.is_merge_origin).toBe(origin);
    expect(cell.is_spanned).toBe(spanned);
  }
);

it("combines a rectangular region in row order and clears covered cells", () => {
  const table = tableFixture(3, 3);
  const origin = table.cell(0, 0),
    covered = table.cell(1, 1);
  origin.merge(covered);
  expect(origin.text).toBe("Station 1.1\nStation 1.2\nStation 2.1\nStation 2.2");
  expect(covered.text).toBe("");
  const xml = table.xml;
  const cells = elements(xml.root, "tc");
  expect(attribute(cells[0]!, "gridSpan")).toBe("2");
  expect(attribute(cells[0]!, "rowSpan")).toBe("2");
  expect(elements(cells[0]!, "t").map((node) => xml.text(node))).toEqual([
    "Station 1.1",
    "Station 1.2",
    "Station 2.1",
    "Station 2.2"
  ]);
  expect(elements(cells[4]!, "t")).toHaveLength(0);
});

it("reports a two-by-three merged area then splits it into individual cells", () => {
  const table = tableFixture(3, 3),
    cell = table.cell(0, 0);
  cell.merge(table.cell(1, 2));
  expect([cell.span_height, cell.span_width]).toEqual([2, 3]);
  cell.split();
  expect([cell.is_merge_origin, cell.span_height, cell.span_width]).toEqual([false, 1, 1]);
  expect([...table.iter_cells()].every((item) => !item.is_spanned)).toBe(true);
  expect(attribute(elements(table.xml.root, "tc")[0]!, "gridSpan")).toBeUndefined();
  expect(attribute(elements(table.xml.root, "tc")[0]!, "rowSpan")).toBeUndefined();
});

it("reads explicit margins and returns a live fill interface", () => {
  const table = tableFixture(2, 2, 'marL="182880" marT="274320" marR="365760" marB="457200"');
  const cell = table.cell(0, 0);
  expect([
    cell.margin_left.inches,
    cell.margin_top.inches,
    cell.margin_right.inches,
    cell.margin_bottom.inches
  ]).toEqual([0.2, 0.3, 0.4, 0.5]);
  expect(cell.fill).toBeInstanceOf(FillFormat);
  const fill = cell.fill;
  fill.solid();
  fill.fore_color.rgb = RGBColor.from_string("285A73");
  expect(cell.fill).toBe(fill);
  expect(attribute(elements(table.xml.root, "srgbClr")[0]!, "val")).toBe("285A73");
  expect(persisted(table).cell(0, 0).fill.fore_color.rgb?.toString()).toBe("285A73");
});

it.each([
  ["margin_left", "marL", 0.2, 182880],
  ["margin_top", "marT", null, 45720],
  ["margin_right", "marR", null, 91440],
  ["margin_bottom", "marB", 0.3, 274320]
] as const)("persists %s assignment and inheritance", (property, xmlName, inches, expected) => {
  const table = tableFixture(2, 2, 'marL="1" marT="1" marR="1" marB="1"');
  const cell = table.cell(0, 0);
  cell[property] = inches === null ? null : new Inches(inches);
  expect(cell[property].emu).toBe(expected);
  expect(attribute(elements(table.xml.root, "tcPr")[0]!, xmlName)).toBe(
    inches === null ? undefined : String(expected)
  );
  expect(persisted(table).cell(0, 0)[property].emu).toBe(expected);
});

it("reads and replaces cell text through a retained frame", () => {
  const table = tableFixture(),
    cell = table.cell(0, 0),
    frame = cell.text_frame;
  expect(cell.text).toBe("Station 1.1");
  cell.text = "Northern inlet";
  expect(frame.text).toBe("Northern inlet");
  expect(elements(table.xml.root, "t").map((node) => table.xml.text(node))).toEqual([
    "Northern inlet",
    "Station 1.2",
    "Station 2.1",
    "Station 2.2"
  ]);
});

it.each([
  ["", null, MSO_VERTICAL_ANCHOR.TOP, "t"],
  ['anchor="ctr"', MSO_VERTICAL_ANCHOR.MIDDLE, MSO_VERTICAL_ANCHOR.BOTTOM, "b"],
  ['anchor="b"', MSO_VERTICAL_ANCHOR.BOTTOM, null, undefined]
] as const)("reads and changes cell anchoring from %s", (markup, initial, next, expected) => {
  const table = tableFixture(2, 2, markup),
    cell = table.cell(0, 0);
  expect(cell.vertical_anchor).toBe(initial);
  cell.vertical_anchor = next;
  expect(cell.vertical_anchor).toBe(next);
  expect(attribute(elements(table.xml.root, "tcPr")[0]!, "anchor")).toBe(expected);
  expect(persisted(table).cell(0, 0).vertical_anchor).toBe(next);
});

it("persists live table edits inside a presentation created through byte operations", async () => {
  const empty = await createPresentation({ slides: [{ name: "Coastal observations" }] }, context);
  const inserted = await addTable(
    empty,
    {
      slide: 1,
      update: {
        rows: 2,
        columns: 2,
        left: new Inches(0),
        top: new Inches(0),
        width: new Inches(2),
        height: new Inches(2),
        data: [
          ["Channel", "Depth"],
          ["East", "12"]
        ]
      }
    },
    context
  );
  const deck = await Presentation(inserted.bytes, context);
  const frame = deck.slides[0]!.shapes[0] as GraphicFrame;
  expect(frame).toBeInstanceOf(GraphicFrame);
  const table = frame.table;
  table.first_row = true;
  table.vert_banding = true;
  table.columns[0]!.width = new Inches(1.5);
  table.cell(1, 1).text = "14";
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/coast.pptx", await deck.save());
  const saved = new Uint8Array(volume.readFileSync("/coast.pptx") as Buffer);
  const xml = parseXmlPart(
    inspectZip(saved).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload,
    limits
  );
  expect(elements(xml.root, "t").map((node) => xml.text(node))).toEqual([
    "Channel",
    "Depth",
    "East",
    "14"
  ]);
  expect(attribute(elements(xml.root, "tblPr")[0]!, "firstRow")).toBe("1");
  expect(attribute(elements(xml.root, "tblPr")[0]!, "bandCol")).toBe("1");
  expect(elements(xml.root, "gridCol").map((node) => attribute(node, "w"))).toEqual([
    "1371600",
    "914400"
  ]);
  const reopened = await Presentation(saved, context);
  const read = (reopened.slides[0]!.shapes[0] as GraphicFrame).table;
  expect(read.first_row).toBe(true);
  expect(read.vert_banding).toBe(true);
  expect(read.columns[0]!.width.emu).toBe(1371600);
  expect(read.cell(1, 1).text).toBe("14");
});
