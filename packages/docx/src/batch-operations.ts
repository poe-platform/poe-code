import type { PublicationContext } from "./publication.js";
import type { DocxBatchOperation } from "./command.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { editDocumentFields, inspectDocumentFields, type FieldEditRequest } from "./fields.js";
import { replaceDocumentText, setDocumentDummyText, type TextReplaceOptions, type DummyTextOptions } from "./text-replace.js";
import { editDocumentParagraphs, type ParagraphEditRequest } from "./paragraph-edit.js";
import { editDocumentTables, type TableEditRequest } from "./table-edit.js";
import { inspectDocumentTable } from "./table-read.js";
import { formatDocumentRuns, type RunFormatOptions } from "./run-format.js";
import { insertDocumentImage, type ImageInsertionContext, type ImageInsertionRequest } from "./image-insertion.js";
import { replaceDocumentImage, type ImageReplacementRequest } from "./image-replacement.js";
import { setDocumentImageLayout, type ImageLayoutRequest } from "./image-layout.js";
import { inspectDocumentImages, type ImageInspectionOptions } from "./images.js";
import { editDocumentProperties, inspectDocumentProperties, type PropertyEditOptions, type PropertyInspectionOptions } from "./document-properties.js";
import { extractDocumentText, type TextOptions } from "./text.js";
import type { DocxOperationArguments } from "./operation-types.js";

type Action = (input: Uint8Array, item: DocxBatchOperation, context: PublicationContext & Pick<ImageInsertionContext, "binaryResolver">) => Promise<unknown>;
export const documentBatchActions = new Map<string, Action>();
for (const operation of ["fields.add", "fields.set", "toc.add", "toc.set", "captions.add", "captions.set"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentFields(input, { operation: item.operation, options: item.arguments } as FieldEditRequest, context));
for (const operation of ["paragraphs.add", "paragraphs.set", "runs.add", "tables.add"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentParagraphs(input, { operation: item.operation, options: item.arguments } as ParagraphEditRequest, context));
for (const operation of ["tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.merge", "tables.split"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentTables(input, { operation: item.operation, options: item.arguments } as TableEditRequest, context));
documentBatchActions.set("text.replace", (input, item, context) => replaceDocumentText(input, item.arguments as TextReplaceOptions, context));
documentBatchActions.set("lorem.set", (input, item, context) => setDocumentDummyText(input, item.arguments as DummyTextOptions, context));
documentBatchActions.set("runs.set", (input, item, context) => formatDocumentRuns(input, item.arguments as RunFormatOptions, context));
documentBatchActions.set("images.add", (input, item, context) => insertDocumentImage(input, { operation: "images.add", options: item.arguments } as unknown as ImageInsertionRequest, context));
documentBatchActions.set("images.replace", (input, item, context) => replaceDocumentImage(input, { operation: "images.replace", options: item.arguments } as unknown as ImageReplacementRequest, context));
documentBatchActions.set("images.set", (input, item, context) => setDocumentImageLayout(input, { operation: "images.set", options: item.arguments } as ImageLayoutRequest, context));
for (const operation of ["properties.set", "properties.remove"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentProperties(input, { ...item.arguments, operation: item.operation } as PropertyEditOptions, context));
documentBatchActions.set("text.get", (input, item, context) => extractDocumentText(input, context, item.arguments as TextOptions));
documentBatchActions.set("fields.list", (input, item, context) => inspectDocumentFields(input, item.arguments as DocxOperationArguments<"fields.list">, context));
documentBatchActions.set("tables.get", (input, item, context) => inspectDocumentTable(input, item.arguments as DocxOperationArguments<"tables.get">, context));
for (const operation of ["images.list", "images.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentImages(input, { ...item.arguments, operation: item.operation } as ImageInspectionOptions, context));
for (const operation of ["properties.list", "properties.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentProperties(input, item.arguments as PropertyInspectionOptions, context));
export const documentBatchOperations: readonly string[] = Object.freeze([...documentBatchActions.keys()].filter(id => docxOperationSchemas[id]?.batchFields !== undefined));
