import { expect, it } from "vitest";
import { Volume } from "memfs";
import { parseDocumentXml } from "./package-xml.js";
import { editDocumentTables } from "./table-edit.js";
import { getDocumentXml, inspectDocumentTable, openDocumentLocations } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const cell = (text: string, props = "") => `<w:tc><w:tcPr>${props}</w:tcPr>${text ? paragraph(text) : '<w:p/>'}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const table = (widths: number[], ...rows: string[]) => `<w:tbl><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;

const labels = ["Amber", "Birch", "Cedar", "Dune", "Elm", "Fern", "Grove", "Heath", "Iris"];
const layouts: Record<string, readonly (readonly [number, number, number, number])[]> = {
  uniform: [], upper: [[1, 1, 1, 2]], upright: [[1, 2, 2, 1]],
  combined: [[1, 1, 1, 2], [2, 1, 2, 1], [2, 2, 2, 2]],
  crossbar: [[2, 1, 1, 3]], pillar: [[1, 2, 3, 1]],
  middle: [[2, 1, 1, 2]], lower: [[2, 2, 2, 1]]
};
function grid(layout: string): string {
  const rows: string[] = [];
  for (let r = 1; r <= 3; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= 3; c++) {
      const span = layouts[layout]!.find(([top, left, height, width]) => r >= top && r < top + height && c >= left && c < left + width);
      if (span && c !== span[1]) continue;
      const continuation = span && r !== span[0];
      const props = span ? (span[3] > 1 ? `<w:gridSpan w:val="${span[3]}"/>` : "") + (span[2] > 1 ? `<w:vMerge w:val="${continuation ? "continue" : "restart"}"/>` : "") : "";
      cells.push(cell(continuation ? "" : labels[(r - 1) * 3 + c - 1]!, props));
    }
    rows.push(row(...cells));
  }
  return table([1440, 1440, 1440], ...rows);
}

async function merge(source: string, from: string, to: string, join: "paragraphs" | "reject" = "paragraphs") {
  const bytes = await textFixture(source), volume = Volume.fromJSON({ "/out": "" });
  try {
    await editDocumentTables(bytes, { operation: "tables.merge", options: { table: 1, from, to, join, output: "-" } }, {
      ...textContext, encoding: { order: "input", compression: "store" },
      stdout: { async write(chunk) { volume.appendFileSync("/out", chunk); } }
    });
  } catch (error) { expect(volume.readFileSync("/out")).toHaveLength(0); throw error; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const details = (await inspectDocumentTable(output, { table: 1 }, textContext)).item.details;
  const xml = new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { output, details, xml };
}

it("merges structurally empty cells with the explicit reject policy", async () => {
  const result = await merge(table([1000, 2000], row(cell(""), cell("")), row(cell(""), cell(""))), "A1", "B2", "reject");
  expect(result.details.cells).toMatchObject([{ rowSpan: 2, columnSpan: 2, text: "" }]);
  expect(result.xml).toContain('m:w="3000"');
});

it.each(["left", "right"])("absorbs an existing %s horizontal span and sums its grid widths", async side => {
  const source = table([1000, 2000, 3000], side === "left"
    ? row(cell("West", '<w:gridSpan w:val="2"/>'), cell("East"))
    : row(cell("West"), cell("East", '<w:gridSpan w:val="2"/>')));
  const result = await merge(source, "A1", "C1");
  expect(result.details.cells).toMatchObject([{ row: 1, column: 1, rowSpan: 1, columnSpan: 3, text: "West\nEast" }]);
  expect(result.xml).toContain('m:w="6000"');
});

it.each(["left", "right"])("absorbs an empty %s horizontal span under the reject policy", async side => {
  const source = table([1000, 1000, 1000], side === "left"
    ? row(cell("", '<w:gridSpan w:val="2"/>'), cell(""))
    : row(cell(""), cell("", '<w:gridSpan w:val="2"/>')));
  const result = await merge(source, "A1", "C1", "reject");
  expect(result.details.cells).toMatchObject([{ row: 1, column: 1, columnSpan: 3, text: "" }]);
  const root = parseDocumentXml(new TextEncoder().encode(result.xml), {}).root;
  const cells = root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!.children.find(n => n.localName === "tr")!.children.filter(n => n.localName === "tc");
  expect(cells).toHaveLength(1);
  expect(cells[0]!.children.filter(n => n.localName !== "tcPr")).toMatchObject([{ localName: "p", children: [] }]);
});

it.each(["top", "bottom"])("absorbs an existing %s vertical span without changing reading order", async side => {
  const texts = side === "top" ? ["North", "", "South"] : ["North", "South", ""];
  const source = table([1000, 2000], ...texts.map((text, index) => row(
    cell(text, index === (side === "top" ? 0 : 1) ? '<w:vMerge w:val="restart"/>' : index === (side === "top" ? 1 : 2) ? '<w:vMerge/>' : ""),
    cell(["East", "Center", "West"][index]!)
  )));
  const result = await merge(source, "A1", "B3");
  expect(result.details.cells).toMatchObject([{ rowSpan: 3, columnSpan: 2, text: side === "top" ? "North\nEast\nCenter\nSouth\nWest" : "North\nEast\nSouth\nCenter\nWest" }]);
  expect(result.xml.split('m:w="3000"')).toHaveLength(4);
});

it("merges an off-origin rectangle and resolves every slot without changing neighboring cells", async () => {
  const source = table([1000, 2000, 3000], row(cell("Northwest"), cell("North"), cell("Northeast")), row(cell("West"), cell("Inner"), cell("East")), row(cell("Southwest"), cell("South"), cell("Southeast")));
  const result = await merge(source, "B2", "C3");
  expect(result.details.cells.map(c => c.text)).toEqual(["Northwest", "North", "Northeast", "West", "Inner\nEast\nSouth\nSoutheast", "Southwest"]);
  const document = await openDocumentLocations(result.output, textContext), token = document.at("table", 1).token;
  const owner = document.cell(token, "B2").token;
  for (const coordinate of ["B2", "C2", "B3", "C3"]) expect(document.cell(token, coordinate).token).toBe(owner);
  for (const coordinate of ["A1", "B1", "C1", "A2", "A3"]) expect(document.cell(token, coordinate).token).not.toBe(owner);
  expect(result.xml.split('m:w="5000"')).toHaveLength(3);
});

it.each([1, 2, 4])("resolves and retains all aliases of an explicit horizontal span of %s", async span => {
  const source = table(Array.from({ length: span }, () => 1000), row(cell("Owner", `<w:gridSpan w:val="${span}"/>`)));
  const before = (await inspectDocumentTable(await textFixture(source), { table: 1 }, textContext)).item.details;
  expect(before.cells).toMatchObject([{ columnSpan: span, text: "Owner" }]);
  const result = await merge(source, "A1", `${String.fromCharCode(64 + span)}1`);
  expect(result.details.cells).toMatchObject([{ columnSpan: span, text: "Owner" }]);
  const document = await openDocumentLocations(result.output, textContext), token = document.at("table", 1).token;
  for (let i = 0; i < span; i++) expect(document.cell(token, `${String.fromCharCode(65 + i)}1`).token).toBe(document.cell(token, "A1").token);
  expect(result.xml).toContain(`m:w="${span * 1000}"`);
});

it.each(["before", "after"].flatMap(side => [0, 1, 2, 3, 4].map(count => ({ side, count }))))("reports $count omitted slots $side and rejects nonrectangular merge edits", async ({ side, count }) => {
  const props = `<w:trPr><w:${side === "before" ? "gridBefore" : "gridAfter"} w:val="${count}"/></w:trPr>`;
  const source = table(Array.from({ length: count + 2 }, () => 1000), `<w:tr>${props}${cell("Left")}${cell("Right")}</w:tr>`);
  const details = (await inspectDocumentTable(await textFixture(source), { table: 1 }, textContext)).item.details;
  expect(details.omitted).toEqual([{ row: 1, before: side === "before" ? count : 0, after: side === "after" ? count : 0 }]);
  const first = side === "before" ? count : 0;
  const operation = merge(source, `${String.fromCharCode(65 + first)}1`, `${String.fromCharCode(66 + first)}1`);
  if (count) await expect(operation).rejects.toMatchObject({ code: "unsupported-edit" });
  else expect((await operation).details.cells).toMatchObject([{ columnSpan: 2, text: "Left\nRight" }]);
});

it.each(["absent", "empty", "one", "four"])("reads the %s cell span property before mutation", async state => {
  const span = state === "four" ? 4 : 1;
  const props = state === "absent" ? "" : state === "empty" ? '<w:tcPr/>' : `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>`;
  const bytes = await textFixture(table(Array.from({ length: span }, () => 1000), row(`<w:tc>${props}${paragraph("Owner")}</w:tc>`)));
  const details = (await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
  expect(details.cells).toMatchObject([{ columnSpan: span, text: "Owner" }]);
});

it.each(["absent", "empty"])("reads zero omitted slots with %s row properties", async state => {
  const source = table([1000], `<w:tr>${state === "empty" ? '<w:trPr/>' : ""}${cell("Kept")}</w:tr>`);
  const details = (await inspectDocumentTable(await textFixture(source), { table: 1 }, textContext)).item.details;
  expect(details.omitted).toEqual([{ row: 1, before: 0, after: 0 }]);
});

it("merges empty cells after an untouched leading cell", async () => {
  const result = await merge(table([1000, 1000, 1000], row(cell("Kept"), cell(""), cell(""))), "B1", "C1", "reject");
  expect(result.details.cells).toMatchObject([{ column: 1, columnSpan: 1, text: "Kept" }, { column: 2, columnSpan: 2, text: "" }]);
});

it.each([
  { kind: "empty pair", leading: '<w:p/>', trailing: '<w:p/>', retained: '<m:p ', blocks: ["p"] },
  { kind: "empty then run", leading: '<w:p/>', trailing: '<w:p><w:r/></w:p>', retained: '<w:r/>', blocks: ["p"] },
  { kind: "run then empty", leading: '<w:p><w:r/></w:p>', trailing: '<w:p/>', retained: '<w:r/>', blocks: ["p"] },
  { kind: "control after empty", leading: '<w:p/>', trailing: '<w:p><w:r/></w:p><w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>', retained: '<w:sdtContent><w:p/></w:sdtContent>', blocks: ["p", "sdt"] },
  { kind: "control after nested table", leading: table([1000], row(cell("Nested"))) + '<w:p/>', trailing: '<w:p><w:r/></w:p><w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>', retained: '<w:sdtContent><w:p/></w:sdtContent>', blocks: ["tbl", "p", "p", "sdt"] }
])("retains structural content for $kind", async ({ leading, trailing, retained, blocks }) => {
  const result = await merge(table([1000, 1000], row(`<w:tc>${leading}</w:tc>`, `<w:tc>${trailing}</w:tc>`)), "A1", "B1");
  expect(result.xml).toContain(retained);
  expect(result.details.cells).toHaveLength(1);
  const root = parseDocumentXml(new TextEncoder().encode(result.xml), {}).root;
  const merged = root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!.children.find(n => n.localName === "tr")!.children.filter(n => n.localName === "tc");
  expect(merged).toHaveLength(1);
  expect(merged[0]!.children.filter(n => n.localName !== "tcPr").map(n => n.localName)).toEqual(blocks);
  if (leading.includes("Nested")) expect(result.xml.indexOf("Nested")).toBeLessThan(result.xml.indexOf("sdtContent"));
});

it.each([
  { layout: "uniform", from: "A1", to: "B1", row: 1, column: 1, rowSpan: 1, columnSpan: 2 },
  { layout: "uniform", from: "B1", to: "B3", row: 1, column: 2, rowSpan: 3, columnSpan: 1 },
  { layout: "uniform", from: "B2", to: "C3", row: 2, column: 2, rowSpan: 2, columnSpan: 2 },
  { layout: "uniform", from: "A2", to: "C2", row: 2, column: 1, rowSpan: 1, columnSpan: 3 },
  { layout: "upper", from: "A1", to: "B2", row: 1, column: 1, rowSpan: 2, columnSpan: 2 },
  { layout: "upper", from: "A1", to: "C1", row: 1, column: 1, rowSpan: 1, columnSpan: 3 },
  { layout: "upright", from: "B1", to: "B3", row: 1, column: 2, rowSpan: 3, columnSpan: 1 },
  { layout: "upright", from: "A1", to: "B2", row: 1, column: 1, rowSpan: 2, columnSpan: 2 },
  { layout: "upright", from: "B1", to: "C2", row: 1, column: 2, rowSpan: 2, columnSpan: 2 },
  { layout: "combined", from: "A1", to: "C1", row: 1, column: 1, rowSpan: 1, columnSpan: 3 },
  { layout: "uniform", from: "B1", to: "B2", row: 1, column: 2, rowSpan: 2, columnSpan: 1 },
  { layout: "upright", from: "C2", to: "C3", row: 2, column: 3, rowSpan: 2, columnSpan: 1 }
])("resolves $layout geometry $from:$to and preserves the full resulting rectangle", async ({ layout, from, to, ...extent }) => {
  const result = await merge(grid(layout), from, to);
  const owner = result.details.cells.find(c => c.row === extent.row && c.column === extent.column)!;
  expect(owner).toMatchObject(extent);
  const document = await openDocumentLocations(result.output, textContext), token = document.at("table", 1).token;
  for (let r = extent.row; r < extent.row + extent.rowSpan; r++) {
    for (let c = extent.column; c < extent.column + extent.columnSpan; c++) expect(document.cell(token, `${String.fromCharCode(64 + c)}${r}`).token).toBe(document.cell(token, from).token);
  }
  const root = parseDocumentXml(new TextEncoder().encode(result.xml), {}).root;
  const rows = root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!.children.filter(n => n.localName === "tr");
  for (let r = extent.row; r < extent.row + extent.rowSpan; r++) {
    let column = 1;
    for (const physical of rows[r - 1]!.children.filter(n => n.localName === "tc")) {
      const props = physical.children.find(n => n.localName === "tcPr");
      const span = Number(props?.children.find(n => n.localName === "gridSpan")?.attributes.find(a => a.localName === "val")?.value ?? 1);
      if (column === extent.column) {
        expect(span).toBe(extent.columnSpan);
        const marker = props?.children.find(n => n.localName === "vMerge");
        expect(marker?.attributes.find(a => a.localName === "val")?.value).toBe(extent.rowSpan === 1 ? undefined : r === extent.row ? "restart" : "continue");
        if (r !== extent.row) expect(physical.children.filter(n => n.localName !== "tcPr")).toMatchObject([{ localName: "p", children: [] }]);
      }
      column += span;
    }
  }
});

it.each([
  { layout: "upper", from: "A1", to: "A2" },
  { layout: "upper", from: "A2", to: "A1" },
  { layout: "upright", from: "B1", to: "C1" },
  { layout: "crossbar", from: "B1", to: "B2" },
  { layout: "crossbar", from: "B2", to: "B3" },
  { layout: "pillar", from: "A2", to: "B2" },
  { layout: "pillar", from: "B2", to: "C2" }
])("rejects a partial $layout intersection at $from:$to", async ({ layout, from, to }) => {
  await expect(merge(grid(layout), from, to)).rejects.toMatchObject({ code: from === "A2" && to === "A1" ? "usage" : "ambiguous-selection" });
});

it("absorbs a continuation row with single double single spans into its leading owner", async () => {
  const source = table([1440, 1440, 1440, 1440],
    row(cell("Owner", '<w:gridSpan w:val="4"/>')),
    row(cell("West"), cell("Center", '<w:gridSpan w:val="2"/>'), cell("East")));
  const result = await merge(source, "A1", "D2");
  expect(result.details.cells).toMatchObject([{ rowSpan: 2, columnSpan: 4, text: "Owner\nWest\nCenter\nEast" }]);
  const root = parseDocumentXml(new TextEncoder().encode(result.xml), {}).root;
  const rows = root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!.children.filter(n => n.localName === "tr");
  for (const [index, row] of rows.entries()) {
    const cells = row.children.filter(n => n.localName === "tc");
    expect(cells).toHaveLength(1);
    const props = cells[0]!.children.find(n => n.localName === "tcPr")!;
    expect(props.children.find(n => n.localName === "gridSpan")!.attributes.find(a => a.localName === "val")!.value).toBe("4");
    expect(props.children.find(n => n.localName === "vMerge")!.attributes.find(a => a.localName === "val")!.value).toBe(index ? "continue" : "restart");
    if (index) expect(cells[0]!.children.filter(n => n.localName === "p")).toMatchObject([{ children: [] }]);
  }
});

it.each([
  { layout: "uniform", from: "A1", to: "B1", text: "Amber\nBirch", slots: [0, 1], width: 2880 },
  { layout: "uniform", from: "B1", to: "B2", text: "Birch\nElm", slots: [1, 4], width: 1440 },
  { layout: "uniform", from: "B2", to: "C3", text: "Elm\nFern\nHeath\nIris", slots: [4, 5, 7, 8], width: 2880 },
  { layout: "middle", from: "A2", to: "B3", text: "Dune\nGrove\nHeath", slots: [3, 4, 6, 7], width: 2880 },
  { layout: "middle", from: "A2", to: "C2", text: "Dune\nFern", slots: [3, 4, 5], width: 4320 },
  { layout: "middle", from: "A1", to: "B2", text: "Amber\nBirch\nDune", slots: [0, 1, 3, 4], width: 2880 },
  { layout: "lower", from: "B2", to: "C3", text: "Elm\nFern\nIris", slots: [4, 5, 7, 8], width: 2880 },
  { layout: "lower", from: "B1", to: "B3", text: "Birch\nElm", slots: [1, 4, 7], width: 1440 },
  { layout: "lower", from: "A2", to: "B3", text: "Dune\nElm\nGrove", slots: [3, 4, 6, 7], width: 2880 },
  { layout: "uniform", from: "A1", to: "B2", text: "Amber\nBirch\nDune\nElm", slots: [0, 1, 3, 4], width: 2880 }
])("preserves every logical text and width for $layout content $from:$to", async ({ layout, from, to, text, slots, width }) => {
  const result = await merge(grid(layout), from, to);
  const document = await openDocumentLocations(result.output, textContext), token = document.at("table", 1).token;
  const owner = document.cell(token, from).token;
  for (let i = 0; i < 9; i++) {
    const coordinate = `${String.fromCharCode(65 + i % 3)}${Math.floor(i / 3) + 1}`;
    const selected = document.cell(token, coordinate);
    const logical = result.details.cells.find(c => c.row <= Math.floor(i / 3) + 1 && c.row + c.rowSpan > Math.floor(i / 3) + 1 && c.column <= i % 3 + 1 && c.column + c.columnSpan > i % 3 + 1)!;
    expect(logical.text).toBe(slots.includes(i) ? text : labels[i]);
    if (slots.includes(i)) expect(selected.token).toBe(owner);
    else expect(selected.token).not.toBe(owner);
  }
  expect(result.xml).toContain(`m:w="${width}"`);
  const root = parseDocumentXml(new TextEncoder().encode(result.xml), {}).root;
  const rows = root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!.children.filter(n => n.localName === "tr");
  let column = 1;
  for (const physical of rows[Number(from.slice(1)) - 1]!.children.filter(n => n.localName === "tc")) {
    const props = physical.children.find(n => n.localName === "tcPr");
    if (column === from.charCodeAt(0) - 64) expect(props?.children.find(n => n.localName === "tcW")?.attributes.find(a => a.localName === "w")?.value).toBe(String(width));
    column += Number(props?.children.find(n => n.localName === "gridSpan")?.attributes.find(a => a.localName === "val")?.value ?? 1);
  }
});
