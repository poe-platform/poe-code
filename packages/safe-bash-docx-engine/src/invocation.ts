import { BoundsError } from "./model-errors.js";
import { partProviderReceivers } from "./part-provider.js";

import { DocumentBudget } from "./budget.js";

import { validateDocxSelection } from "./command-selection.js";
import { validateDocxOptionRules } from "./command-option-rules.js";
import { normalizeDocxPropertyOptions } from "./command-properties.js";
import { decodeLocation } from "./location-token.js";
import { DocxUsageError, docxByteLength, copyDocxBytes } from "./argument-json.js";
import { docxOperationSchemas, docxCommonOptions, docxEnumCanonicalNames, assertDocxFields, validateDocxValue, splitDocxType, type DocxOperationSchema } from "./operation-schema.js";

export interface DocxArgumentSource {
  readonly argument: string;
  readonly path: string;
  readonly format: "json" | "binary";
  readonly type: string;
}
export interface DocxInvocation {
  readonly operation: string;
  readonly inputs: readonly string[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly sources?: readonly DocxArgumentSource[];
}
export interface DocxBatchOperation {
  readonly id?: string;
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly receiver?: Readonly<Record<string, unknown>>;
  readonly resultHandle?: string;
}
export interface DocxBatch { readonly version: 1; readonly operations: readonly DocxBatchOperation[] }
export class SourceError extends Error {
  readonly code = "source-failure";
  constructor(cause?: unknown) { super("Unable to acquire the declared JSON source.", { cause }); }
}
export const selectors = ["section", "paragraph", "run", "table", "cell", "image", "comment", "note", "link", "control", "revision", "shape", "field", "bookmark"];
export const publication = ["output", "outputDir", "inPlace", "force", "dryRun", "json", "limit", "timestamp", "author"];
export const docxInvocationBudgets = new WeakMap<DocxInvocation, DocumentBudget>();
export function usage(message: string): never { throw new DocxUsageError(message); }
export function schemaFor(id: string): DocxOperationSchema {
  if (!Object.hasOwn(docxOperationSchemas, id)) usage("Unknown document operation.");
  return docxOperationSchemas[id]!;
}
export function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) usage("Expected a closed argument object.");
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value).sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)) {
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || (allowed && !allowed.includes(key))) usage("Unknown argument field.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) usage("Argument accessors are not permitted.");
    if (descriptor.value !== undefined) result[key] = descriptor.value;
  }
  return result;
}
export function path(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !validateDocxValue("string", value)) usage("Expected a nonempty Unicode path.");
}
export function owned(value: unknown, budget: DocumentBudget): unknown {
  if (typeof value === "string") budget.charge("retainedBytes", new TextEncoder().encode(value).length);
  if (value instanceof Uint8Array) { budget.charge("retainedBytes", docxByteLength(value)); return copyDocxBytes(value); }
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return Object.freeze(value.map(item => owned(item, budget)));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, owned(v, budget)])));
  return value;
}
export function structuredBudget(value: unknown, budget: DocumentBudget): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    budget.check("xmlNodes", ++nodes);
    budget.check("xmlDepth", depth);
    if (!item || typeof item !== "object" || item instanceof Date || item instanceof Uint8Array) return;
    if (!Array.isArray(item) && (item as Record<string, unknown>).kind === "table") {
      const rows = (item as { rows: unknown[][] }).rows;
      if (Array.isArray(rows) && Array.isArray(rows[0])) budget.table(rows.length, rows[0].length);
    }
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 1);
}
export function lowerLimits(value: unknown, budget: DocumentBudget): DocumentBudget {
  if (value === undefined) return budget;
  if (!validateDocxValue(docxCommonOptions.limit!.type, value)) usage("Invalid document limits.");
  const entries = value as { name: string; value: number }[];
  if (new Set(entries.map(item => item.name)).size !== entries.length) usage("Repeated document limit.");
  try { return budget.lower(Object.fromEntries(entries.map(item => [item.name, item.value]))); }
  catch { return usage("Document limits must be valid safe integers."); }
}
export function optionFields(schema: DocxOperationSchema, cli: boolean) {
  return Object.fromEntries([...schema.commonOptions.map(name => [name, docxCommonOptions[name]!] as const), ...Object.entries(cli ? schema.fields : schema.sdkFields)]);
}
export function validateSelections(operation: string, options: Record<string, unknown>): void {
  const selected = selectors.filter(key => options[key] !== undefined && !(key === "bookmark" && ["links.add", "links.set"].includes(operation)));
  if (options.select !== undefined) {
    try { decodeLocation(options.select as string); } catch { usage("Invalid selection token."); }
    if (selected.length || options.scope !== undefined) usage("Token and simple selection cannot be combined.");
  }
  if (options.run !== undefined && options.paragraph === undefined) usage("Run selection requires paragraph.");
  if (options.cell !== undefined && options.table === undefined) usage("Cell selection requires table.");
  if (options.comment !== undefined && options.note !== undefined || ["image", "link", "control", "revision", "shape", "field", "bookmark"].filter(key => selected.includes(key)).length > 1) usage("Sibling selectors cannot be combined.");
  const paragraphOwner = operation === "paragraphs.set" && selected.length > 0 && selected.every(key => ["section", "table", "cell", "note", "comment"].includes(key));
  if (options.all === true && operation !== "text.replace" && (selected.length && !paragraphOwner || options.select !== undefined)) usage("All conflicts with a target selection.");
  if (options.before === true && options.paragraph === undefined && !(operation === "paragraphs.add" && options.select !== undefined)) usage("Before requires a paragraph anchor.");
  if (operation.startsWith("headers.") || operation.startsWith("footers.")) {
    const scope = operation.split(".")[0];
    if (options.scope !== undefined && options.scope !== scope && options.scope !== "all-stories") usage("Inapplicable story scope.");
  }
  const global = ["styles", "properties", "settings", "signatures", "custom-xml", "glossary"];
  if (global.includes(operation.split(".")[0]!) && (selected.length || options.select !== undefined || options.scope !== undefined)) usage("Package-global resources reject story selection.");
}
export function validateEffects(operation: string, options: Record<string, unknown>, schema: DocxOperationSchema): void {
  const has = (name: string) => options[name] !== undefined;
  if (operation === "text.replace") {
    if (options.trackChanges === true) {
      if (!has("author") || !has("timestamp")) usage("Tracked replacement requires explicit author and timestamp.");
    } else if (has("author") || has("timestamp")) usage("Untracked replacement rejects author and timestamp.");
    if (options.find === "") usage("Search text must not be empty.");
    if (Number(options.first === true) + Number(options.all === true) + Number(has("occurrence")) !== 1) usage("Choose exactly one text match cardinality.");
  }
  if (operation.endsWith(".set") && !operation.startsWith("model.") && !Object.keys(schema.sdkFields).some(key => has(key) && (!["name", "variant", "kind", "covered"].includes(key) || operation === "fields.set" && key === "kind"))) usage("Set requires an effect field.");
  if (has("style") && has("level")) usage("Style and heading level conflict.");
  if (options.superscript === true && options.subscript === true) usage("Conflicting baseline formatting.");
  if (operation === "tables.set" && has("text") && !has("cell") && !has("select")) usage("Table text requires a cell.");
  if (operation === "lists.set" && has("start") && options.restart !== true) usage("Start requires restart.");
  if ((operation === "links.add" || operation === "links.set") && Number(has("target")) + Number(has("bookmark")) !== 1) usage("Choose one link target.");
  if (operation === "controls.set" && ["text", "checked", "choice", "date", "file"].filter(has).length !== 1) usage("Choose one control value.");
  if (options.linkToPrevious === true && (has("text") || options.shared === true)) usage("Conflicting linked story options.");
  if (has("fit") && (!has("width") || !has("height"))) usage("Fit requires both dimensions.");
  if (has("fit") && ["cropLeft", "cropRight", "cropTop", "cropBottom"].some(has)) usage("Fit conflicts with crop.");
  if (options.shared === true && operation === "images.replace" && (has("width") || has("height"))) usage("Shared replacement cannot resize occurrences.");
  if (options.decorative === true && typeof options.alt === "string" && options.alt.length > 0) usage("Decorative content cannot have nonempty alt text.");
  for (const [left, right] of [["cropLeft", "cropRight"], ["cropTop", "cropBottom"]]) {
    if (Number(options[left!] ?? 0) + Number(options[right!] ?? 0) >= 1) usage("Opposing crops must total less than one.");
  }
}
export function validateInvocation(value: unknown, budget: DocumentBudget, fromCli: boolean): DocxInvocation {
  const input = record(value, ["operation", "inputs", "options", ...(fromCli ? ["sources"] : [])]);
  if (typeof input.operation !== "string") usage("Operation is required.");
  const operation = input.operation;
  const schema = schemaFor(operation);
  if (schema.transport === "typed-batch") usage("Advanced operations require a typed batch.");
  if (!Array.isArray(input.inputs) || Object.getPrototypeOf(input.inputs) !== Array.prototype || !validateDocxValue("ReadonlyArray<string>", input.inputs)) usage("Expected input paths.");
  const inputs = input.inputs.map(value => { path(value); return value; });
  if (operation === "capabilities" ? inputs.length > 1 : inputs.length !== schema.inputArity) usage("Invalid input arity.");
  const options = record(input.options);
  if (operation === "properties.set") Object.assign(options, normalizeDocxPropertyOptions(options, false));
  const sources = (input.sources ?? []) as readonly DocxArgumentSource[];
  const fields = optionFields(schema, false);
  const deferred = new Set(sources.filter(source => source.format === "json").map(source => source.argument));
  const validatedFields = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, deferred.has(key) ? { ...field, required: false } : field]));
  if (operation === "batch") {
    if (deferred.has("operations")) validatedFields.version = { type: "literal 1", required: false };
    else {
      const checked = validateDocxBatch({ version: options.version, operations: options.operations }, budget, { author: options.author, timestamp: options.timestamp });
      options.operations = checked.operations;
    }
  }
  assertDocxFields(validatedFields, options, type => {
    if (type === "ReadonlyArray<OperationV1>") return true;
    return undefined;
  });
  budget = lowerLimits(options.limit, budget);
  for (const field of ["content", "data", "valueJson"]) if (options[field] !== undefined) structuredBudget(options[field], budget);
  if (operation === "batch" && options.operations !== undefined) structuredBudget({ version: options.version, operations: options.operations }, budget);
  if ((operation === "tables.add" || operation === "tables.split") && typeof options.rows === "number" && typeof options.cols === "number") budget.table(options.rows, options.cols);
  validateSelections(operation, options);
  validateDocxSelection(operation, options);
  validateEffects(operation, options, schema);
  validateDocxOptionRules(operation, options);
  const consumers = inputs.filter(input => input === "-").length + sources.filter(source => source.path === "-").length;
  if (consumers > 1) usage("Only one stdin consumer is permitted.");
  if (options.output !== undefined && options.inPlace === true) usage("Output and in-place conflict.");
  if (options.inPlace === true && (inputs.includes("-") || operation === "create" || operation === "pack")) usage("In-place requires a document path.");
  if (options.force === true && (options.output === undefined && options.outputDir === undefined || options.output === "-")) usage("Force requires a file destination.");
  if (options.output === "-" && options.json === true && options.dryRun !== true) usage("Binary stdout conflicts with JSON.");
  if (options.raw === true && (options.json === true || options.pretty === true)) usage("Raw XML conflicts with JSON or pretty output.");
  for (const key of ["output", "outputDir"]) if (options[key] !== undefined) path(options[key]);
  const mutable = ["edit", "selectedEdit", "create"].includes(schema.profile) || operation === "batch" && docxBatchMutates(options);
  if (operation === "batch" && !deferred.has("operations") && !mutable && ["output", "inPlace", "force"].some(key => options[key] !== undefined)) usage("Read-only batch rejects publication options.");
  if (mutable && options.dryRun !== true && options.output === undefined && options.inPlace !== true) usage("Mutation requires a destination.");
  if (schema.profile === "extract" && options.outputDir === undefined) usage("Extraction requires an output directory.");
  if (operation === "extract" && (selectors.some(key => options[key] !== undefined) || options.scope !== undefined || options.select !== undefined)) usage("Package extraction rejects selection.");
  if (operation === "pack" && (options.author !== undefined || options.timestamp !== undefined)) usage("Pack rejects author and timestamp.");
  const invocation = Object.freeze({ operation, inputs: Object.freeze(inputs), options: owned(options, budget) as Readonly<Record<string, unknown>>, ...(sources.length ? { sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))) } : {}) });
  docxInvocationBudgets.set(invocation, budget);
  return invocation;
}
export function validateDocxInvocation(value: unknown, budget = new DocumentBudget()): DocxInvocation {
  return validateInvocation(value, budget, false);
}
export function docxBatchMutates(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "operations")) return false;
  const handles = new Map<string, string>([["document", "DocumentModel"]]);
  return (value as DocxBatch).operations.some(item => {
    const schema = schemaFor(item.operation);
    if (schema.mutates) return true;
    if (partProviderReceivers.has(schema.receiver ?? "") && item.receiver) {
      const type = item.receiver.resultHandle === undefined ? item.receiver.type as string : handleType(item.receiver, handles);
      if (splitDocxType(type).some(type => type === "_Header" || type === "_Footer")) return true;
    }
    if (item.resultHandle) handles.set(item.resultHandle, schema.resultHandle!.type);
    return false;
  });
}
export function handleType(receiver: Record<string, unknown>, handles: ReadonlyMap<string, string>): string {
  if (!validateDocxValue("Receiver", receiver) || Object.keys(receiver).some(key => !["resultHandle", "index", "key"].includes(key))) usage("Invalid batch handle reference.");
  let type = handles.get(receiver.resultHandle as string);
  if (!type) usage("Unknown or forward result handle.");
  if (type.startsWith("Promise<") && type.endsWith(">")) type = type.slice(8, -1);
  if (receiver.index === undefined && receiver.key === undefined) return type;
  if (receiver.index !== undefined && receiver.key !== undefined) usage("Choose index or key lookup.");
  if (type.startsWith("readonly [") && type.endsWith("]")) {
    const items = splitDocxType(type.slice(10, -1), ",");
    if (receiver.key !== undefined || typeof receiver.index !== "number") usage("Tuple handles require an index.");
    if (receiver.index >= items.length) throw new BoundsError("Tuple handle index is out of bounds.");
    return items[receiver.index]!;
  }
  if ((type.startsWith("ReadonlyArray<") || type.startsWith("IterableIterator<")) && type.endsWith(">")) {
    if (receiver.key !== undefined) usage("Sequences require an index.");
    return type.slice(type.indexOf("<") + 1, -1);
  }
  if (type.startsWith("ReadonlyMap<string, ") && type.endsWith(">")) {
    if (receiver.index !== undefined || typeof receiver.key !== "string") usage("Maps require a string key.");
    return type.slice("ReadonlyMap<string, ".length, -1);
  }
  const lookups = Object.entries(docxOperationSchemas).filter(([id, schema]) => schema.receiver === type && id.includes(".__getitem__.") && !id.endsWith(".slice"));
  const lookup = lookups.find(([, schema]) => receiver.index !== undefined ? Object.hasOwn(schema.fields, "index") : Object.hasOwn(schema.fields, "key") || Object.hasOwn(schema.fields, "rId"));
  if (!lookup) usage("The handle does not expose that collection lookup.");
  return lookup[1].valueType;
}
export function checkArgumentHandles(value: unknown, handles: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== "object" || value instanceof Uint8Array || value instanceof Date) return;
  if (!Array.isArray(value) && Object.hasOwn(value, "resultHandle")) handleType(value as Record<string, unknown>, handles);
  else for (const item of Object.values(value)) checkArgumentHandles(item, handles);
}
export function validateDocxBatch(value: unknown, budget = new DocumentBudget(), defaults: unknown = {}): DocxBatch {
  const context = record(defaults, ["author", "timestamp"]);
  assertDocxFields({ author: docxCommonOptions.author!, timestamp: docxCommonOptions.timestamp! }, context);
  const batch = record(value, ["version", "operations"]);
  if (batch.version !== 1 || !Array.isArray(batch.operations) || Object.getPrototypeOf(batch.operations) !== Array.prototype || !validateDocxValue("ReadonlyArray<unknown>", batch.operations)) usage("Expected a version 1 batch.");
  structuredBudget(batch, budget);
  budget.check("batchOperations", batch.operations.length);
  const handles = new Map([["document", "DocumentModel"]]);
  const ids = new Set<string>();
  const operations = batch.operations.map((value, index) => {
    try {
      const item = record(value, ["id", "operation", "arguments", "receiver", "resultHandle"]);
      const id = item.id === undefined ? `step${index + 1}` : item.id;
      if (typeof id !== "string" || !id || id.length > 64 || !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".includes(id[0]!) || [...id].some(c => !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".includes(c)) || ids.has(id)) usage("Invalid or duplicate batch operation ID.");
      ids.add(id);
      if (typeof item.operation !== "string") usage("Batch operation is required.");
      const schema = schemaFor(item.operation);
      if (schema.transport === "direct") usage("Operation is not available in batch.");
      const fields = { ...(schema.batchFields ?? schema.sdkFields) };
      for (const name of schema.commonOptions) if (!publication.includes(name)) fields[name] = docxCommonOptions[name]!;
      const arguments_ = record(item.arguments);
      if (item.operation === "text.replace" && arguments_.trackChanges === true) {
        for (const key of ["author", "timestamp"]) if (context[key] !== undefined) {
          if (arguments_[key] !== undefined && arguments_[key] !== context[key]) usage("Conflicting batch context metadata.");
          arguments_[key] = context[key];
        }
      }
      if (item.operation === "properties.set") Object.assign(arguments_, normalizeDocxPropertyOptions(arguments_, false));
      assertDocxFields(fields, arguments_, (type, value) => {
        if (schema.transport !== "typed-batch" || type === "unknown" || !value || typeof value !== "object" || !Object.hasOwn(value, "resultHandle")) return undefined;
        const source = handleType(value as Record<string, unknown>, handles);
        if (validateDocxValue(type, value)) return true;
        const targets = splitDocxType(type);
        return splitDocxType(source).every(candidate => targets.includes(candidate));
      });
      for (const [name, value] of Object.entries(arguments_)) if (fields[name]?.type !== "unknown") checkArgumentHandles(value, handles);
      validateSelections(item.operation, arguments_);
      if (schema.transport !== "typed-batch") {
        validateDocxSelection(item.operation, arguments_);
        validateEffects(item.operation, arguments_, schema);
      }
      validateDocxOptionRules(item.operation, arguments_);
      let receiver: Record<string, unknown> | undefined;
      if (schema.receiver && item.receiver === undefined) usage("This operation requires a typed receiver.");
      if (!schema.receiver && item.receiver !== undefined) usage("This operation does not accept a receiver.");
      if (item.receiver !== undefined) {
        receiver = record(item.receiver, ["id", "type", "owner", "revision", "resultHandle", "index", "key"]);
        if (!validateDocxValue("Receiver", receiver)) usage("Invalid model receiver.");
        if (receiver.resultHandle !== undefined) {
          if (typeof receiver.resultHandle !== "string" || !handles.has(receiver.resultHandle) || receiver.index !== undefined && receiver.key !== undefined || ["id", "type", "owner", "revision"].some(key => receiver![key] !== undefined)) usage("Invalid batch handle reference.");
          if (receiver.index !== undefined && (typeof receiver.index !== "number" || !Number.isSafeInteger(receiver.index) || receiver.index < 0)) usage("Invalid handle index.");
          if (receiver.key !== undefined && typeof receiver.key !== "string") usage("Invalid handle key.");
          const type = handleType(receiver, handles);
          const styleReceivers: Readonly<Record<string, readonly string[]>> = { BaseStyle: ["CharacterStyle", "ParagraphStyle", "_TableStyle", "_NumberingStyle"], CharacterStyle: ["BaseStyle", "ParagraphStyle", "_TableStyle"], ParagraphStyle: ["BaseStyle", "CharacterStyle", "_TableStyle"], _TableStyle: ["BaseStyle", "CharacterStyle", "ParagraphStyle"], _NumberingStyle: ["BaseStyle"] };
          const packageReceivers: Readonly<Record<string, readonly string[]>> = { _Text: ["XmlElementView"], XmlPartView: ["XmlPart", "Part", "PartView", "StylesPart", "StoryPart", "HeaderPart", "FooterPart", "CommentsPart", "SettingsPart", "NumberingPart", "DocumentPart", "CorePropertiesPart"], PartView: ["Part", "XmlPart", "XmlPartView", "StylesPart", "StoryPart", "HeaderPart", "FooterPart", "CommentsPart", "SettingsPart", "NumberingPart", "DocumentPart", "CorePropertiesPart", "ImagePart"], PackageView: ["Package", "OpcPackage"], RelationshipView: ["_Relationship"], DocumentPart: ["Part", "XmlPart", "PartView", "XmlPartView", "StoryPart"], StoryPart: ["Part", "XmlPart", "PartView", "XmlPartView"], HeaderPart: ["Part", "XmlPart", "PartView", "XmlPartView", "StoryPart"], FooterPart: ["Part", "XmlPart", "PartView", "XmlPartView", "StoryPart"], CommentsPart: ["Part", "XmlPart", "PartView", "XmlPartView", "StoryPart"], SettingsPart: ["Part", "XmlPart", "PartView", "XmlPartView"], NumberingPart: ["Part", "XmlPart", "PartView", "XmlPartView"], StylesPart: ["Part", "XmlPart", "PartView", "XmlPartView"], CorePropertiesPart: ["Part", "XmlPart", "PartView", "XmlPartView"], ImagePart: ["Part", "PartView"] };
          if (!type.split(" | ").some(candidate => (docxEnumCanonicalNames[candidate] ?? candidate) === (docxEnumCanonicalNames[schema.receiver!] ?? schema.receiver) || partProviderReceivers.get(schema.receiver!)?.has(candidate) || styleReceivers[candidate]?.includes(schema.receiver!) || packageReceivers[candidate]?.includes(schema.receiver!))) usage("Handle type does not match receiver.");
        } else if (typeof receiver.id !== "string" || !receiver.id || typeof receiver.type !== "string" || !receiver.type || typeof receiver.owner !== "string" || !receiver.owner || typeof receiver.revision !== "number" || !Number.isSafeInteger(receiver.revision) || receiver.revision < 0) usage("Invalid model receiver.");
        else if (receiver.type !== schema.receiver) usage("Receiver type does not match operation.");
      }
      if (item.resultHandle !== undefined) {
        if (!schema.resultHandle?.allowed) usage("This operation cannot bind a result handle.");
        const name = item.resultHandle;
        if (typeof name !== "string" || !validateDocxValue("BatchHandleName", name) || handles.has(name)) usage("Invalid or duplicate result handle.");
        handles.set(name, schema.resultHandle.type);
      }
      return Object.freeze({ ...(typeof item.id === "string" ? { id: item.id } : {}), operation: item.operation, arguments: Object.freeze(arguments_), ...(receiver ? { receiver: Object.freeze(receiver) } : {}), ...(typeof item.resultHandle === "string" ? { resultHandle: item.resultHandle } : {}) });
    } catch (error) {
      if (error instanceof Error) Object.assign(error, { operationIndex: index });
      throw error;
    }
  });
  return owned({ version: 1, operations }, budget) as DocxBatch;
}
