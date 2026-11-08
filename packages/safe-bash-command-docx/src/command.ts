import { type DocxInvocation, type DocxArgumentSource, path, usage, schemaFor, optionFields, lowerLimits, validateDocxBatch, validateSelections, docxInvocationBudgets, validateInvocation, SourceError } from "safe-bash-docx-engine/invocation";
import { BoundsError } from "safe-bash-docx-engine/model-errors";

import { escapeTerminalText } from "@poe-code/terminal-text";
import { getDocxDiscovery } from "./discovery.js";
import { DocumentBudget, type DocumentLimits } from "safe-bash-docx-engine/budget";
import { ResourceLimitError } from "safe-bash-docx-engine/archive";
import { PermissionError, asPermissionError } from "safe-bash-docx-engine/io-errors";

import { normalizeDocxPropertyOptions } from "safe-bash-docx-engine/command-properties";

import { DocxUsageError, decodeDocxText, parseDocxJson, docxByteLength, copyDocxBytes } from "safe-bash-docx-engine/argument-json";
import { docxOperationSchemas, assertDocxFields, validateDocxValue } from "safe-bash-docx-engine/operation-schema";
const switches = new Set(["json", "inPlace", "force", "dryRun", "allowEmpty", "allowPartialOutput", "first", "all", "raw", "pretty", "unique", "shared", "before", "deleteContent", "trackChanges"]);
const sourceFields = new Set(["file", "fallback", "template", "contentFile", "dataFile", "opsFile"]);
const errorContexts = new WeakMap<Error, { operation: string; json: boolean; budget: DocumentBudget }>();
function direct(id: string): boolean { return Object.hasOwn(docxOperationSchemas, id) && schemaFor(id).transport !== "typed-batch"; }
function kebab(key: string): string {
  return [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("");
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
function tryParseCliLength(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  for (const unit of ["emu", "twip", "dxa", "in", "cm", "mm", "pt"] as const) {
    if (raw.endsWith(unit)) {
      const numPart = raw.slice(0, -unit.length).trim();
      if (!numPart) return raw;
      const num = Number(numPart);
      if (Number.isFinite(num)) return { value: num, unit: unit === "dxa" ? "twip" : unit };
    }
  }
  return raw;
}
const LENGTH_JSON_KEYS = new Set(["width", "height", "size", "cellMargin", "rowHeight", "space", "position", "top", "right", "bottom", "left", "header", "footer", "gutter"]);
function normalizeCliJsonLengths(value: unknown, keyHint?: string): unknown {
  if (typeof value === "string") {
    return keyHint && LENGTH_JSON_KEYS.has(keyHint) ? tryParseCliLength(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(item => keyHint === "columnWidths" || keyHint === "columnWidthsJson" ? tryParseCliLength(item) : normalizeCliJsonLengths(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeCliJsonLengths(v, k);
    }
    if (keyHint === "cellMargin" && !("value" in out) && !("unit" in out)) {
      const side = out.top ?? out.left ?? out.bottom ?? out.right;
      if (side !== undefined) return side;
    }
    if (out.kind === "table" && out.repeatHeader !== undefined && out.headerRows !== undefined) {
      if ((out.repeatHeader === true && typeof out.headerRows === "number" && out.headerRows >= 1) || (out.repeatHeader === false && out.headerRows === 0)) {
        delete out.repeatHeader;
      }
    }
    return out;
  }
  return value;
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
  if (!operation) {
    const valueFlags = new Set(Object.keys(docxOperationSchemas).filter(id => !id.startsWith("model.")).map(id => docxOperationSchemas[id]!).flatMap(declaration =>
      Object.keys(optionFields(declaration, true)).filter(name => !switches.has(name)).map(name => "--" + kebab(name))));
    valueFlags.add("-o");
    for (let index = 1; index < words.length; index++) {
      const word = words[index]!;
      if (word === "--") break;
      if (word === "--json") json = true;
      if (valueFlags.has(word)) index++;
    }
    const replacement = new Map([
      ["image", "images"], ["table", "tables"],
      ["metadata", "properties"], ["replace", "text replace"]
    ]).get(words[0]!);
    usage(replacement ? `Unknown document command path. Use docx ${replacement}; see docx help for commands.` : "Unknown document command path. Use docx help to discover commands.");
  }
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
      if (!name.endsWith("Json") && !validateDocxValue(fields[name]!.type, options[name])) usage(`Invalid value for --${kebab(name)}. See docx help ${operation.split(".").join(" ")} for accepted values.`);
    }
  }
  budget = lowerLimits(options.limit, budget);
  for (const name of Object.keys(options)) if (name.endsWith("Json")) options[name] = normalizeCliJsonLengths(parseDocxJson(options[name] as string, budget), name);
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
      if (type === "BatchV1") { validateDocxBatch(value, budget, { author: options.author, timestamp: options.timestamp }); return true; }
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
  for (const name of ["tabStops", "tabStopAdd", "borders", "shading", "columnWidths", "rowOptions", "wrapPolygon"]) {
    if (options[name + "Json"] !== undefined) { options[name] = options[name + "Json"]; delete options[name + "Json"]; }
  }
  const sources: DocxArgumentSource[] = [];
  for (const [file, json, semantic, type] of [["contentFile", "contentJson", "content", "OriginalDocumentContentV1"], ["dataFile", "dataJson", "data", "TemplateData"], ["opsFile", "opsJson", "operations", "BatchV1"]]) {
    if (options[file!] !== undefined && options[json!] !== undefined) usage("Conflicting JSON sources.");
    if (options[json!] !== undefined) {
      if (type === "BatchV1") Object.assign(options, validateDocxBatch(options[json!], budget, { author: options.author, timestamp: options.timestamp }));
      else options[semantic!] = options[json!];
      delete options[json!];
    }
    if (options[file!] !== undefined) {
      const source = options[file!]; path(source);
      sources.push({ argument: semantic!, path: source, format: "json", type: type === "BatchV1" ? type : schema.sdkFields[semantic!]!.type });
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

export interface DocxCommandRequest {
  readonly args: readonly Uint8Array[];
  readonly stdin: AsyncIterable<Uint8Array>;
  readonly stdout: { write(bytes: Uint8Array): Promise<void> };
  readonly stderr: { write(bytes: Uint8Array): Promise<void> };
  readonly signal: AbortSignal;
}
export type DocxCommandEngineResult<Result extends { readonly exitCode: number } = { readonly exitCode: number }> = { readonly exitCode: number } & Partial<Omit<Result, "exitCode">>;
export function createDocxCommandEngine<Request extends DocxCommandRequest, Result extends { readonly exitCode: number } = { readonly exitCode: number }>(handler: {
  execute(invocation: DocxInvocation, request: Request): Promise<Result>;
  readSource?(source: DocxArgumentSource, request: Request, budget: DocumentBudget): Promise<Uint8Array>;
}, hostLimits: Partial<DocumentLimits> = {}) {
  return {
    async execute(request: Request): Promise<DocxCommandEngineResult<Result>> {
      if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
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
            throw asPermissionError(error) ?? new SourceError(error);
          }
          const value = parseDocxJson(bytes, budget);
          if (source.type === "BatchV1") Object.assign(options, validateDocxBatch(value, budget, { author: options.author, timestamp: options.timestamp }));
          else options[source.argument] = value;
        }
        if (invocation.operation === "batch" && sources.filter(source => source.path === "-").length + invocation.inputs.filter(input => input === "-").length > 1) usage("Only one stdin consumer is permitted.");
        if (sources.some(source => source.format === "json")) invocation = validateInvocation({ ...invocation, options, sources: sources.filter(source => source.format !== "json") }, budget, true);
      }
      catch (error) {
        if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
        if (!(error instanceof DocxUsageError) && !(error instanceof BoundsError) && !(error instanceof ResourceLimitError) && !(error instanceof SourceError) && !(error instanceof PermissionError)) throw error;
        const context = errorContexts.get(error) ?? { operation: invocation?.operation ?? "help", json: invocation?.options.json === true, budget };
        const code = error instanceof BoundsError ? error.code : error instanceof ResourceLimitError ? "limit-exceeded" : error instanceof PermissionError ? "permission" : error instanceof SourceError ? "source-failure" : "usage";
        const diagnostic = commandDiagnostic(error.message, code, context.budget.limits.diagnosticBytes);
        try {
          if (context.json || context.operation === "schema") await request.stdout.write(new TextEncoder().encode(JSON.stringify({ version: 1, operation: context.operation, ok: false, data: null, warnings: [], errors: [{ code, message: diagnostic.message, ...("operationIndex" in error ? { operationIndex: error.operationIndex } : {}) }], affected: 0, locations: [] }) + "\n"));
          if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
          await request.stderr.write(new TextEncoder().encode(diagnostic.human));
        } catch (transportError) {
          if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
          throw transportError;
        }
        if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
        return { exitCode: context.operation === "diff" ? 2 : error instanceof BoundsError ? 1 : error instanceof ResourceLimitError ? 4 : error instanceof SourceError || error instanceof PermissionError ? 3 : 2 } as DocxCommandEngineResult<Result>;
      }
      if (discoveryOutput) {
        if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
        try { await request.stdout.write(discoveryOutput); }
        catch (error) {
          if (request.signal.aborted) return { exitCode: 130 } as DocxCommandEngineResult<Result>;
          throw error;
        }
        return { exitCode: request.signal.aborted ? 130 : 0 } as DocxCommandEngineResult<Result>;
      }
      return handler.execute(invocation, request);
    }
  };
}

export function commandDiagnostic(source: string, code: string, limit: number): { message: string; human: string } {
  if (code === "stale-selection" && source === "Document operation failed: " + code)
    source += ". Inspect the input again and select a fresh location.";
  if (code === "ambiguous-selection" && source === "Document operation failed: " + code)
    source += ". Inspect the input and choose an unambiguous owner or location.";
  if (code === "conflict" && source === "Document operation failed: " + code)
    source += ". Review the input and destination before retrying. Choose a new output path, or use --in-place only for intentional input replacement.";
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

export { SourceError, validateDocxInvocation, validateDocxBatch, docxInvocationBudgets, type DocxInvocation, type DocxArgumentSource, type DocxBatch, type DocxBatchOperation } from "safe-bash-docx-engine/invocation";
