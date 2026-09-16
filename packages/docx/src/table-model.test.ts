import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { Table } from "./table-model.js";
import { ModelStore as Store, type ModelRef } from "./model-store.js";
import type { ModelStore } from "./model-store.js";
import { readDocumentArchive } from "./admission.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { modelContext } from "./model-context.js";
import { DocumentXmlEditor } from "./xml-write.js";
import type { XmlElement } from "./package-xml.js";
import {
  Inches,
  WD_TABLE_ALIGNMENT,
  WD_ROW_HEIGHT_RULE,
  WD_STYLE_TYPE,
  WD_TABLE_DIRECTION,
  WD_CELL_VERTICAL_ALIGNMENT
} from "./formatting-values.js";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const p = (text = "") => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (text = "", props = "") => `<w:tc><w:tcPr>${props}</w:tcPr>${p(text)}</w:tc>`;
function fixture(rows: string, columns = 3) {
  const fs = Volume.fromJSON({
    "/document.xml": `<w:document xmlns:w="${w}"><w:body><w:tbl><w:tblGrid>${'<w:gridCol w:w="1440"/>'.repeat(columns)}</w:tblGrid>${rows}</w:tbl></w:body></w:document>`
  });
  let xml = new DocumentXmlEditor(
    new TextEncoder().encode(fs.readFileSync("/document.xml", "utf8") as string)
  );
  const paths = new Map<number, number[]>();
  let next = 0;
  const node = (ref: ModelRef) => paths.get(ref.id)!.reduce((n, i) => n.children[i]!, xml.root);
  const ref = (part: string, target: XmlElement): ModelRef => {
    const walk = (n: XmlElement, path: number[]): number[] | undefined =>
      n === target ? path : n.children.map((c, i) => walk(c, [...path, i])).find(Boolean);
    const path = walk(xml.root, [])!;
    const old = [...paths].find(([, p]) => JSON.stringify(p) === JSON.stringify(path));
    if (old) return { part, id: old[0] };
    const id = next++;
    paths.set(id, path);
    return { part, id };
  };
  const store = {
    context: modelContext(),
    xml: () => xml,
    node,
    ref,
    change: (_: string, action: (editor: DocumentXmlEditor) => void) => {
      action(xml);
      fs.writeFileSync("/document.xml", xml.serialize());
      xml = new DocumentXmlEditor(new Uint8Array(fs.readFileSync("/document.xml") as Buffer));
    },
    blocks: function* (r: ModelRef) {
      for (const n of node(r).children) {
        if (n.localName === "p")
          yield {
            text: n.children
              .flatMap((r) => r.children)
              .map((t) =>
                t.content
                  .filter((c) => c.kind === "text")
                  .map((c) => c.text)
                  .join("")
              )
              .join("")
          };
        else if (n.localName === "tbl")
          yield new Table(store as unknown as ModelStore, ref(r.part, n));
      }
    },
    table: (r: ModelRef) => new Table(store as unknown as ModelStore, r),
    element: () => ({}),
    part: () => ({})
  };
  return {
    table: new Table(
      store as unknown as ModelStore,
      ref("/document.xml", xml.root.children[0]!.children[0]!)
    ),
    fs
  };
}

describe("live table model", () => {
  it("distinguishes absent row slots from empty cells and repeats merged logical owners", () => {
    const { table } = fixture(
      `<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>${tc("Owner", '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>')}</w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>${tc("", '<w:gridSpan w:val="2"/><w:vMerge/>')}</w:tr><w:tr>${tc()}${tc("B")}${tc("C")}</w:tr>`
    );
    expect(table.rows.at(0).grid_cols_before).toBe(1);
    expect(table.rows.at(0).grid_cols_after).toBe(0);
    expect(table.rows.at(0).cells).toHaveLength(2);
    expect(table.cell(0, 1)).toBe(table.cell(0, 2));
    expect(table.cell(0, 1)).toBe(table.cell(1, 1));
    expect(table.cell(0, 1).grid_span).toBe(2);
    expect(() => table.cell(0, 0)).toThrow(RangeError);
    expect(table.cell(2, 0).text).toBe("");
    expect(table.column_cells(1)).toHaveLength(3);
    expect(table.rows.at(-1).table).toBe(table);
    expect([...table.columns]).toHaveLength(3);
  });
  it("keeps direct nested paragraph and table order without flattening descendants", () => {
    const nested = `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr>${tc("Inner")}</w:tr></w:tbl>`;
    const { table } = fixture(`<w:tr><w:tc>${p("Before")}${nested}${p("After")}</w:tc></w:tr>`, 1);
    const cell = table.cell(0, 0);
    expect(cell.paragraphs.map((p) => p.text)).toEqual(["Before", "After"]);
    expect(cell.tables).toHaveLength(1);
    expect(
      [...cell.iter_inner_content()].map((item) => (item instanceof Table ? "table" : item.text))
    ).toEqual(["Before", "table", "After"]);
    expect(cell.text).toBe("Before\nAfter");
  });
  it("mutates nullable table, row and column formatting while preserving other properties", () => {
    const { table, fs } = fixture(`<w:tr>${tc("A")}${tc()}${tc()}</w:tr>`);
    table.alignment = WD_TABLE_ALIGNMENT.CENTER;
    table.autofit = false;
    table.rows.at(0).height = Inches(0.5);
    table.rows.at(0).height_rule = WD_ROW_HEIGHT_RULE.EXACTLY;
    table.columns.at(0).width = Inches(2);
    expect(table.alignment).toBe(WD_TABLE_ALIGNMENT.CENTER);
    expect(table.autofit).toBe(false);
    expect(table.rows.at(0).height?.inches).toBe(0.5);
    expect(table.rows.at(0).height_rule).toBe(WD_ROW_HEIGHT_RULE.EXACTLY);
    expect(table.columns.at(0).width?.inches).toBe(2);
    table.alignment = null;
    expect(table.alignment).toBeNull();
    expect(fs.readFileSync("/document.xml", "utf8")).toContain("tblLayout");
  });
  it("adds a row and column using declared widths and preserves existing values", () => {
    const { table } = fixture(`<w:tr>${tc("A")}${tc("B")}${tc("C")}</w:tr>`);
    expect(table.add_row().cells).toHaveLength(3);
    expect(table.add_column(Inches(1)).cells).toHaveLength(2);
    expect(table.rows.length).toBe(2);
    expect(table.columns.length).toBe(4);
    expect(table.cell(0, 0).text).toBe("A");
    expect(table.cell(1, 3).text).toBe("");
  });
  it("merges a rectangle with ordered paragraph content and common logical aliases", () => {
    const { table } = fixture(
      `<w:tr>${tc("A")}${tc("B")}</w:tr><w:tr>${tc("C")}${tc("D")}</w:tr>`,
      2
    );
    const merged = table.cell(0, 0).merge(table.cell(1, 1));
    expect(merged.text).toBe("A\nB\nC\nD");
    expect(table.cell(1, 1)).toBe(table.cell(0, 0));
    expect(merged.grid_span).toBe(2);
  });
});

it("retains live owners across row/column insertion and persists table styles with the shared document", async () => {
  const bytes = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${tc("Kept")}${tc("Other")}</w:tr></w:tbl>`
  );
  const store = new Store(
    await readDocumentArchive(bytes, textContext),
    modelContext(textContext),
    "/word/document.xml"
  );
  const tableNode = store
    .xml(store.mainPart)
    .root.children[0]!.children.find((n) => n.localName === "tbl")!;
  const table = store.table(store.ref(store.mainPart, tableNode)),
    kept = table.cell(0, 0);
  const style = store.styles.add_style("Harbor Grid", WD_STYLE_TYPE.TABLE);
  table.style = style;
  table.style!.name = "Harbor Lines";
  table.add_column(Inches(1));
  table.add_row();
  expect(kept.text).toBe("Kept");
  kept.text = "Changed";
  expect(table.cell(0, 0)).toBe(kept);
  expect(table.columns.length).toBe(3);
  expect(table.style!.name).toBe("Harbor Lines");
  const fs = Volume.fromJSON({ "/saved": "" });
  await store.save({
    async write(chunk) {
      fs.appendFileSync("/saved", chunk);
    }
  });
  const reopened = new Store(
    await readDocumentArchive(new Uint8Array(fs.readFileSync("/saved") as Buffer), textContext),
    modelContext(textContext),
    "/word/document.xml"
  );
  const fresh = reopened.table(
    reopened.ref(
      reopened.mainPart,
      reopened.xml(reopened.mainPart).root.children[0]!.children.find((n) => n.localName === "tbl")!
    )
  );
  expect(fresh.style!.name).toBe("Harbor Lines");
  expect(fresh.cell(0, 0).text).toBe("Changed");
});

it("clears row height and rule independently without discarding the other attribute", () => {
  const { table } = fixture(
    `<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="exact"/></w:trPr>${tc()}</w:tr>`,
    1
  );
  const row = table.rows.at(0);
  row.height = null;
  expect(row.height).toBeNull();
  expect(row.height_rule).toBe(WD_ROW_HEIGHT_RULE.EXACTLY);
  row.height = Inches(1);
  row.height_rule = null;
  expect(row.height?.inches).toBe(1);
  expect(row.height_rule).toBe(WD_ROW_HEIGHT_RULE.AT_LEAST);
});

it("rejects a paragraph style from another owner before inserting a cell paragraph", async () => {
  const bytes = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${tc("Keep")}</w:tr></w:tbl>`
  );
  const context = modelContext(textContext),
    first = new Store(await readDocumentArchive(bytes, textContext), context, "/word/document.xml"),
    other = new Store(
      await readDocumentArchive(bytes, textContext),
      modelContext(textContext),
      "/word/document.xml"
    );
  first.styles.add_style("Local paragraph", WD_STYLE_TYPE.PARAGRAPH);
  const foreign = other.styles.add_style("Foreign paragraph", WD_STYLE_TYPE.PARAGRAPH);
  const table = first.table(
    first.ref(
      first.mainPart,
      first.xml(first.mainPart).root.children[0]!.children.find((n) => n.localName === "tbl")!
    )
  );
  expect(() => table.cell(0, 0).add_paragraph("Rejected", foreign)).toThrow();
  expect(table.cell(0, 0).text).toBe("Keep");
});

it("returns its own public table owner", () => {
  const { table } = fixture(`<w:tr>${tc()}</w:tr>`, 1);
  expect(table.table).toBe(table);
});

it("exposes inherited table views, formatting, collection slicing and nested creation", async () => {
  const bytes = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${tc("Keep")}</w:tr></w:tbl>`
  );
  const store = new Store(
    await readDocumentArchive(bytes, textContext),
    modelContext(textContext),
    "/word/document.xml"
  );
  const table = store.table(
    store.ref(
      store.mainPart,
      store.xml(store.mainPart).root.children[0]!.children.find((n) => n.localName === "tbl")!
    )
  );
  const cell = table.cell(0, 0),
    row = table.rows.at(0),
    column = table.columns.at(0);
  expect([cell.part, row.part, column.part, table.rows.part, table.columns.part]).toEqual(
    Array(5).fill(table.part)
  );
  expect(
    [cell.element, row.element, column.element, table.element].map((n) => n.localName)
  ).toEqual(["tc", "tr", "gridCol", "tbl"]);
  expect([row.table, column.table, table.rows.table, table.columns.table]).toEqual(
    Array(4).fill(table)
  );
  expect(table.rows.slice(0, 1)).toEqual([row]);
  expect([...table.rows]).toEqual([row]);
  expect(column.cells).toEqual([cell]);
  expect(table.row_cells(0)).toEqual([cell]);
  table.table_direction = WD_TABLE_DIRECTION.RTL;
  expect(table.table_direction).toBe(WD_TABLE_DIRECTION.RTL);
  table.table_direction = null;
  expect(table.table_direction).toBeNull();
  expect("direction" in table).toBe(false);
  cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER;
  expect(cell.vertical_alignment).toBe(WD_CELL_VERTICAL_ALIGNMENT.CENTER);
  cell.vertical_alignment = null;
  expect(cell.vertical_alignment).toBeNull();
  cell.width = Inches(1);
  expect(cell.width?.inches).toBe(1);
  cell.width = null;
  expect(cell.width).toBeNull();
  column.width = null;
  expect(column.width).toBeNull();
  const appended = cell.add_paragraph("Next");
  expect(appended.text).toBe("Next");
  const nested = cell.add_table(1, 1);
  expect(nested.cell(0, 0).text).toBe("");
  expect(cell.tables).toEqual([nested]);
  expect(cell.paragraphs.map((p) => p.text)).toEqual(["Keep", "Next", ""]);
  const paragraphCount = cell.paragraphs.length;
  expect(() => {
    cell.text = "Unsafe replacement";
  }).toThrow();
  expect(cell.paragraphs).toHaveLength(paragraphCount);
  expect(() => table.rows.at(2)).toThrow(RangeError);
  expect(() => table.columns.at(1.5)).toThrow(TypeError);
});

it("rejects metadata and owner traversal from detached table owners", async () => {
  const bytes = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${tc("A")}${tc("B")}</w:tr></w:tbl>`
  );
  const store = new Store(
    await readDocumentArchive(bytes, textContext),
    modelContext(textContext),
    "/word/document.xml"
  );
  const table = store.table(
    store.ref(
      store.mainPart,
      store.xml(store.mainPart).root.children[0]!.children.find((n) => n.localName === "tbl")!
    )
  );
  const absorbed = table.cell(0, 1);
  table.cell(0, 0).merge(absorbed);
  expect(() => absorbed.text).toThrow();
  expect(() => absorbed.part).toThrow();
  expect(() => absorbed.table).toThrow();
  const cell = table.cell(0, 0),
    row = table.rows.at(0),
    column = table.columns.at(0),
    rows = table.rows,
    columns = table.columns;
  store.change(store.mainPart, (xml) => xml.replaceElement(store.node(table.ref), ""));
  for (const owner of [table, cell, row, column, rows, columns]) {
    expect(() => owner.part).toThrow();
    expect(() => owner.table).toThrow();
  }
});
