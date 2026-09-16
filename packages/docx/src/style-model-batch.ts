import { PackageView, PartView, XmlPartView, Relationships, RelationshipView, CoreProperties, CorePropertiesPartView, ImageParts, ImagePartView } from "./package-view.js";
import { packageViewBatchActions } from "./package-view-batch-operations.js";
import { XmlElementView } from "./xml-element-view.js";
import { PackURI } from "./pack-uri.js";
import { isLength, plainLength, Length, Inches, Cm, Mm, Pt, Twips } from "./formatting-values.js";
import { Image, type ImageModelContext } from "./image-model.js";
import { imageBatchActions } from "./image-batch-operations.js";
import { Document, DocumentView } from "./document-model.js";
import { Paragraph, Run } from "./block-model.js";
import { Table, _Cell, _Row, _Column, _Rows, _Columns } from "./table-model.js";
import { Section, Sections, _Header, _Footer } from "./section-model.js";
import { Comments, Comment, Hyperlink, RenderedPageBreak } from "./review-model.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { modelContext } from "./model-context.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxBatch } from "./command.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { BaseStyle, CharacterStyle, ParagraphStyle, TableStyle, Styles, LatentStyles, LatentStyle, openDocumentStyleModel, StylePartView, styleModelMutations } from "./styles-model.js";
import { Font, ParagraphFormat, TabStops, TabStop, ColorFormat, RGBColor } from "./formatting-model.js";
import { styleModelBatchOperations, styleModelBatchActions, styleModelBatchBootstrap } from "./style-model-batch-operations.js";
export { styleModelBatchOperations } from "./style-model-batch-operations.js";

/** Executes the admitted style subgraph with document-owned handles and no host authority. */
export async function applyStyleModelBatch(input: Uint8Array, operations: unknown, context: ImageModelContext = {}) {
  const settings = modelContext(context);
  const batch = validateDocxBatch(operations, settings.budget);
  for (const item of batch.operations) if (!styleModelBatchOperations.includes(item.operation) && !structureModelBatchActions.has(item.operation)) throw new UnsupportedProfileError("This model operation is not implemented by the style batch executor.");
  const document = batch.operations.some(item => structureModelBatchActions.has(item.operation) && item.operation !== styleModelBatchBootstrap) ? await Document(input, settings) : null;
  const model = document ? { get styles() { return document.styles; }, package: document.store.package, warnings: [] as readonly { readonly code: string }[], save: (sink: import("./archive-write.js").ArchiveSink) => document.save(sink), publish: (options: import("./publication.js").PublicationOptions, context: import("./publication.js").PublicationContext) => document.store.publish(options, context) } : await openDocumentStyleModel(input, settings);
  const named = new Map<string, unknown>();
  const objectIds = new Map<object, string>();
  const results: { operation: string; value: unknown }[] = [];
  let affected = 0;
  const currentRevision = () => document ? document.store.revision + model.package.revision : styleModelMutations.get(model.styles)!.revision + model.package.revision;
  let revision = currentRevision();
  let pendingStylesCreation = revision !== 0;

  const isModel = (value: unknown): value is object => value instanceof DocumentView || value instanceof Paragraph || value instanceof Run || value instanceof Table || value instanceof _Cell || value instanceof _Row || value instanceof _Column || value instanceof _Rows || value instanceof _Columns || value instanceof Section || value instanceof Sections || value instanceof _Header || value instanceof _Footer || value instanceof Comments || value instanceof Comment || value instanceof Hyperlink || value instanceof RenderedPageBreak || value instanceof Styles || value instanceof BaseStyle || value instanceof LatentStyles || value instanceof LatentStyle || value instanceof Font || value instanceof ParagraphFormat || value instanceof TabStops || value instanceof TabStop || value instanceof ColorFormat || value instanceof RGBColor || value instanceof PartView || value instanceof PackageView || value instanceof Relationships || value instanceof RelationshipView || value instanceof XmlElementView || value instanceof CoreProperties || value instanceof ImageParts;
  const type = (value: object): string => value instanceof DocumentView ? "DocumentModel" : value instanceof _Header ? "_Header" : value instanceof _Footer ? "_Footer" : value instanceof XmlElementView ? "XmlElementView" : value instanceof ImagePartView ? "ImagePart" : value instanceof CorePropertiesPartView ? "CorePropertiesPart" : value instanceof XmlPartView ? value instanceof StylePartView ? "StylesPart" : "XmlPartView" : value instanceof PartView ? "PartView" : value instanceof PackageView ? "PackageView" : value instanceof RelationshipView ? "RelationshipView" : value instanceof TableStyle ? "_TableStyle" : value instanceof ParagraphStyle ? "ParagraphStyle" : value instanceof CharacterStyle ? "CharacterStyle" : value instanceof BaseStyle ? "BaseStyle" : value instanceof LatentStyle ? "_LatentStyle" : value.constructor.name;
  function encode(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (isLength(value)) return plainLength(value);
    if (value instanceof PackURI) return value.toString();
    if (value instanceof Uint8Array) {
      const encodedLength = Math.ceil(value.length / 3) * 4;
      settings.budget.charge("retainedBytes", value.length + encodedLength * 2);
      settings.budget.charge("work", value.length + encodedLength);
      settings.budget.check("serializedOutput", encodedLength + 40);
      let binary = "";
      for (let offset = 0; offset < value.length; offset += 4096) binary += String.fromCharCode(...value.subarray(offset, offset + 4096));
      return { kind: "bytes", base64: btoa(binary) };
    }
    if (value instanceof Image) {
      let id = objectIds.get(value);
      if (!id) { id = `handle${objectIds.size + 1}`; objectIds.set(value, id); }
      return { id, type: "Image", owner: "batch", revision: 0 };
    }
    if (value instanceof Map) return [...value].map(([key, value]) => ({ key, value: encode(value) }));
    if (isModel(value)) {
      let id = objectIds.get(value);
      if (!id) { id = `handle${objectIds.size + 1}`; objectIds.set(value, id); }
      return { id, type: type(value), owner: "document", revision: 0 };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object" && Symbol.iterator in value) return [...value as Iterable<unknown>].map(encode);
    return value === undefined ? null : structuredClone(value);
  }
  function resolve(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (value instanceof Uint8Array || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(resolve);
    const record = value as Record<string, unknown>;
    if (document && (record.resultHandle === "document" && Object.keys(record).length === 1 || record.id === "document" && record.type === "DocumentModel" && record.owner === "document" && record.revision === 0)) return document;
    if (document && Object.keys(record).length === 2 && typeof record.value === "number" && typeof record.unit === "string") {
      const constructors = { emu: Length, in: Inches, cm: Cm, mm: Mm, pt: Pt, twip: Twips };
      const constructor = constructors[record.unit as keyof typeof constructors];
      if (constructor) return constructor(record.value);
    }
    if (Object.hasOwn(record, "resultHandle")) {
      if (typeof record.resultHandle !== "string" || !named.has(record.resultHandle)) throw new DocxUsageError("Unknown model result handle.");
      let found = named.get(record.resultHandle);
      if (record.index !== undefined) {
        const sequence = Array.isArray(found) || found instanceof Sections || found instanceof _Rows || found instanceof _Columns;
        if (!sequence || !Number.isSafeInteger(record.index) || Number(record.index) < 0 || Number(record.index) >= (found as { length: number }).length) throw new DocxUsageError("Result handle index is out of bounds.");
        found = Array.isArray(found) ? found[Number(record.index)] : (found as Sections | _Rows | _Columns).at(Number(record.index));
      }
      if (record.key !== undefined) {
        if (typeof record.key === "string" && found instanceof Map) {
          if (!found.has(record.key)) throw new DocxUsageError("Unknown map key.");
          return found.get(record.key);
        }
        if (typeof record.key !== "string" || !(found instanceof Styles || found instanceof LatentStyles)) throw new DocxUsageError("The result handle does not support keyed selection.");
        found = found.at(record.key);
      }
      return found;
    }
    if (Object.hasOwn(record, "id") && Object.hasOwn(record, "owner")) {
      throw new DocxUsageError("Use a named result handle from this batch for nonroot receivers.");
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolve(item)]));
  }
  for (const item of batch.operations) {
    await settings.budget.checkpoint();
    let value: unknown;
    let createdStylesPart = false;
    if (item.operation === styleModelBatchBootstrap) {
      const receiver = item.receiver;
      if (!(receiver?.resultHandle === "document" && Object.keys(receiver).length === 1) && (receiver?.id !== "document" || receiver.type !== "DocumentModel" || receiver.owner !== "document" || receiver.revision !== 0)) throw new DocxUsageError("The root receiver must be this document's initial handle.");
      value = model.styles;
      createdStylesPart = pendingStylesCreation;
      pendingStylesCreation = false;
    } else {
      const args = Object.fromEntries(Object.entries(item.arguments).map(([key, value]) => [key, resolve(value)]));
      const imageAction = imageBatchActions.get(item.operation), packageAction = packageViewBatchActions.get(item.operation);
      value = await (imageAction ? imageAction(resolve(item.receiver), args, { ...context, ...settings }) : packageAction ? packageAction(resolve(item.receiver), args, { ...context, ...settings }) : (structureModelBatchActions.get(item.operation) ?? styleModelBatchActions.get(item.operation))!(resolve(item.receiver), args));
    }
    if (item.resultHandle) named.set(item.resultHandle, value);
    results.push({ operation: item.operation, value: encode(value) });
    const nextRevision = currentRevision();
    if (docxOperationSchemas[item.operation]!.mutates && (document ? nextRevision !== revision : packageViewBatchActions.has(item.operation) ? nextRevision !== revision : !item.operation.endsWith(".get") || createdStylesPart || nextRevision !== revision)) affected++;
    revision = nextRevision;
  }
  return { save: model.save, publish: model.publish, warnings: model.warnings, results: Object.freeze(results), affected };
}
