import { expectTypeOf, it } from "vitest";
import type { DocxOperationArguments, DocxBatchItem } from "./index.js";
import type { DocxBatchArgumentMap } from "./operation-types.js";
it("keeps native layout SDK fields semantic, optional and axis-specific", () => {
  expectTypeOf<DocxOperationArguments<"images.set">["allowOverlap"]>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<DocxOperationArguments<"images.set">["verticalRelativeFrom"]>().toEqualTypeOf<"page" | "margin" | "paragraph" | "line" | "topMargin" | "bottomMargin" | "insideMargin" | "outsideMargin" | undefined>();
  type Invalid = "wrapPolygonJson" | "link" | "control" | "revision" | "shape" | "field" | "bookmark";
  expectTypeOf<Extract<keyof DocxOperationArguments<"images.set">, Invalid>>().toEqualTypeOf<never>();
  const direct: DocxOperationArguments<"images.set"> = { all: true, lockAspect: false, wrapPolygon: { start: { x: 0, y: 0 }, lineTo: [{ x: 0, y: 1 }, { x: 1, y: 1 }] } };
  expectTypeOf(direct).toMatchTypeOf<DocxOperationArguments<"images.set">>();
});
it("omits never-applicable selectors from direct and batch image replacement", () => {
  type Invalid = "all" | "link" | "control" | "revision" | "shape" | "field" | "bookmark";
  expectTypeOf<Extract<keyof DocxOperationArguments<"images.replace">, Invalid>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof DocxBatchArgumentMap["images.replace"], Invalid>>().toEqualTypeOf<never>();
});
it("keeps image factory typed transports byte-only and capability-context-only", () => {
  // @ts-expect-error Blob factories cannot acquire VFS paths.
  const directBlob: DocxOperationArguments<"model.image.image.Image.from_blob.call"> = { blob: { kind: "vfs", path: "/Map.PNG", capability: "command" } };
  // @ts-expect-error Batch blob factories cannot acquire VFS paths.
  const batchBlob: DocxBatchArgumentMap["model.image.image.Image.from_blob.call"] = { blob: { kind: "vfs", path: "/Map.PNG", capability: "command" } };
  // @ts-expect-error Factory contexts have no document author authority.
  const directFile: DocxOperationArguments<"model.image.image.Image.from_file.call"> = { imageDescriptor: new Uint8Array(), context: { author: "Harbor" } };
  // @ts-expect-error Batch contexts have no template acquisition authority.
  const batchFile: DocxBatchArgumentMap["model.image.image.Image.from_file.call"] = { imageDescriptor: new Uint8Array(), context: { template: { kind: "bytes", base64: "AA==" } } };
  expectTypeOf(directBlob).toMatchTypeOf<DocxOperationArguments<"model.image.image.Image.from_blob.call">>();
  expectTypeOf(batchBlob).toMatchTypeOf<DocxBatchArgumentMap["model.image.image.Image.from_blob.call"]>();
  expectTypeOf(directFile).toMatchTypeOf<DocxOperationArguments<"model.image.image.Image.from_file.call">>();
  expectTypeOf(batchFile).toMatchTypeOf<DocxBatchArgumentMap["model.image.image.Image.from_file.call"]>();
});

it("keeps image decorative intent optional and removes all from direct and batch insertion", () => {
  expectTypeOf<DocxOperationArguments<"images.add">["decorative"]>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<DocxBatchArgumentMap["images.add"]["decorative"]>().toEqualTypeOf<boolean | undefined>();
  // @ts-expect-error Image insertion has one explicit owner and no all flag.
  const direct: DocxOperationArguments<"images.add"> = { file: { kind: "bytes", base64: "AA==" }, all: true };
  // @ts-expect-error Batch insertion has the same single-owner intent.
  const batch: DocxBatchArgumentMap["images.add"] = { file: { kind: "bytes", base64: "AA==" }, all: true };
  expectTypeOf(direct).toMatchTypeOf<DocxOperationArguments<"images.add">>();
  expectTypeOf(batch).toMatchTypeOf<DocxBatchArgumentMap["images.add"]>();
});
it("removes never-applicable image insertion selectors from both typed transports", () => {
  type Invalid = "run" | "image" | "link" | "control" | "revision" | "shape" | "field" | "bookmark";
  expectTypeOf<Extract<keyof DocxOperationArguments<"images.add">, Invalid>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof DocxBatchArgumentMap["images.add"], Invalid>>().toEqualTypeOf<never>();
});

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
