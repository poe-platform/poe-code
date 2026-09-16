import { isXmlLocalName } from "./compatibility.js";
import { isEnumMember } from "./formatting-values.js";
import { documentLimitDefaults } from "./budget.js";
import { decodeLocation } from "./location-token.js";
import { DocxUsageError, validateOriginalDocumentContent, validateTemplateData } from "./argument-json.js";
import { docxCommonFields, docxEnumSymbols, operationDeclarations, type DocxDeclaredOperationId } from "./operation-schema-data.js";
import type { DocxJsonSchema } from "./operation-json-schema.js";

export interface DocxFieldSchema {
  readonly type: string;
  readonly wireType?: string;
  readonly required: boolean;
}
export interface DocxOperationSchema {
  readonly featureIds: readonly string[];
  readonly discovery?: {
    readonly description: string;
    readonly featureIds: readonly string[];
    readonly result: DocxJsonSchema;
  };
  readonly profile: string;
  readonly fields: Readonly<Record<string, DocxFieldSchema>>;
  readonly sdkFields: Readonly<Record<string, DocxFieldSchema>>;
  readonly batchFields?: Readonly<Record<string, DocxFieldSchema>>;
  readonly commonOptions: readonly string[];
  readonly inputArity: 0 | 1 | 2 | "0|1";
  readonly transport: "direct" | "direct-and-batch" | "typed-batch";
  readonly receiver?: string | null;
  readonly resultHandle?: { readonly allowed: boolean; readonly type: string; readonly requiredSelection?: string };
  readonly valueType: string;
  readonly mutates: boolean;
}
function freezeDeclaration(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === "object") freezeDeclaration(child);
  Object.freeze(value);
}
Object.setPrototypeOf(operationDeclarations, null);
freezeDeclaration(operationDeclarations);
freezeDeclaration(docxCommonFields);
freezeDeclaration(docxEnumSymbols);
export const docxOperationSchemas = operationDeclarations;
export const docxCommonOptions = docxCommonFields;
export const docxEnumCanonicalNames: Readonly<Record<string, string>> = Object.freeze({ MSO_THEME_COLOR_INDEX: "MSO_THEME_COLOR", WD_ALIGN_PARAGRAPH: "WD_PARAGRAPH_ALIGNMENT", WD_ALIGN_VERTICAL: "WD_CELL_VERTICAL_ALIGNMENT", WD_BREAK: "WD_BREAK_TYPE", WD_SECTION: "WD_SECTION_START" });

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function text(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (const scalar of value) {
    const point = scalar.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}
function nonempty(value: unknown): value is string { return text(value) && value.length > 0 && !value.includes("\0"); }
function safeGraph(value: unknown, visiting = new Set<object>()): boolean {
  if (typeof value === "string") return text(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (value === undefined || value === null || typeof value === "boolean") return true;
  if (typeof value !== "object" || visiting.has(value)) return false;
  if (isEnumMember(value)) return true;
  if (value instanceof Uint8Array) return ArrayBuffer.isView(value);
  if (value instanceof Date) return Object.getPrototypeOf(value) === Date.prototype && Reflect.ownKeys(value).length === 0 && Number.isFinite(Date.prototype.getTime.call(value));
  if (!Array.isArray(value) && !object(value)) return false;
  if (Array.isArray(value) && (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length)) return false;
  visiting.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return false;
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !safeGraph(descriptor.value, visiting)) return false;
  }
  visiting.delete(value);
  return true;
}
function closed(value: unknown, fields: Record<string, string>): value is ObjectValue {
  if (!object(value) || Object.keys(value).some(key => !Object.hasOwn(fields, key))) return false;
  return Object.entries(fields).every(([key, type]) => {
    const optional = type.startsWith("?");
    return value[key] === undefined ? optional : valid(optional ? type.slice(1) : type, value[key]);
  });
}
function scalar(value: unknown): boolean {
  return text(value) || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
function date(value: unknown, instant: boolean): boolean {
  if (!text(value)) return false;
  const day = value.slice(0, 10);
  if (day.length !== 10 || day[4] !== "-" || day[7] !== "-" || [...day].some((c, i) => i !== 4 && i !== 7 && (c < "0" || c > "9"))) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  if (!instant) return value === day;
  if (value[10] !== "T" || !value.endsWith("Z") || value[13] !== ":" || value[16] !== ":") return false;
  const tail = value.slice(19, -1);
  if (tail && (tail[0] !== "." || tail.length < 2 || [...tail.slice(1)].some(c => c < "0" || c > "9"))) return false;
  const hour = value.slice(11, 13), minute = value.slice(14, 16), second = value.slice(17, 19);
  return [hour, minute, second].every(v => v.length === 2 && [...v].every(c => c >= "0" && c <= "9")) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
}
function base64(value: unknown): boolean {
  if (!text(value) || value.length % 4 !== 0) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const content = value.slice(0, value.length - padding);
  if ([...content].some(c => !alphabet.includes(c))) return false;
  const last = alphabet.indexOf(content.at(-1) ?? "A");
  return padding === 0 || (padding === 1 ? last % 4 === 0 : last % 16 === 0);
}
function receiver(value: unknown, type?: string): boolean {
  if (!object(value)) return false;
  if (Object.hasOwn(value, "resultHandle")) return closed(value, { resultHandle: "identifier", index: "?nonnegative integer", key: "?identifier" }) && !(value.index !== undefined && value.key !== undefined);
  return closed(value, { id: "identifier", type: "identifier", owner: "identifier", revision: "nonnegative integer" }) && (type === undefined || value.type === type);
}
export function splitDocxType(type: string): string[] {
  const result: string[] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < type.length; i++) {
    if ("{<[(".includes(type[i]!)) depth++;
    else if ("}>])".includes(type[i]!)) depth--;
    else if (type[i] === "|" && depth === 0) { result.push(type.slice(start, i).trim()); start = i + 1; }
  }
  result.push(type.slice(start).trim());
  return result;
}
const modelTypes = new Set<string>();
for (const schema of Object.values(operationDeclarations)) {
  if (schema.receiver) modelTypes.add(schema.receiver);
  if (schema.resultHandle?.allowed) modelTypes.add(schema.resultHandle.type);
}
export function isDocxLiteralUnion(type: string): boolean {
  const variants = splitDocxType(type);
  return variants.length > 1 && !type.includes(" | ") && variants.every(item => !item.includes(" ") && item !== "null" && !Object.hasOwn(docxEnumSymbols, item) && (!modelTypes.has(item) || ["string", "boolean", "integer", "number"].includes(item)));
}

function valid(type: string, value: unknown): boolean {
  if (["ImageLayoutOffset", "ImageLayoutExtent", "ImageLayoutDistance"].includes(type)) return valid("Length (explicit emu/in/cm/mm/pt)", value) && (type !== "ImageLayoutDistance" || object(value) && typeof value.value === "number" && value.value >= 0);
  if (type === "unsigned 32-bit integer") return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295;
  if (type === "native polygon coordinate") return typeof value === "number" && Number.isInteger(value) && value >= -27273042329600 && value <= 27273042316900;
  if (type === "ImageWrapPoint") return closed(value, { x: "native polygon coordinate", y: "native polygon coordinate" });
  if (type === "ImageWrapPolygon") return object(value) && closed(value, { start: "ImageWrapPoint", lineTo: "ReadonlyArray<ImageWrapPoint>" }) && Array.isArray(value.lineTo) && value.lineTo.length >= 2;
  if (type === "nonempty unique list: properties|comments|revisions|links|objects") return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(item => ["properties", "comments", "revisions", "links", "objects"].includes(String(item)));
  const variants = splitDocxType(type);
  if (variants.length > 1) return isDocxLiteralUnion(type) ? variants.includes(String(value)) && typeof value === "string" : variants.some(item => valid(item, value));
  if (type === "unknown") return true;
  if (type === "logical cell coordinate") {
    if (!nonempty(value)) return false;
    let separator = 0, column = 0;
    while (separator < value.length && value[separator]! >= "A" && value[separator]! <= "Z") {
      column = column * 26 + value.charCodeAt(separator++) - 64;
      if (!Number.isSafeInteger(column)) return false;
    }
    const row = value.slice(separator);
    return separator > 0 && row.length > 0 && row[0] !== "0" && [...row].every(c => c >= "0" && c <= "9") && Number.isSafeInteger(Number(row));
  }
  if (type === "LocationToken") {
    if (!text(value)) return false;
    try { decodeLocation(value); return true; } catch { return false; }
  }
  if (type === "LimitName") return typeof value === "string" && Object.hasOwn(documentLimitDefaults, value);
  if (type === "LimitOptions") return object(value) && Object.entries(value).every(([key, item]) => Object.hasOwn(documentLimitDefaults, key) && valid("nonnegative safe integer", item));
  if (type === "DocumentContext") return closed(value, { vfs: "?identifier", limits: "?LimitOptions", timestamp: "?UTC instant", author: "?string", fonts: "?identifier", template: "?BinaryInput" });
  if (type === "VfsPath") return closed(value, { path: "identifier", capability: "identifier" });
  if (type === "ByteSink") return closed(value, { capability: "identifier" });
  if (type === "Iterable<readonly [string, RelationshipView]>") return Array.isArray(value) && value.every(entry => Array.isArray(entry) && entry.length === 2 && nonempty(entry[0]) && valid("RelationshipView", entry[1]));
  if (type === "XmlNodeInput") {
    if (!object(value)) return false;
    if (value.kind === "text" || value.kind === "comment") return closed(value, { kind: "identifier", text: "string" }) && (value.kind !== "comment" || !(value.text as string).includes("--"));
    if (value.kind === "processingInstruction") return closed(value, { kind: "identifier", target: "identifier", data: "string" }) && (value.target as string).toLowerCase() !== "xml" && !(value.data as string).includes("?>");
    return value.kind === "element" && closed(value, { kind: "identifier", name: "ExpandedName", attributes: "?ReadonlyArray<{name: ExpandedName; value: string}>", children: "?ReadonlyArray<XmlNodeInput>" });
  }
  if (type === "null") return value === null;
  if (type === "string") return text(value);
  if (["identifier", "VfsInput", "VfsDestination", "VfsDirectory", "declared binding ID", "PackURI"].includes(type)) return nonempty(value);
  if (type === "boolean") return typeof value === "boolean";
  if (["number", "finite number", "finite degrees"].includes(type)) return typeof value === "number" && Number.isFinite(value) && (type !== "finite degrees" || Math.abs(value) <= 360);
  if (["integer", "safe integer", "nonnegative integer", "nonnegative safe integer", "positive integer", "integer 0..8", "integer 0..9", "integer 0..99"].includes(type)) {
    return typeof value === "number" && Number.isSafeInteger(value) && (!type.startsWith("nonnegative") || value >= 0) && (type !== "positive integer" || value > 0) && (!type.startsWith("integer 0..") || (value >= 0 && value <= Number(type.slice("integer 0..".length))));
  }
  if (type === "fraction 0..1") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (type === "literal 1") return value === 1;
  if (type === "Date") return (value instanceof Date && Number.isFinite(value.getTime())) || date(value, true);
  if (type === "UTC date" || type === "UTC instant") return date(value, type === "UTC instant");
  if (type === "typed scalar" || type === "DeclaredBindingValue") return scalar(value);
  if (type === "declared understood-namespace profile") return value === "core-v1";
  if (type === "closed operation ID") return typeof value === "string" && Object.hasOwn(operationDeclarations, value);
  if (type === "Length" || type.startsWith("Length (explicit")) return closed(value, { value: "number", unit: "identifier" }) && ["emu", "in", "cm", "mm", "pt", ...(type === "Length" ? ["twip"] : [])].includes(String(value.unit));
  if (type === "Baseline") return typeof value === "string" && ["baseline", "superscript", "subscript"].includes(value);
  if (type === "RGBColor" || type === "RGB hex") return text(value) && value.length === 6 && [...value].every(c => "0123456789abcdefABCDEF".includes(c));
  if (Object.hasOwn(docxEnumSymbols, type)) return closed(value, { enum: "identifier", name: "identifier" }) && (value.enum === type || value.enum === docxEnumCanonicalNames[type]) && docxEnumSymbols[type]!.includes(String(value.name));
  if (type === "BinaryInput") return object(value) && (value.kind === "bytes" ? closed(value, { kind: "identifier", base64: "string" }) && base64(value.base64) : value.kind === "vfs" && closed(value, { kind: "identifier", path: "identifier", capability: "identifier" }));
  if (type === "OwnedBinaryInput") return value instanceof Uint8Array || object(value) && value.kind === "bytes" && valid("BinaryInput", value);
  if (type === "Uint8Array") return value instanceof Uint8Array || valid("BinaryInput", value);
  if (type === "Input") return value instanceof Uint8Array || valid("BinaryInput", value) || valid("VfsPath", value);
  if (type === "Receiver") return receiver(value);
  if (type === "OriginalDocumentContentV1") return validateOriginalDocumentContent(value);
  if (type === "DeclaredControlRecord" || type === "DeclaredTemplateRecord") return object(value) && validateTemplateData(value, type === "DeclaredTemplateRecord");
  if (type === "TemplateData") return validateTemplateData(value, true);
  if (type.startsWith("ReadonlyArray<") && type.endsWith(">")) return Array.isArray(value) && value.every(item => valid(type.slice(14, -1), item));
  if (type === "bounded range 1..9") return closed(value, { start: "positive integer", end: "positive integer" }) && Number(value.start) <= Number(value.end) && Number(value.end) <= 9;
  if (type === "ThemeFont") return typeof value === "string" && ["majorAscii", "majorHAnsi", "majorEastAsia", "majorBidi", "minorAscii", "minorHAnsi", "minorEastAsia", "minorBidi"].includes(value);
  if (type === "ShadingPattern") return typeof value === "string" && ["clear", "solid", "pct5", "pct10", "pct20", "pct25", "pct50", "pct75"].includes(value);
  if (type === "Border") return closed(value, { style: "none|single|double|dotted|dashed", width: "Length", color: "RGBColor", space: "?Length" }) && Number((value.width as ObjectValue).value) >= 0 && (value.space === undefined || Number((value.space as ObjectValue).value) >= 0);
  if (type.startsWith("{") && type.endsWith("}")) {
    const fields: Record<string, string> = {};
    for (const declaration of type.slice(1, -1).split(";")) {
      if (!declaration.trim()) continue;
      const separator = declaration.indexOf(":");
      if (separator < 0) return false;
      const name = declaration.slice(0, separator).trim();
      fields[name.endsWith("?") ? name.slice(0, -1) : name] = `${name.endsWith("?") ? "?" : ""}${declaration.slice(separator + 1).trim()}`;
    }
    return closed(value, fields);
  }
  if (type === "ExpandedName") return closed(value, { namespaceURI: "string", localName: "identifier" }) && isXmlLocalName(value.localName as string);
  if (modelTypes.has(type)) return receiver(value, type);
  return false;
}

export function validateDocxValue(type: string, value: unknown): boolean {
  return safeGraph(value) && valid(type, value);
}
export function assertDocxFields(
  fields: Readonly<Record<string, DocxFieldSchema>>,
  value: unknown,
  customValidate?: (type: string, value: unknown) => boolean | undefined
): asserts value is Record<string, unknown> {
  if (!object(value) || !safeGraph(value)) throw new DocxUsageError("Arguments must be a closed, acyclic object of valid values.");
  for (const key of Object.keys(value)) if (!Object.hasOwn(fields, key)) throw new DocxUsageError(`Unknown argument: ${key}.`);
  for (const [key, field] of Object.entries(fields)) {
    if (value[key] === undefined) {
      if (field.required) throw new DocxUsageError(`Missing required argument: ${key}.`);
      continue;
    }
    const type = field.wireType ?? field.type;
    if (!(customValidate?.(type, value[key]) ?? valid(type, value[key]))) throw new DocxUsageError(`Invalid ${key}; expected ${field.type}.`);
  }
}

export type DocxOperationId = DocxDeclaredOperationId;
