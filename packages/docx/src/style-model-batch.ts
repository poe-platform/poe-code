import { isLength, plainLength } from "./formatting-values.js";
import { Image, type ImageModelContext } from "./image-model.js";
import { imageBatchActions } from "./image-batch-operations.js";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxBatch } from "./command.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { BaseStyle, CharacterStyle, ParagraphStyle, TableStyle, Styles, LatentStyles, LatentStyle, openDocumentStyleModel, StylePartView } from "./styles-model.js";
import { Font, ParagraphFormat, TabStops, TabStop, ColorFormat, RGBColor } from "./formatting-model.js";
import { styleModelBatchOperations, styleModelBatchActions, styleModelBatchBootstrap } from "./style-model-batch-operations.js";
export { styleModelBatchOperations } from "./style-model-batch-operations.js";

/** Executes the admitted style subgraph with document-owned handles and no host authority. */
export async function applyStyleModelBatch(input: Uint8Array, operations: unknown, context: ArchiveContext & ImageModelContext) {
  const settings = archiveSettings(context);
  const batch = validateDocxBatch(operations, settings.budget);
  for (const item of batch.operations) if (!styleModelBatchOperations.includes(item.operation)) throw new UnsupportedProfileError("This model operation is not implemented by the style batch executor.");
  const model = await openDocumentStyleModel(input, settings);
  const named = new Map<string, unknown>();
  const objectIds = new Map<object, string>();
  const results: { operation: string; value: unknown }[] = [];
  let affected = 0;
  const xmlHandles = new WeakSet<object>();
  const isModel = (value: unknown): value is object => value instanceof Styles || value instanceof BaseStyle || value instanceof LatentStyles || value instanceof LatentStyle || value instanceof Font || value instanceof ParagraphFormat || value instanceof TabStops || value instanceof TabStop || value instanceof ColorFormat || value instanceof RGBColor || value instanceof StylePartView || typeof value === "object" && value !== null && xmlHandles.has(value);
  const type = (value: object): string => xmlHandles.has(value) ? "XmlElementView" : value instanceof StylePartView ? "XmlPartView" : value instanceof TableStyle ? "_TableStyle" : value instanceof ParagraphStyle ? "ParagraphStyle" : value instanceof CharacterStyle ? "CharacterStyle" : value instanceof BaseStyle ? "BaseStyle" : value instanceof LatentStyle ? "_LatentStyle" : value.constructor.name;
  function encode(value: unknown): unknown {
    if (isLength(value)) return plainLength(value);
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
    return value === undefined ? null : structuredClone(value);
  }
  function resolve(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "resultHandle")) {
      if (typeof record.resultHandle !== "string" || !named.has(record.resultHandle)) throw new DocxUsageError("Unknown model result handle.");
      let found = named.get(record.resultHandle);
      if (record.index !== undefined) {
        if (!Array.isArray(found) || !Number.isSafeInteger(record.index) || Number(record.index) < 0 || Number(record.index) >= found.length) throw new DocxUsageError("Result handle index is out of bounds.");
        found = found[Number(record.index)];
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
    return value;
  }
  for (const item of batch.operations) {
    await settings.budget.checkpoint();
    let value: unknown;
    if (item.operation === styleModelBatchBootstrap) {
      const receiver = item.receiver;
      if (!(receiver?.resultHandle === "document" && Object.keys(receiver).length === 1) && (receiver?.id !== "document" || receiver.type !== "DocumentModel" || receiver.owner !== "document" || receiver.revision !== 0)) throw new DocxUsageError("The root receiver must be this document's initial handle.");
      value = model.styles;
    } else {
      const args = Object.fromEntries(Object.entries(item.arguments).map(([key, value]) => [key, resolve(value)]));
      const imageAction = imageBatchActions.get(item.operation);
      value = await (imageAction ? imageAction(resolve(item.receiver), args, { ...context, ...settings }) : styleModelBatchActions.get(item.operation)!(resolve(item.receiver), args));
    }
    if (docxOperationSchemas[item.operation]!.valueType === "XmlElementView" && value && typeof value === "object") xmlHandles.add(value);
    if (item.resultHandle) named.set(item.resultHandle, value);
    results.push({ operation: item.operation, value: encode(value) });
    if (docxOperationSchemas[item.operation]!.mutates) affected++;
  }
  return { save: model.save, publish: model.publish, warnings: model.warnings, results: Object.freeze(results), affected };
}
