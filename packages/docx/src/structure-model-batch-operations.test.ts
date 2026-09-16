import * as publicApi from "./index.js";
import { expect, it } from "vitest";
import { Volume } from "memfs";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { Document } from "./document-model.js";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";
import { Inches } from "./formatting-values.js";
import { DocxUsageError } from "./argument-json.js";
import { docxOperationSchemas } from "./operation-schema.js";
it("exposes only declared closed model actions and rejects forged owners", () => {
  expect(structureModelBatchActions.size).toBeGreaterThan(100);
  for (const key of structureModelBatchActions.keys())
    expect(docxOperationSchemas[key]).toBeDefined();
  expect(structureModelBatchActions.has("model.document.Document.constructor.call")).toBe(false);
  expect(() =>
    structureModelBatchActions.get("model.comments.Comment.author.get")!({ author: "forged" }, {})
  ).toThrow(DocxUsageError);
});
it("selects admitted document resources and returns original logical model handles", async () => {
  const bytes = await textFixture(paragraph("harbor") + "<w:sectPr/>"),
    v = Volume.fromJSON({ "/input": Buffer.from(bytes) }),
    doc = await Document(new Uint8Array(v.readFileSync("/input") as Buffer), textContext);
  const paragraphs = structureModelBatchActions.get("model.document.Document.paragraphs.get")!(
    doc,
    {}
  ) as typeof doc.paragraphs;
  expect(paragraphs[0]?.text).toBe("harbor");
  const table = structureModelBatchActions.get("model.document.Document.add_table.call")!(doc, {
    rows: 1,
    cols: 2
  }) as ReturnType<typeof doc.add_table>;
  const cells = structureModelBatchActions.get("model.table.Table.cell.call")!(table, {
    rowIdx: 0,
    colIdx: 1
  }) as ReturnType<typeof table.cell>;
  structureModelBatchActions.get("model.table._Cell.text.set")!(cells, { value: "cargo" });
  expect(table.cell(0, 1).text).toBe("cargo");
  const sections = structureModelBatchActions.get("model.document.Document.sections.get")!(
    doc,
    {}
  ) as typeof doc.sections;
  expect(structureModelBatchActions.get("model.section.Sections.__len__.get")!(sections, {})).toBe(
    1
  );
  const comments = doc.comments,
    c = structureModelBatchActions.get("model.comments.Comments.add_comment.call")!(comments, {
      text: "note"
    }) as ReturnType<typeof comments.add_comment>;
  structureModelBatchActions.get("model.comments.Comment.add_table.call")!(c, {
    rows: 1,
    cols: 1,
    width: Inches(1)
  });
  expect(c.tables).toHaveLength(1);
});
it("keeps constructor-owned table row and column collections in the public registry", async () => {
  const doc = await Document(),
    table = doc.add_table(1, 2);
  expect(structureModelBatchActions.get("model.table.Table.rows.get")!(table, {})).toBe(table.rows);
  expect(structureModelBatchActions.get("model.table.Table.columns.get")!(table, {})).toBe(
    table.columns
  );
});
it("retains section sequence helpers and inherited table owners", async () => {
  const doc = await Document(),
    section = doc.sections.at(0),
    table = doc.add_table(1, 1);
  expect(
    structureModelBatchActions.get("model.section.Sections.count.call")!(doc.sections, {
      value: section
    })
  ).toBe(1);
  expect(
    structureModelBatchActions.get("model.section.Sections.__contains__.call")!(doc.sections, {
      value: section
    })
  ).toBe(true);
  expect(structureModelBatchActions.get("model.table._Rows.table.get")!(table.rows, {})).toBe(
    table
  );
  expect(structureModelBatchActions.get("model.table._Row.table.get")!(table.rows.at(0), {})).toBe(
    table
  );
  expect(structureModelBatchActions.get("model.table.Table.table.get")!(table, {})).toBe(table);
});
it("maps declarative length values into admitted physical widths", async () => {
  const doc = await Document(),
    c = doc.comments.add_comment();
  const table = structureModelBatchActions.get("model.comments.Comment.add_table.call")!(c, {
    rows: 1,
    cols: 1,
    width: { value: 2, unit: "in" }
  }) as ReturnType<typeof c.add_table>;
  expect(table.columns.at(0).width?.inches).toBe(2);
});
it("admits the public entry point before closed registry execution", async () => {
  expect(publicApi.Document).toBeTypeOf("function");
  const schema = publicApi.getDocxDiscovery(
    publicApi.validateDocxInvocation({ operation: "schema", inputs: [], options: {} })
  )!.data as publicApi.DocxSchemaData;
  expect(
    schema.operations.some((operation) => operation.id === "model.comments.Comment.comment_id.get")
  ).toBe(true);
  const capabilities = publicApi.getDocxDiscovery(
    publicApi.validateDocxInvocation({ operation: "capabilities", inputs: [], options: {} })
  )!.data as publicApi.DocxCapabilitiesData;
  expect(capabilities.host.binaryStdout).toBe(true);
  const doc = await publicApi.Document();
  expect(
    structureModelBatchActions.get("model.document.Document.sections.get")!(doc, {})
  ).toBeInstanceOf(publicApi.Sections);
});
it("exposes implemented run style and existing-comment range actions", () => {
  expect(structureModelBatchActions.has("model.text.run.Run.style.get")).toBe(true);
  expect(structureModelBatchActions.has("model.text.run.Run.style.set")).toBe(true);
  expect(structureModelBatchActions.has("model.text.run.Run.mark_comment_range.call")).toBe(true);
});
