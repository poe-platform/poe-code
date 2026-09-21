import { editDocumentStyles, inspectDocumentStyles, type StyleEditOptions, type StyleInspectionOptions } from "./styles.js";
import { editDocumentBookmarks, type BookmarkEditRequest } from "./bookmarks.js";
import type { PublicationContext } from "./publication.js";
import type { DocxBatchOperation } from "./command.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { editDocumentFields, inspectDocumentFields, type FieldEditRequest } from "./fields.js";
import { replaceDocumentText, setDocumentDummyText, type TextReplaceOptions, type DummyTextOptions } from "./text-replace.js";
import { editDocumentParagraphs, type ParagraphEditRequest } from "./paragraph-edit.js";
import { editDocumentTables, type TableEditRequest } from "./table-edit.js";
import { inspectDocumentTable, inspectDocumentTables } from "./table-read.js";
import { inspectDocumentParagraph, inspectDocumentRun, inspectDocumentParagraphs, inspectDocumentRuns } from "./text-resource-read.js";
import { formatDocumentRuns, type RunFormatOptions } from "./run-format.js";
import { insertDocumentImage, type ImageInsertionContext, type ImageInsertionRequest } from "./image-insertion.js";
import { replaceDocumentImage, type ImageReplacementRequest } from "./image-replacement.js";
import { setDocumentImageLayout, type ImageLayoutRequest } from "./image-layout.js";
import { inspectDocumentImages, type ImageInspectionOptions } from "./images.js";
import { editDocumentProperties, inspectDocumentProperties, type PropertyEditOptions, type PropertyInspectionOptions } from "./document-properties.js";
import { extractDocumentText, type TextOptions } from "./text.js";
import { editDocumentLists, type ListEditRequest } from "./lists.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { editDocumentComments, inspectDocumentComments, type CommentEditRequest, type CommentReadRequest } from "./comments.js";
import { editDocumentRevisions, type RevisionEditOptions } from "./revision-edit.js";
import { editDocumentRevisionDecisions, type RevisionDecisionRequest } from "./revision-decisions.js";
import { inspectDocumentRevisions } from "./revisions.js";
import { editDocumentControls, inspectDocumentControls } from "./controls.js";
import { editDocumentControlRepeats } from "./control-repeat.js";
import { applyDocumentTemplate } from "./template.js";
import { inspectDocumentSettings } from "./settings.js";
import { editDocumentControlBindings } from "./control-bindings.js";
import { inspectDocumentPackageResources, packageResourceWarnings } from "./ancillary-resources.js";
import { inspectDocumentSignatures, stripDocumentSignatures } from "./signatures.js";

type Action = (input: Uint8Array, item: DocxBatchOperation, context: PublicationContext & Pick<ImageInsertionContext, "binaryResolver">) => Promise<unknown>;
export const documentBatchActions = new Map<string, Action>();
for (const operation of ["comments.list", "comments.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentComments(input, { operation: item.operation, options: item.arguments } as CommentReadRequest, context));
for (const operation of ["comments.add", "comments.set", "comments.remove"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentComments(input, { operation: item.operation, options: item.arguments } as CommentEditRequest, context));
documentBatchActions.set("revisions.list", (input, item, context) => inspectDocumentRevisions(input, item.arguments as DocxOperationArguments<"revisions.list">, context));
documentBatchActions.set("revisions.add", (input, item, context) => editDocumentRevisions(input, item.arguments as RevisionEditOptions, context));
for (const operation of ["revisions.accept", "revisions.reject"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentRevisionDecisions(input, { operation: item.operation, options: item.arguments } as RevisionDecisionRequest, context));
documentBatchActions.set("controls.list", (input, item, context) => inspectDocumentControls(input, item.arguments as DocxOperationArguments<"controls.list">, context));
documentBatchActions.set("controls.set", (input, item, context) => editDocumentControls(input, item.arguments as DocxOperationArguments<"controls.set">, context));
documentBatchActions.set("controls.repeat", (input, item, context) => editDocumentControlRepeats(input, item.arguments as DocxOperationArguments<"controls.repeat">, context));
documentBatchActions.set("template.apply", (input, item, context) => applyDocumentTemplate(input, item.arguments as DocxOperationArguments<"template.apply">, context));
documentBatchActions.set("settings.list", (input, item, context) => inspectDocumentSettings(input, item.arguments as DocxOperationArguments<"settings.list">, context));
documentBatchActions.set("controls.bind", (input, item, context) => editDocumentControlBindings(input, item.arguments as DocxOperationArguments<"controls.bind">, context));
for (const operation of ["custom-xml.list", "glossary.list"] as const)
  documentBatchActions.set(operation, async (input, item, context) => {
    const data = await inspectDocumentPackageResources(input, operation, item.arguments as DocxOperationArguments<typeof operation>, context);
    return { ...data, warnings: packageResourceWarnings(data) };
  });
documentBatchActions.set("signatures.list", (input, item, context) => inspectDocumentSignatures(input, item.arguments as DocxOperationArguments<"signatures.list">, context));
documentBatchActions.set("signatures.remove", (input, item, context) => stripDocumentSignatures(input, item.arguments as DocxOperationArguments<"signatures.remove">, context));
for (const operation of ["lists.add", "lists.set"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentLists(input, { operation: item.operation, options: item.arguments } as ListEditRequest, context));
documentBatchActions.set("bookmarks.add", (input, item, context) => editDocumentBookmarks(input, { operation: item.operation, options: item.arguments } as BookmarkEditRequest, context));
for (const operation of ["fields.add", "fields.set", "toc.add", "toc.set", "captions.add", "captions.set"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentFields(input, { operation: item.operation, options: item.arguments } as FieldEditRequest, context));
for (const operation of ["paragraphs.add", "paragraphs.set", "runs.add", "tables.add"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentParagraphs(input, { operation: item.operation, options: item.arguments } as ParagraphEditRequest, context));
for (const operation of ["tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.merge", "tables.split"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentTables(input, { operation: item.operation, options: item.arguments } as TableEditRequest, context));
for (const operation of ["styles.add", "styles.set", "styles.remove", "styles.defaults.set", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.set"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentStyles(input, { ...item.arguments, operation: item.operation } as StyleEditOptions, context));
for (const operation of ["styles.list", "styles.get", "styles.defaults.get", "styles.latent.list", "styles.latent.get", "styles.latent.defaults.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentStyles(input, { ...item.arguments, ...(operation.includes(".latent.") ? { latent: true } : {}) } as StyleInspectionOptions, context));
documentBatchActions.set("text.replace", (input, item, context) => replaceDocumentText(input, item.arguments as TextReplaceOptions, context));
documentBatchActions.set("lorem.set", (input, item, context) => setDocumentDummyText(input, item.arguments as DummyTextOptions, context));
documentBatchActions.set("runs.set", (input, item, context) => formatDocumentRuns(input, item.arguments as RunFormatOptions, context));
documentBatchActions.set("images.add", (input, item, context) => insertDocumentImage(input, { operation: "images.add", options: item.arguments } as unknown as ImageInsertionRequest, context));
documentBatchActions.set("images.replace", (input, item, context) => replaceDocumentImage(input, { operation: "images.replace", options: item.arguments } as unknown as ImageReplacementRequest, context));
documentBatchActions.set("images.set", (input, item, context) => setDocumentImageLayout(input, { operation: "images.set", options: item.arguments } as ImageLayoutRequest, context));
for (const operation of ["properties.set", "properties.remove"])
  documentBatchActions.set(operation, (input, item, context) => editDocumentProperties(input, { ...item.arguments, operation: item.operation } as PropertyEditOptions, context));
documentBatchActions.set("text.get", (input, item, context) => extractDocumentText(input, context, item.arguments as TextOptions));
documentBatchActions.set("paragraphs.get", (input, item, context) => inspectDocumentParagraph(input, item.arguments as DocxOperationArguments<"paragraphs.get">, context));
documentBatchActions.set("runs.get", (input, item, context) => inspectDocumentRun(input, item.arguments as DocxOperationArguments<"runs.get">, context));
documentBatchActions.set("paragraphs.list", (input, item, context) => inspectDocumentParagraphs(input, item.arguments as DocxOperationArguments<"paragraphs.list">, context));
documentBatchActions.set("runs.list", (input, item, context) => inspectDocumentRuns(input, item.arguments as DocxOperationArguments<"runs.list">, context));
documentBatchActions.set("fields.list", (input, item, context) => inspectDocumentFields(input, item.arguments as DocxOperationArguments<"fields.list">, context));
documentBatchActions.set("tables.get", (input, item, context) => inspectDocumentTable(input, item.arguments as DocxOperationArguments<"tables.get">, context));
documentBatchActions.set("tables.list", (input, item, context) => inspectDocumentTables(input, item.arguments as DocxOperationArguments<"tables.list">, context));
for (const operation of ["images.list", "images.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentImages(input, { ...item.arguments, operation: item.operation } as ImageInspectionOptions, context));
for (const operation of ["properties.list", "properties.get"])
  documentBatchActions.set(operation, (input, item, context) => inspectDocumentProperties(input, item.arguments as PropertyInspectionOptions, context));
export const documentBatchOperations: readonly string[] = Object.freeze([...documentBatchActions.keys()].filter(id => docxOperationSchemas[id]?.batchFields !== undefined));
