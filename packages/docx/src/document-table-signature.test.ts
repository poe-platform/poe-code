import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { Document } from "./document-model.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { Inches, WD_STYLE_TYPE } from "./formatting-values.js";
import type { TableStyle } from "./styles-model.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

describe("document table creation style signature", () => {
  it("uses the same positional style semantics through validated typed batch operations", async () => {
    const input = await textFixture(paragraph("Survey") + "<w:sectPr/>");
    const applied = await applyStyleModelBatch(
      input,
      {
        version: 1,
        operations: [
          {
            operation: "model.document.Document.styles.get",
            receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 },
            arguments: {},
            resultHandle: "styles"
          },
          {
            operation: "model.styles.styles.Styles.add_style.call",
            receiver: { resultHandle: "styles" },
            arguments: { name: "Survey grid", styleType: { enum: "WD_STYLE_TYPE", name: "TABLE" } },
            resultHandle: "grid"
          },
          {
            operation: "model.document.Document.add_table.call",
            receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 },
            arguments: { rows: 1, cols: 2, style: "Survey grid" },
            resultHandle: "table"
          },
          {
            operation: "model.table.Table.style.get",
            receiver: { resultHandle: "table" },
            arguments: {},
            resultHandle: "selected"
          },
          {
            operation: "model.styles.style.BaseStyle.name.get",
            receiver: { resultHandle: "selected" },
            arguments: {}
          }
        ]
      },
      textContext
    );
    expect(applied.results.at(-1)).toMatchObject({ value: "Survey grid" });
    const volume = Volume.fromJSON({ "/saved": "" });
    await applied.save({
      async write(bytes) {
        volume.appendFileSync("/saved", bytes);
      }
    });
    const reopened = await Document(
      new Uint8Array(volume.readFileSync("/saved") as Buffer),
      textContext
    );
    expect(reopened.tables[0]!.style!.name).toBe("Survey grid");
  });

  it("accepts names and owned styles, computes page width and survives capability save/reload", async () => {
    const document = await Document(undefined, textContext);
    const style = document.styles.add_style("Survey grid", WD_STYLE_TYPE.TABLE) as TableStyle;
    style.font.bold = true;
    const section = document.sections.at(-1);
    section.page_width = Inches(10);
    section.left_margin = Inches(1);
    section.right_margin = Inches(2);
    for (const value of ["Survey grid", style]) {
      const table = document.add_table(1, 2, value);
      expect(table.style!.equals(style)).toBe(true);
      expect(table.columns.at(0).width!.emu + table.columns.at(1).width!.emu).toBe(Inches(7).emu);
      table.cell(0, 0).text = "Sounding";
    }
    document.add_table(1, 1, null);
    document.add_table(1, 1);
    const volume = Volume.fromJSON({ "/saved": "" });
    await document.save({
      async write(bytes) {
        volume.appendFileSync("/saved", bytes);
      }
    });
    const reopened = await Document(
      new Uint8Array(volume.readFileSync("/saved") as Buffer),
      textContext
    );
    expect(reopened.tables).toHaveLength(4);
    for (const table of reopened.tables.slice(0, 2)) {
      expect(table.style!.name).toBe("Survey grid");
      expect(table.style!.font.bold).toBe(true);
      expect(table.cell(0, 0).text).toBe("Sounding");
    }
    expect(reopened.tables[2]!.style!.equals(reopened.tables[3]!.style)).toBe(true);
  });

  it("rejects unknown, wrong-kind and foreign styles without inserting a table or invalidating handles", async () => {
    const document = await Document(undefined, textContext);
    const paragraph = document.add_paragraph("Retained");
    const foreign = await Document(undefined, textContext);
    const foreignStyle = foreign.styles.add_style(
      "Foreign grid",
      WD_STYLE_TYPE.TABLE
    ) as TableStyle;
    document.styles.add_style("Body style", WD_STYLE_TYPE.PARAGRAPH);
    for (const value of ["Missing grid", "Body style", foreignStyle]) {
      const before = document.store.xml(document.store.mainPart).serialize();
      expect(() => document.add_table(1, 1, value)).toThrow();
      expect(document.tables).toHaveLength(0);
      expect(document.store.xml(document.store.mainPart).serialize()).toEqual(before);
      expect(paragraph.text).toBe("Retained");
    }
    paragraph.add_run(" live");
    expect(paragraph.text).toBe("Retained live");
  });
});
