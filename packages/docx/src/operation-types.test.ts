import { expectTypeOf, it } from "vitest";
import type { DocxOperationArguments, DocxBatchItem } from "./index.js";

it("retains required, optional and nullable operation argument types", () => {
  expectTypeOf<DocxOperationArguments<"text.replace">["find"]>().toEqualTypeOf<string>();
  expectTypeOf<DocxOperationArguments<"text.replace">["with"]>().toEqualTypeOf<string>();
  expectTypeOf<DocxOperationArguments<"text.replace">["first"]>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<DocxOperationArguments<"model.text.run.Run.bold.set">["value"]>().toEqualTypeOf<boolean | null>();
  expectTypeOf<DocxOperationArguments<"properties.set">["type"]>().toEqualTypeOf<"string" | "boolean" | "integer" | "number" | "date" | undefined>();
  expectTypeOf<DocxOperationArguments<"create">["kind"]>().toEqualTypeOf<"docx" | "dotx" | undefined>();
});

it("keeps publication outside typed batch items and requires model receivers", () => {
  // @ts-expect-error Batch items do not carry publication destinations.
  const nestedOutput: DocxBatchItem = { operation: "text.replace", arguments: { find: "draft", with: "final", output: "final.docx" } };
  // @ts-expect-error This model member requires an explicit receiver.
  const missingReceiver: DocxBatchItem = { operation: "model.text.run.Run.bold.set", arguments: { value: true } };
  expectTypeOf(nestedOutput).toMatchTypeOf<DocxBatchItem>();
  expectTypeOf(missingReceiver).toMatchTypeOf<DocxBatchItem>();
});

it("allows explicit optional undefined and closes empty model arguments", () => {
  const absent: DocxOperationArguments<"paragraphs.set"> = { text: undefined, style: undefined };
  // @ts-expect-error A no-argument getter has no extension fields.
  const extra: DocxOperationArguments<"model.text.run.Run.bold.get"> = { unexpected: true };
  expectTypeOf(absent).toMatchTypeOf<DocxOperationArguments<"paragraphs.set">>();
  expectTypeOf(extra).toMatchTypeOf<DocxOperationArguments<"model.text.run.Run.bold.get">>();
});

it("keeps direct table lengths aligned with the admitted unit schema", () => {
  // @ts-expect-error Direct row-height flags exclude twips; nested content accepts them.
  const rowHeight: DocxOperationArguments<"tables.add"> = { rows: 1, cols: 1, rowHeight: { value: 1, unit: "twip" } };
  // @ts-expect-error Direct cell-margin flags exclude twips; nested content accepts them.
  const cellMargin: DocxOperationArguments<"tables.add"> = { rows: 1, cols: 1, cellMargin: { value: 1, unit: "twip" } };
  expectTypeOf(rowHeight).toMatchTypeOf<DocxOperationArguments<"tables.add">>();
  expectTypeOf(cellMargin).toMatchTypeOf<DocxOperationArguments<"tables.add">>();
});
