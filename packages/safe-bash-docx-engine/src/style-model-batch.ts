import { ModelSaveStage, modelSaveOperations } from "./model-save-stage.js";
import { PackageView, PartView, XmlPartView, StoryPart, HeaderPart, FooterPart, CommentsPart, SettingsPart, StylesPart, DocumentPartView, NumberingPart, _NumberingDefinitions, Relationships, RelationshipView, CoreProperties, CorePropertiesPartView, ImageParts, ImagePartView } from "./package-view.js";
import { packageViewBatchActions } from "./package-view-batch-operations.js";
import { XmlElementView } from "./xml-element-view.js";
import { PackURI } from "./pack-uri.js";
import { isLength, plainLength, Length, Inches, Cm, Mm, Pt, Twips } from "./formatting-values.js";
import { Image, type ImageModelContext } from "./image-model.js";
import { imageBatchActions } from "./image-batch-operations.js";
import { Document, DocumentView } from "./document-model.js";
import { DocumentSession } from "./document-session.js";
import { inspectDocumentParagraph, inspectDocumentRun } from "./text-resource-read.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { Drawing, InlineShape, InlineShapes } from "./inline-shape-model.js";
import { Settings } from "./settings-model.js";
import { Paragraph, Run } from "./block-model.js";
import { Table, _Cell, _Row, _Column, _Rows, _Columns } from "./table-model.js";
import { Section, Sections, _Header, _Footer } from "./section-model.js";
import { Comments, Comment, Hyperlink, RenderedPageBreak } from "./review-model.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { modelContext } from "./model-context.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { DocxUsageError } from "./argument-json.js";
import { BoundsError } from "./model-errors.js";
import { validateDocxBatch } from "./command.js";
import { ModelBatchEffects, type ModelBatchItemResult } from "./model-batch-effects.js";
import type { DocumentBatchItemResult } from "./batch.js";
import { documentByteView } from "./byte-input.js";
import { BaseStyle, CharacterStyle, ParagraphStyle, TableStyle, Styles, LatentStyles, LatentStyle } from "./styles-model.js";
import { Font, ParagraphFormat, TabStops, TabStop, ColorFormat, RGBColor } from "./formatting-model.js";
import { styleModelBatchOperations, styleModelBatchActions, styleModelBatchBootstrap } from "./style-model-batch-operations.js";
export { styleModelBatchOperations } from "./style-model-batch-operations.js";

// These are public descriptor names, independent of emitted constructor names.
const modelTypes = [
  [DocumentView, "DocumentModel"], [_NumberingDefinitions, "NumberingDefinitionsView"],
  [_Header, "_Header"], [_Footer, "_Footer"], [XmlElementView, "XmlElementView"],
  [ImagePartView, "ImagePart"], [CorePropertiesPartView, "CorePropertiesPart"],
  [DocumentPartView, "DocumentPart"], [NumberingPart, "NumberingPart"],
  [HeaderPart, "HeaderPart"], [FooterPart, "FooterPart"], [CommentsPart, "CommentsPart"],
  [StoryPart, "StoryPart"], [SettingsPart, "SettingsPart"], [StylesPart, "StylesPart"],
  [XmlPartView, "XmlPartView"], [PartView, "PartView"], [PackageView, "PackageView"],
  [RelationshipView, "RelationshipView"], [TableStyle, "_TableStyle"],
  [ParagraphStyle, "ParagraphStyle"], [CharacterStyle, "CharacterStyle"], [BaseStyle, "BaseStyle"],
  [LatentStyle, "_LatentStyle"], [Drawing, "Drawing"], [InlineShape, "InlineShape"],
  [InlineShapes, "InlineShapes"], [Settings, "Settings"], [Paragraph, "Paragraph"], [Run, "Run"],
  [Table, "Table"], [_Cell, "_Cell"], [_Row, "_Row"], [_Column, "_Column"],
  [_Rows, "_Rows"], [_Columns, "_Columns"], [Section, "Section"], [Sections, "Sections"],
  [Comments, "Comments"], [Comment, "Comment"], [Hyperlink, "Hyperlink"],
  [RenderedPageBreak, "RenderedPageBreak"], [Styles, "Styles"], [LatentStyles, "LatentStyles"],
  [Font, "Font"], [ParagraphFormat, "ParagraphFormat"], [TabStops, "TabStops"],
  [TabStop, "TabStop"], [ColorFormat, "ColorFormat"], [RGBColor, "RGBColor"],
  [Relationships, "Relationships"], [CoreProperties, "CoreProperties"], [ImageParts, "ImageParts"]
] as const;

/** Executes the admitted style subgraph with document-owned handles and no host authority. */
export async function applyStyleModelBatch(input: Uint8Array, operations: unknown, context: ImageModelContext = {}) {
  const settings = modelContext(context);
  const batch = validateDocxBatch(operations, settings.budget);
  for (const item of batch.operations) if (!styleModelBatchOperations.includes(item.operation) && !structureModelBatchActions.has(item.operation) && !["paragraphs.get", "runs.get"].includes(item.operation)) throw new UnsupportedProfileError("This model operation is not implemented by the style batch executor.");
  const borrowed = documentByteView(input);
  settings.budget.check("compressedInput", borrowed.length);
  settings.budget.charge("retainedBytes", borrowed.length);
  const source = new Uint8Array(borrowed);
  const document = await Document(source, settings);
  const readSession = batch.operations.some(item => ["paragraphs.get", "runs.get"].includes(item.operation)) ? await DocumentSession.open(source, { ...settings, encoding: { order: "input", compression: "store" } }) : undefined;
  const model = { package: document.store.package, warnings: [] as readonly { readonly code: string }[], save: (output: import("./model-output.js").DocumentOutput, options?: import("./model-output.js").DocumentSaveOptions) => document.save(output, options), publish: (options: import("./publication.js").PublicationOptions, context: import("./publication.js").PublicationContext) => document.store.publish(options, context) };
  const saved = new ModelSaveStage(settings);
  const named = new Map<string, unknown>();
  const objectIds = new Map<object, string>();
  const results: { operation: string; value: unknown }[] = [];
  const operationResults: (ModelBatchItemResult | DocumentBatchItemResult)[] = [];
  settings.budget.charge("work", source.length);
  const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", source))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const effects = new ModelBatchEffects(document.store.snapshot(), sourceSha256, settings.budget);
  let affected = 0;
  const currentRevision = () => document.store.revision + model.package.revision;
  let revision = currentRevision();

  const isModel = (value: unknown): value is object => modelTypes.some(([constructor]) => value instanceof constructor);
  const type = (value: object): string => modelTypes.find(([constructor]) => value instanceof constructor)![1];
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
    if (record.resultHandle === "document" && Object.keys(record).length === 1 || record.id === "document" && record.type === "DocumentModel" && record.owner === "document" && record.revision === 0) return document;
    if (Object.keys(record).length === 2 && typeof record.value === "number" && typeof record.unit === "string") {
      const constructors = { emu: Length, in: Inches, cm: Cm, mm: Mm, pt: Pt, twip: Twips };
      const constructor = constructors[record.unit as keyof typeof constructors];
      if (constructor) return constructor(record.value);
    }
    if (Object.hasOwn(record, "resultHandle")) {
      if (typeof record.resultHandle !== "string" || !named.has(record.resultHandle)) throw new DocxUsageError("Unknown model result handle.");
      let found = named.get(record.resultHandle);
      if (record.index !== undefined) {
        const sequence = Array.isArray(found) || found instanceof InlineShapes || found instanceof Sections || found instanceof _Rows || found instanceof _Columns;
        if (!sequence) throw new DocxUsageError("The result handle does not support indexed selection.");
        if (!Number.isSafeInteger(record.index) || Number(record.index) < 0 || Number(record.index) >= (found as { length: number }).length) throw new BoundsError("Result handle index is out of bounds.");
        found = Array.isArray(found) ? found[Number(record.index)] : (found as InlineShapes | Sections | _Rows | _Columns).at(Number(record.index));
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
  for (const [index, item] of batch.operations.entries()) {
    const utilityId = item.operation === "paragraphs.get" || item.operation === "runs.get" ? item.id ?? `step${index + 1}` : undefined;
    try {
      await settings.budget.checkpoint();
      let value: unknown;
      let resultValue: unknown;
      let readLocations: import("./location-token.js").Location[] | undefined;
      if (item.operation === "paragraphs.get" || item.operation === "runs.get") {
        const read = item.operation === "paragraphs.get" ? inspectDocumentParagraph : inspectDocumentRun;
        const data = await read(source, item.arguments as DocxOperationArguments<"paragraphs.get">, readSession!.context);
        const location = data.item.location;
        let node = document.store.xml(location.value.part).root;
        for (const position of location.value.path) node = node.children[position]!;
        const ref = document.store.ref(location.value.part, node);
        value = item.operation === "paragraphs.get" ? document.store.paragraph(ref) : document.store.run(ref);
        resultValue = data;
        readLocations = [location];
      } else if (item.operation === styleModelBatchBootstrap) {
        const receiver = resolve(item.receiver);
        if (!(receiver instanceof DocumentView)) throw new DocxUsageError("Expected an admitted document owner.");
        value = receiver.styles;
      } else if ((modelSaveOperations as readonly string[]).includes(item.operation)) {
        const receiver = resolve(item.receiver);
        const valid = item.operation === "model.document.Document.save.call" ? receiver instanceof DocumentView
          : item.operation === "model.parts.document.DocumentPart.save.call" ? receiver instanceof DocumentPartView : receiver instanceof PackageView;
        if (!valid || !(receiver instanceof DocumentView || receiver instanceof DocumentPartView || receiver instanceof PackageView))
          throw new DocxUsageError("Expected an admitted save owner.");
        await saved.capture(item.arguments.output as { path?: string; capability: string }, sink => receiver.save(sink));
        value = undefined;
      } else if (item.operation === "model.types.ProvidesStoryPart.part.get" || item.operation === "model.types.ProvidesXmlPart.part.get") {
        const receiver = resolve(item.receiver);
        if (!isModel(receiver) || !("part" in receiver)) throw new DocxUsageError("Expected an admitted part provider.");
        const part = receiver.part;
        if (!(part instanceof XmlPartView) || item.operation === "model.types.ProvidesStoryPart.part.get" && !(part instanceof StoryPart))
          throw new DocxUsageError("The provider does not own the required native part role.");
        value = part;
      } else {
        const receiver = resolve(item.receiver);
        const args = Object.fromEntries(Object.entries(item.arguments).map(([key, value]) => [key, resolve(value)]));
        // Paragraph setters validate the supplied sign before length rounding.
        // Other native receivers may require constructed Length instances.
        const supplied = item.arguments.value;
        if (receiver instanceof ParagraphFormat && item.operation.endsWith(".set") && supplied !== null && typeof supplied === "object" && "value" in supplied && "unit" in supplied) args.value = supplied;
        const imageAction = imageBatchActions.get(item.operation), packageAction = packageViewBatchActions.get(item.operation);
        value = await (imageAction ? imageAction(receiver, args, settings) : packageAction ? packageAction(receiver, args, settings) : (structureModelBatchActions.get(item.operation) ?? styleModelBatchActions.get(item.operation))!(receiver, args));
      }
      if (item.resultHandle) {
        if (value && typeof value === "object" && Symbol.iterator in value && "next" in value) {
          const members: unknown[] = [];
          for (const member of value as Iterable<unknown>) {
            settings.budget.charge("work", 1);
            settings.budget.charge("retainedBytes", 8);
            members.push(member);
          }
          value = Object.freeze(members);
        }
        named.set(item.resultHandle, value);
      }
      const encoded = resultValue ?? encode(value);
      results.push({ operation: item.operation, value: encoded });
      const nextRevision = currentRevision();
      const changes = nextRevision !== revision ? effects.record(document.store.snapshot()) : [];
      if (readSession && changes.length) await readSession.stage(document.store.snapshot());
      const count = changes.length ? 1 : 0;
      affected += count;
      const result: ModelBatchItemResult = {version: 1, operation: item.operation, ok: true, data: encoded, affected: count,
        warnings: [], errors: [], locations: readLocations ?? changes.flatMap(change => change.after ? [change.after] : [])};
      operationResults.push(utilityId === undefined ? result : { ...result, id: utilityId });
      revision = nextRevision;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Document model batch operation failed.", {cause});
      Object.assign(error, {operationIndex: index, ...(utilityId === undefined ? {} : {operationId: utilityId})});
      throw error;
    }
  }
  return { save: saved.staged ? saved.save.bind(saved) : model.save, publish: saved.staged ? saved.publish.bind(saved) : model.publish, warnings: model.warnings, results: Object.freeze(results),
    operationResults: Object.freeze(operationResults), changes: Object.freeze(effects.changes), affected };
}
