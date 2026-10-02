import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, InputTypeError, StaleHandleError } from "./index.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it("checks row slice types through the same closed action as direct model access", async () => {
  const document = await Document();
  const rows = document.add_table(2, 1).rows;
  const slice = structureModelBatchActions.get("model.table._Rows.__getitem__.slice")!;
  for (const start of [0.5, NaN, Infinity, "0", null]) {
    expect(() => slice(rows, { start })).toThrow(InputTypeError);
  }
  expect(slice(rows, { start: -1 })).toEqual([rows.at(-1)]);
  expect(slice(rows, { start: 0, end: 1 })).toEqual([rows.at(0)]);
});

it("validates detached table receivers before returning their self owner", async () => {
  const document = await Document();
  const owner = document.add_table(1, 1);
  const get = structureModelBatchActions.get("model.table.Table.table.get")!;
  expect(get(owner, {})).toBe(owner);
  document.store.change(owner.ref.part, (xml) =>
    xml.replaceElement(document.store.node(owner.ref), "")
  );
  expect(() => owner.table).toThrow(StaleHandleError);
  expect(() => get(owner, {})).toThrow(StaleHandleError);
});

it("keeps row slicing and owner metadata on the declared SDK batch graph", async () => {
  const input = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${paragraph("First")}</w:tc></w:tr><w:tr><w:tc>${paragraph("Second")}</w:tc></w:tr></w:tbl>`
  );
  const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
  const result = await applyStyleModelBatch(
    new Uint8Array(volume.readFileSync("/input") as Buffer),
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.tables.get",
          receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 },
          arguments: {},
          resultHandle: "tables"
        },
        {
          operation: "model.table.Table.rows.get",
          receiver: { resultHandle: "tables", index: 0 },
          arguments: {},
          resultHandle: "rows"
        },
        {
          operation: "model.table._Rows.__getitem__.slice",
          receiver: { resultHandle: "rows" },
          arguments: { start: -1 },
          resultHandle: "last"
        },
        {
          operation: "model.table._Row.cells.get",
          receiver: { resultHandle: "last", index: 0 },
          arguments: {},
          resultHandle: "cells"
        },
        {
          operation: "model.table._Cell.text.get",
          receiver: { resultHandle: "cells", index: 0 },
          arguments: {}
        }
      ]
    },
    textContext
  );
  expect(result.results.at(-1)?.value).toBe("Second");
  expect(result.affected).toBe(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
