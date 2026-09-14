import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { getDocxDiscovery } from "./discovery.js";
import { DocumentBudget, type DocumentLimits } from "./budget.js";
import { ResourceLimitError } from "./archive.js";
import { validateDocxSelection } from "./command-selection.js";
import { validateDocxOptionRules } from "./command-option-rules.js";
import { normalizeDocxPropertyOptions } from "./command-properties.js";
import { decodeLocation } from "./location-token.js";
import { DocxUsageError, decodeDocxText, parseDocxJson, docxByteLength, copyDocxBytes } from "./argument-json.js";
import { docxOperationSchemas, docxCommonOptions, assertDocxFields, validateDocxValue, type DocxOperationSchema } from "./operation-schema.js";

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

const selectors = ["section", "paragraph", "run", "table", "cell", "image", "comment", "note", "link", "control", "revision", "shape", "field", "bookmark"];
const publication = ["output", "outputDir", "inPlace", "force", "dryRun", "json", "limit", "timestamp", "author"];
const switches = new Set(["json", "inPlace", "force", "dryRun", "allowEmpty", "allowPartialOutput", "first", "all", "raw", "pretty", "unique", "shared", "before"]);
const sourceFields = new Set(["file", "fallback", "template", "contentFile", "dataFile", "opsFile"]);
export const docxInvocationBudgets = new WeakMap<DocxInvocation, DocumentBudget>();
const errorContexts = new WeakMap<Error, { operation: string; json: boolean; budget: DocumentBudget }>();
function usage(message: string): never { throw new DocxUsageError(message); }
function schemaFor(id: string): DocxOperationSchema {
  if (!Object.hasOwn(docxOperationSchemas, id)) usage("Unknown document operation.");
  return docxOperationSchemas[id]!;
}
function direct(id: string): boolean { return Object.hasOwn(docxOperationSchemas, id) && schemaFor(id).transport !== "typed-batch"; }
function kebab(key: string): string {
  return [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("");
}
function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
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
function path(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !validateDocxValue("string", value)) usage("Expected a nonempty Unicode path.");
}
function owned(value: unknown, budget: DocumentBudget): unknown {
  if (typeof value === "string") budget.charge("retainedBytes", new TextEncoder().encode(value).length);
  if (value instanceof Uint8Array) { budget.charge("retainedBytes", docxByteLength(value)); return copyDocxBytes(value); }
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return Object.freeze(value.map(item => owned(item, budget)));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, owned(v, budget)])));
  return value;
}
function structuredBudget(value: unknown, budget: DocumentBudget): void {
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
function decimal(value: string): number {
  if (!value || value.trim() !== value) usage("Expected finite decimal notation.");
  let cursor = 0;
  if (value[cursor] === "+" || value[cursor] === "-") cursor++;
  let digits = 0;
  while (value[cursor] !== undefined && "0123456789".includes(value[cursor]!)) { cursor++; digits++; }
  if (value[cursor] === ".") {
    cursor++;
    while (value[cursor] !== undefined && "0123456789".includes(value[cursor]!)) { cursor++; digits++; }
  }
  if (!digits) usage("Expected finite decimal notation.");
  if (value[cursor] === "e" || value[cursor] === "E") {
    cursor++;
    if (value[cursor] === "+" || value[cursor] === "-") cursor++;
    let exponent = 0;
    while (value[cursor] !== undefined && "0123456789".includes(value[cursor]!)) { cursor++; exponent++; }
    if (!exponent) usage("Expected finite decimal notation.");
  }
  const number = Number(value);
  if (cursor !== value.length || !Number.isFinite(number)) usage("Expected finite decimal notation.");
  return number;
}
function cliValue(type: string, raw: string, name: string, budget: DocumentBudget): unknown {
  if (name.endsWith("Json")) return parseDocxJson(raw, budget);
  const variants = type.split("|").map(s => s.trim());
  if (raw === "null" && variants.includes("null") && name !== "text") return null;
  if (variants.includes("string") || type === "VfsInput" || type.startsWith("Vfs") || type === "LocationToken") return raw;
  if (variants.includes("boolean") && (raw === "true" || raw === "false")) return raw === "true";
  if (type.includes("Length") && type !== "Length | positive decimal multiple | null") {
    for (const unit of ["emu", "in", "cm", "mm", "pt"]) if (raw.endsWith(unit)) return { value: decimal(raw.slice(0, -unit.length)), unit };
    if (variants.includes("finite number") || variants.includes("number")) return decimal(raw);
    usage("Lengths require explicit units.");
  }
  if (type.includes("integer") || type === "number" || type.startsWith("number ") || type.startsWith("finite ") || type.includes("fraction") || type.includes("decimal multiple")) return decimal(raw);
  if (name === "remove") return raw.split(",");
  if (name === "levels") {
    const ends = raw.split("-");
    if (ends.length !== 2) usage("Expected a level range.");
    return { start: decimal(ends[0]!), end: decimal(ends[1]!) };
  }
  const enumType = variants.find(value => value.startsWith("WD_") || value.startsWith("MSO_"));
  if (enumType) return { enum: enumType, name: raw };
  return raw;
}
function lowerLimits(value: unknown, budget: DocumentBudget): DocumentBudget {
  if (value === undefined) return budget;
  if (!validateDocxValue(docxCommonOptions.limit!.type, value)) usage("Invalid document limits.");
  const entries = value as { name: string; value: number }[];
  if (new Set(entries.map(item => item.name)).size !== entries.length) usage("Repeated document limit.");
  try { return budget.lower(Object.fromEntries(entries.map(item => [item.name, item.value]))); }
  catch { return usage("Document limits must be within host ceilings."); }
}
function optionFields(schema: DocxOperationSchema, cli: boolean) {
  return Object.fromEntries([...schema.commonOptions.map(name => [name, docxCommonOptions[name]!] as const), ...Object.entries(cli ? schema.fields : schema.sdkFields)]);
}

export function parseDocxArguments(args: readonly Uint8Array[], budget = new DocumentBudget()): DocxInvocation {
  let operation = "";
  let json = false;
  try {
  if (!Array.isArray(args) || Object.getPrototypeOf(args) !== Array.prototype || !validateDocxValue("ReadonlyArray<Uint8Array>", args)) usage("Expected literal byte arguments.");
  const words = args.map(bytes => {
    budget.charge("retainedBytes", docxByteLength(bytes));
    const word = decodeDocxText(bytes);
    if (word.includes("\0")) usage("NUL is not permitted in arguments.");
    return word;
  });
  if (words.length === 0) words.push("help");
  if (words[0] === "--help" || words[0] === "-h") words[0] = "help";
  if (words[0] === "--version") words[0] = "version";
  let consumed = 0;
  for (let count = 1; count <= words.length; count++) {
    if (words[count - 1]!.includes(".")) break;
    const candidate = words.slice(0, count).join(".");
    if (direct(candidate)) { operation = candidate; consumed = count; }
    if (words[count]?.startsWith("-")) break;
  }
  if (words[0] === "text" && consumed === 0) { operation = "text.get"; consumed = 1; }
  if (!operation) usage("Unknown document command path.");
  const schema = schemaFor(operation);
  const fields = optionFields(schema, true);
  const names = new Map(Object.keys(fields).map(key => ["--" + kebab(key), key]));
  if (Object.hasOwn(fields, "output")) names.set("-o", "output");
  const options: Record<string, unknown> = {};
  const inputs: string[] = [];
  let terminated = false;
  let help = false;
  // Determine error transport before interpreting values; a flag used as a value is literal.
  for (let index = consumed; index < words.length; index++) {
    const word = words[index]!;
    if (word === "--") break;
    const equal = word.indexOf("=");
    const name = names.get(equal < 0 ? word : word.slice(0, equal));
    if (name === "json" && equal < 0) json = true;
    if (name && !switches.has(name) && equal < 0) index++;
  }
  for (let index = consumed; index < words.length; index++) {
    const word = words[index]!;
    if (!terminated && word === "--") { terminated = true; continue; }
    if (!terminated && (word === "--help" || word === "-h")) {
      if (help || operation === "version") usage("Conflicting discovery options.");
      help = true; continue;
    }
    if (terminated || !word.startsWith("-") || word === "-") { path(word); inputs.push(word); continue; }
    const equal = word.indexOf("=");
    const flag = equal < 0 ? word : word.slice(0, equal);
    const name = names.get(flag);
    if (!name) usage("Unknown or inapplicable document option.");
    if (name !== "limit" && Object.hasOwn(options, name)) usage("Repeated scalar option.");
    if (switches.has(name)) {
      if (equal >= 0) usage("Presence switches accept no value.");
      options[name] = true;
      if (name === "json") json = true;
      continue;
    }
    const raw = equal >= 0 ? word.slice(equal + 1) : words[++index];
    if (raw === undefined) usage("Missing option value.");
    if (name === "limit") {
      const split = raw.indexOf("=");
      if (split <= 0) usage("Expected a named limit.");
      const key = raw.slice(0, split);
      const limits = (options.limit ?? []) as { name: string; value: number }[];
      if (limits.some(item => item.name === key)) usage("Repeated document limit.");
      limits.push({ name: key, value: decimal(raw.slice(split + 1)) });
      budget = lowerLimits(limits, budget);
      options.limit = limits;
    } else {
      options[name] = name.endsWith("Json") ? raw : cliValue(fields[name]!.type, raw, name, budget);
      if (!name.endsWith("Json") && !validateDocxValue(fields[name]!.type, options[name])) usage("Invalid option value.");
    }
  }
  budget = lowerLimits(options.limit, budget);
  for (const name of Object.keys(options)) if (name.endsWith("Json")) options[name] = parseDocxJson(options[name] as string, budget);
  if (operation === "properties.set" && !help) Object.assign(options, normalizeDocxPropertyOptions(options, true));
  if (operation === "help" || operation === "schema") {
    if (inputs.some(word => word.includes("."))) usage("Unknown discovery path.");
    const target = inputs.join(".");
    if (target && !direct(target) && target !== "text") usage("Unknown discovery path.");
    if (target) {
      const id = target === "text" ? "text.get" : target;
      if (options.operation !== undefined && id !== "batch" && options.operation !== id) usage("Conflicting discovery path and operation.");
      if (options.operation === undefined) options.operation = id;
      else if (id === "batch" && schemaFor(options.operation as string).transport === "direct") usage("Operation is not available in batch.");
    }
    if (options.operation !== undefined) schemaFor(options.operation as string);
    return Object.freeze({ operation, inputs: Object.freeze([]), options: Object.freeze(options) });
  }
  if (help) {
    assertDocxFields(Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, { ...field, required: false }])), options, (type, value) => {
      if (type === "BatchV1") { validateDocxBatch(value, budget); return true; }
      return undefined;
    });
    if (inputs.length > Number(schema.inputArity === "0|1" ? 1 : schema.inputArity)) usage("Invalid input arity.");
    for (const [file, json] of [["contentFile", "contentJson"], ["dataFile", "dataJson"], ["opsFile", "opsJson"]]) if (options[file!] !== undefined && options[json!] !== undefined) usage("Conflicting JSON sources.");
    if (options.output !== undefined && options.inPlace === true) usage("Output and in-place conflict.");
    if (options.raw === true && (options.json === true || options.pretty === true)) usage("Conflicting XML output modes.");
    validateSelections(operation, options);
    const invocation = Object.freeze({ operation: "help", inputs: Object.freeze([]), options: Object.freeze({ operation, ...(options.json === true ? { json: true } : {}) }) });
    docxInvocationBudgets.set(invocation, budget);
    return invocation;
  }
  for (const name of ["tabStops", "tabStopAdd", "borders", "shading"]) {
    if (options[name + "Json"] !== undefined) { options[name] = options[name + "Json"]; delete options[name + "Json"]; }
  }
  const sources: DocxArgumentSource[] = [];
  for (const [file, json, semantic, type] of [["contentFile", "contentJson", "content", "OriginalDocumentContentV1"], ["dataFile", "dataJson", "data", "TemplateData"], ["opsFile", "opsJson", "operations", "BatchV1"]]) {
    if (options[file!] !== undefined && options[json!] !== undefined) usage("Conflicting JSON sources.");
    if (options[json!] !== undefined) {
      if (type === "BatchV1") Object.assign(options, validateDocxBatch(options[json!], budget));
      else options[semantic!] = options[json!];
      delete options[json!];
    }
    if (options[file!] !== undefined) {
      const source = options[file!]; path(source);
      sources.push({ argument: semantic!, path: source, format: "json", type: type! });
      delete options[file!];
    }
  }
  for (const field of sourceFields) if (options[field] !== undefined) {
    const source = options[field]; path(source);
    sources.push({ argument: field, path: source, format: "binary", type: "BinaryInput" });
    options[field] = { kind: "vfs", path: source, capability: "command" };
  }
  return validateInvocation({ operation, inputs, options, sources }, budget, true);
  } catch (error) {
    if (error instanceof Error) errorContexts.set(error, { operation: operation || "help", json, budget });
    throw error;
  }
}

function validateSelections(operation: string, options: Record<string, unknown>): void {
  const selected = selectors.filter(key => options[key] !== undefined);
  if (options.select !== undefined) {
    try { decodeLocation(options.select as string); } catch { usage("Invalid selection token."); }
    if (selected.length || options.scope !== undefined) usage("Token and simple selection cannot be combined.");
  }
  if (options.run !== undefined && options.paragraph === undefined) usage("Run selection requires paragraph.");
  if (options.cell !== undefined && options.table === undefined) usage("Cell selection requires table.");
  if (options.comment !== undefined && options.note !== undefined || ["image", "link", "control", "revision", "shape", "field", "bookmark"].filter(key => options[key] !== undefined).length > 1) usage("Sibling selectors cannot be combined.");
  const paragraphOwner = operation === "paragraphs.set" && selected.length > 0 && selected.every(key => ["section", "table", "cell", "note", "comment"].includes(key));
  if (options.all === true && operation !== "text.replace" && (selected.length && !paragraphOwner || options.select !== undefined)) usage("All conflicts with a target selection.");
  if (options.before === true && options.paragraph === undefined && !(operation === "paragraphs.add" && options.select !== undefined)) usage("Before requires a paragraph anchor.");
  if (operation.startsWith("headers.") || operation.startsWith("footers.")) {
    const scope = operation.split(".")[0];
    if (options.scope !== undefined && options.scope !== scope && options.scope !== "all-stories") usage("Inapplicable story scope.");
  }
  const global = ["styles", "properties", "settings", "fonts", "signatures", "custom-xml", "glossary"];
  if (global.includes(operation.split(".")[0]!) && (selected.length || options.select !== undefined || options.scope !== undefined)) usage("Package-global resources reject story selection.");
}
function validateEffects(operation: string, options: Record<string, unknown>, schema: DocxOperationSchema): void {
  const has = (name: string) => options[name] !== undefined;
  if (operation === "text.replace") {
    if (options.find === "") usage("Search text must not be empty.");
    if (Number(options.first === true) + Number(options.all === true) + Number(has("occurrence")) !== 1) usage("Choose exactly one text match cardinality.");
  }
  if (operation.endsWith(".set") && !operation.startsWith("model.") && !Object.keys(schema.sdkFields).some(key => has(key) && !["name", "variant", "kind"].includes(key))) usage("Set requires an effect field.");
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
function validateInvocation(value: unknown, budget: DocumentBudget, fromCli: boolean): DocxInvocation {
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
      const checked = validateDocxBatch({ version: options.version, operations: options.operations }, budget);
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
  const mutable = ["edit", "selectedEdit", "create"].includes(schema.profile) || operation === "batch" && batchMutates(options);
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
function batchMutates(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "operations")) return false;
  return (value as DocxBatch).operations.some(item => {
    const schema = schemaFor(item.operation);
    return schema.mutates;
  });
}
function handleType(receiver: Record<string, unknown>, handles: ReadonlyMap<string, string>): string {
  const type = handles.get(receiver.resultHandle as string);
  if (!type) usage("Unknown or forward result handle.");
  if (receiver.index === undefined && receiver.key === undefined) return type;
  if (receiver.index !== undefined && receiver.key !== undefined) usage("Choose index or key lookup.");
  if (type.startsWith("ReadonlyArray<") && type.endsWith(">")) {
    if (receiver.key !== undefined) usage("Sequences require an index.");
    return type.slice(14, -1);
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
function checkArgumentHandles(value: unknown, handles: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== "object" || value instanceof Uint8Array || value instanceof Date) return;
  if (!Array.isArray(value) && Object.hasOwn(value, "resultHandle")) handleType(value as Record<string, unknown>, handles);
  else for (const item of Object.values(value)) checkArgumentHandles(item, handles);
}
export function validateDocxBatch(value: unknown, budget = new DocumentBudget()): DocxBatch {
  const batch = record(value, ["version", "operations"]);
  if (batch.version !== 1 || !Array.isArray(batch.operations) || Object.getPrototypeOf(batch.operations) !== Array.prototype || !validateDocxValue("ReadonlyArray<unknown>", batch.operations)) usage("Expected a version 1 batch.");
  structuredBudget(batch, budget);
  budget.check("batchOperations", batch.operations.length);
  const handles = new Map([["document", "DocumentModel"]]);
  const operations = batch.operations.map(value => {
    const item = record(value, ["operation", "arguments", "receiver", "resultHandle"]);
    if (typeof item.operation !== "string") usage("Batch operation is required.");
    const schema = schemaFor(item.operation);
    if (schema.transport === "direct") usage("Operation is not available in batch.");
    const fields = { ...(schema.batchFields ?? schema.sdkFields) };
    for (const name of schema.commonOptions) if (!publication.includes(name)) fields[name] = docxCommonOptions[name]!;
    const arguments_ = record(item.arguments);
    if (item.operation === "properties.set") Object.assign(arguments_, normalizeDocxPropertyOptions(arguments_, false));
    assertDocxFields(fields, arguments_);
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
      if (receiver.resultHandle !== undefined) {
        if (typeof receiver.resultHandle !== "string" || !handles.has(receiver.resultHandle) || receiver.index !== undefined && receiver.key !== undefined || ["id", "type", "owner", "revision"].some(key => receiver![key] !== undefined)) usage("Invalid batch handle reference.");
        if (receiver.index !== undefined && (typeof receiver.index !== "number" || !Number.isSafeInteger(receiver.index) || receiver.index < 0)) usage("Invalid handle index.");
        if (receiver.key !== undefined && typeof receiver.key !== "string") usage("Invalid handle key.");
        const type = handleType(receiver, handles);
        const styleReceivers: Readonly<Record<string, readonly string[]>> = { BaseStyle: ["CharacterStyle", "ParagraphStyle", "_TableStyle", "_NumberingStyle"], CharacterStyle: ["BaseStyle", "ParagraphStyle", "_TableStyle"], ParagraphStyle: ["BaseStyle", "CharacterStyle", "_TableStyle"], _TableStyle: ["BaseStyle", "CharacterStyle", "ParagraphStyle"], _NumberingStyle: ["BaseStyle"] };
        if (!type.split(" | ").some(candidate => candidate === schema.receiver || styleReceivers[candidate]?.includes(schema.receiver!))) usage("Handle type does not match receiver.");
      } else if (typeof receiver.id !== "string" || !receiver.id || typeof receiver.type !== "string" || !receiver.type || typeof receiver.owner !== "string" || !receiver.owner || typeof receiver.revision !== "number" || !Number.isSafeInteger(receiver.revision) || receiver.revision < 0) usage("Invalid model receiver.");
      else if (receiver.type !== schema.receiver) usage("Receiver type does not match operation.");
    }
    if (item.resultHandle !== undefined) {
      if (!schema.resultHandle?.allowed) usage("This operation cannot bind a result handle.");
      const name = item.resultHandle;
      if (typeof name !== "string" || !name || !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".includes(name[0]!) || [...name].some(c => !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".includes(c)) || handles.has(name)) usage("Invalid or duplicate result handle.");
      handles.set(name, schema.resultHandle.type);
    }
    return Object.freeze({ operation: item.operation, arguments: Object.freeze(arguments_), ...(receiver ? { receiver: Object.freeze(receiver) } : {}), ...(typeof item.resultHandle === "string" ? { resultHandle: item.resultHandle } : {}) });
  });
  return owned({ version: 1, operations }, budget) as DocxBatch;
}

export interface DocxCommandRequest {
  readonly args: readonly Uint8Array[];
  readonly stdin: AsyncIterable<Uint8Array>;
  readonly stdout: { write(bytes: Uint8Array): Promise<void> };
  readonly stderr: { write(bytes: Uint8Array): Promise<void> };
  readonly signal: AbortSignal;
}
export function createDocxCommandEngine<Request extends DocxCommandRequest>(handler: {
  execute(invocation: DocxInvocation, request: Request): Promise<{ readonly exitCode: number }>;
  readSource?(source: DocxArgumentSource, request: Request, budget: DocumentBudget): Promise<Uint8Array>;
}, hostLimits: Partial<DocumentLimits> = {}) {
  return {
    async execute(request: Request): Promise<{ readonly exitCode: number }> {
      request.signal.throwIfAborted();
      let invocation: DocxInvocation | undefined;
      let budget = new DocumentBudget(hostLimits, request.signal);
      let discoveryOutput: Uint8Array | undefined;
      try {
        invocation = parseDocxArguments(request.args, budget);
        budget = docxInvocationBudgets.get(invocation) ?? lowerLimits(invocation.options.limit, budget);
        const discovery = schemaFor(invocation.operation).discovery ? getDocxDiscovery(invocation, budget) : undefined;
        if (discovery) {
          const output = invocation.options.json === true || invocation.operation === "schema"
            ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data: discovery.data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n"
            : discovery.human;
          discoveryOutput = new TextEncoder().encode(output);
          budget.check("serializedOutput", discoveryOutput.byteLength);
        }
        const options = { ...invocation.options };
        const sources = invocation.sources ?? [];
        for (const source of sources) {
          if (source.format !== "json") continue;
          let bytes: Uint8Array;
          try {
          if (source.path === "-") {
            const chunks: Uint8Array[] = [];
            let size = 0;
            for await (const chunk of request.stdin) {
              request.signal.throwIfAborted();
              size += docxByteLength(chunk);
              budget.check("xmlPartBytes", size);
              budget.charge("retainedBytes", docxByteLength(chunk));
              chunks.push(copyDocxBytes(chunk));
            }
            budget.charge("retainedBytes", size);
            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          } else {
            if (!handler.readSource) throw new SourceError();
            bytes = await handler.readSource(source, request, budget);
            request.signal.throwIfAborted();
          }
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ResourceLimitError || error instanceof DocxUsageError) throw error;
            throw new SourceError(error);
          }
          const value = parseDocxJson(bytes, budget);
          if (source.type === "BatchV1") Object.assign(options, validateDocxBatch(value, budget));
          else options[source.argument] = value;
        }
        if (sources.some(source => source.format === "json")) invocation = validateInvocation({ ...invocation, options, sources: sources.filter(source => source.format !== "json") }, budget, true);
      }
      catch (error) {
        if (!(error instanceof DocxUsageError) && !(error instanceof ResourceLimitError) && !(error instanceof SourceError)) throw error;
        const context = errorContexts.get(error) ?? { operation: invocation?.operation ?? "help", json: invocation?.options.json === true, budget };
        const code = error instanceof ResourceLimitError ? "limit-exceeded" : error instanceof SourceError ? "source-failure" : "usage";
        const diagnostic = commandDiagnostic(error.message, code, context.budget.limits.diagnosticBytes);
        if (context.json || context.operation === "schema") await request.stdout.write(new TextEncoder().encode(JSON.stringify({ version: 1, operation: context.operation, ok: false, data: null, warnings: [], errors: [{ code, message: diagnostic.message }], affected: 0, locations: [] }) + "\n"));
        await request.stderr.write(new TextEncoder().encode(diagnostic.human));
        return { exitCode: context.operation === "diff" ? 2 : error instanceof ResourceLimitError ? 4 : error instanceof SourceError ? 3 : 2 };
      }
      if (discoveryOutput) {
        request.signal.throwIfAborted();
        await request.stdout.write(discoveryOutput);
        return { exitCode: 0 };
      }
      return handler.execute(invocation, request);
    }
  };
}

export function commandDiagnostic(source: string, code: string, limit: number): { message: string; human: string } {
  const encoder = new TextEncoder();
  const prefix = limit >= 8 ? "docx: " : "";
  const suffix = limit >= 2 ? "\n" : "";
  const jsonOverhead = encoder.encode(JSON.stringify([{ code, message: "" }])).byteLength;
  const capacity = Math.max(1, limit - Math.max(prefix.length + suffix.length, jsonOverhead));
  const marker = capacity >= 12 ? " [truncated]" : ".";
  const pieces: { raw: string; human: string; size: number }[] = [];
  let size = 0;
  let truncated = false;
  for (const raw of source) {
    const human = escapeTerminalText(raw);
    const width = Math.max(encoder.encode(human).byteLength, encoder.encode(JSON.stringify(raw)).byteLength - 2);
    if (width > capacity - size) { truncated = true; break; }
    pieces.push({ raw, human, size: width });
    size += width;
  }
  if (truncated) {
    while (pieces.length && size + marker.length > capacity) size -= pieces.pop()!.size;
  }
  const ending = truncated ? marker : "";
  return {
    message: pieces.map(piece => piece.raw).join("") + ending,
    human: prefix + pieces.map(piece => piece.human).join("") + ending + suffix,
  };
}
