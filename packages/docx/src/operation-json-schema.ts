import { DocxUsageError } from "./argument-json.js";
import { documentLimitDefaults } from "./budget.js";
import { docxEnumSymbols } from "./operation-schema-data.js";
import { docxEnumCanonicalNames, docxCommonOptions, isDocxLiteralUnion, docxOperationSchemas, splitDocxType, type DocxFieldSchema } from "./operation-schema.js";

export interface DocxJsonSchema {
  readonly $schema?: string;
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, DocxJsonSchema>>;
  readonly type?: string;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly DocxJsonSchema[];
  readonly oneOf?: readonly DocxJsonSchema[];
  readonly allOf?: readonly DocxJsonSchema[];
  readonly not?: DocxJsonSchema;
  readonly properties?: Readonly<Record<string, DocxJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | DocxJsonSchema;
  readonly items?: DocxJsonSchema | false;
  readonly prefixItems?: readonly DocxJsonSchema[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly contentEncoding?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly description?: string;
}
const identifier: DocxJsonSchema = { type: "string", minLength: 1, pattern: "^[^\\u0000]+$" };
const number: DocxJsonSchema = { type: "number", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
const integer: DocxJsonSchema = { ...number, type: "integer" };

function fieldsSchema(fields: Readonly<Record<string, DocxFieldSchema>>, definitions: Record<string, DocxJsonSchema>): DocxJsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, valueSchema(field.type, definitions)])),
    required: Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name),
    additionalProperties: false
  };
}
function objectSchema(fields: Record<string, string>, definitions: Record<string, DocxJsonSchema>): DocxJsonSchema {
  return fieldsSchema(Object.fromEntries(Object.entries(fields).map(([name, type]) => [name, { type: type.startsWith("?") ? type.slice(1) : type, required: !type.startsWith("?") }])), definitions);
}
function contentDefinitions(definitions: Record<string, DocxJsonSchema>): void {
  if (definitions.Block) return;
  definitions.Block = {};
  definitions.RunInput = objectSchema({ text: "string", bold: "?boolean | null", italic: "?boolean | null", underline: "?boolean | WD_UNDERLINE | null", style: "?identifier" }, definitions);
  const borders = objectSchema(Object.fromEntries(["top", "left", "bottom", "right", "insideH", "insideV"].map(k => [k, "?Border"])), definitions);
  const shading = objectSchema({ fill: "RGBColor", color: "?RGBColor", pattern: "ShadingPattern" }, definitions);
  const margins = objectSchema(Object.fromEntries(["top", "left", "bottom", "right"].map(k => [k, "?Length"])), definitions);
  definitions.CellInput = { type: "object", properties: { borders, shading, margins, blocks: { type: "array", items: { $ref: "#/$defs/Block" } } }, required: ["blocks"], additionalProperties: false };
  const paragraph = objectSchema({ kind: "identifier", text: "?string", style: "?identifier", level: "?integer 0..9" }, definitions);
  const table = objectSchema({ kind: "identifier", width: "?Length", style: "?identifier", columnWidths: "?ReadonlyArray<Length>", autofit: "?boolean", repeatHeader: "?boolean", headerRows: "?nonnegative integer", allowRowSplit: "?boolean", rowHeight: "?Length", heightRule: "?WD_ROW_HEIGHT_RULE", cellMargin: "?Length", rowOptions: "?ReadonlyArray<{repeatHeader?: boolean; allowRowSplit?: boolean; height?: Length; heightRule?: WD_ROW_HEIGHT_RULE}>" }, definitions);
  definitions.Block = { oneOf: [
    { ...paragraph, properties: { ...paragraph.properties, kind: { const: "paragraph" }, runs: { type: "array", items: { $ref: "#/$defs/RunInput" } } }, allOf: [{ not: { required: ["text", "runs"] } }, { not: { required: ["style", "level"] } }] },
    { ...table, properties: { ...table.properties, borders, shading, kind: { const: "table" }, rows: { type: "array", minItems: 1, items: { type: "array", minItems: 1, items: { $ref: "#/$defs/CellInput" } } } }, required: ["kind", "rows"], description: "Rows have equal cell counts; width, when present, is positive." }
  ] };
}
function receiverSchema(type: string | undefined, definitions: Record<string, DocxJsonSchema>): DocxJsonSchema {
  const direct = objectSchema({ id: "identifier", type: "identifier", owner: "identifier", revision: "nonnegative integer" }, definitions);
  const handle = objectSchema({ resultHandle: "identifier", index: "?nonnegative integer", key: "?identifier" }, definitions);
  return { oneOf: [{ ...direct, properties: { ...direct.properties, ...(type ? { type: { const: type } } : {}) } }, { ...handle, not: { required: ["index", "key"] } }] };
}
function valueSchema(type: string, definitions: Record<string, DocxJsonSchema>): DocxJsonSchema {
  if (type === "nonempty unique list: properties|comments|revisions|links|objects") return { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["properties", "comments", "revisions", "links", "objects"] } };
  const variants = splitDocxType(type);
  if (variants.length > 1) return isDocxLiteralUnion(type) ? { enum: variants } : { anyOf: variants.map(item => valueSchema(item, definitions)) };
  if (["string", "boolean", "null"].includes(type)) return { type };
  if (type === "unknown") return {};
  if (type === "number" || type === "finite number") return number;
  if (type === "finite degrees") return { ...number, minimum: -360, maximum: 360 };
  if (type === "integer" || type === "safe integer") return integer;
  if (type === "nonnegative integer" || type === "nonnegative safe integer") return { ...integer, minimum: 0 };
  if (type === "positive integer") return { ...integer, minimum: 1 };
  if (type === "integer 0..8" || type === "integer 0..9" || type === "integer 0..99") return { ...integer, minimum: 0, maximum: Number(type.slice("integer 0..".length)) };
  if (type === "fraction 0..1") return { ...number, minimum: 0, maximum: 1 };
  if (type === "literal 1") return { const: 1 };
  if (["identifier", "VfsInput", "VfsDestination", "VfsDirectory", "declared binding ID", "PackURI"].includes(type)) return identifier;
  if (type === "UTC date") return { type: "string", format: "date", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
  if (type === "UTC instant" || type === "Date") return { type: "string", format: "date-time", pattern: "Z$", description: type === "Date" ? "The SDK accepts a valid Date; JSON carries its UTC serialization." : "A UTC instant ending in Z." };
  if (type === "typed scalar" || type === "DeclaredBindingValue") return { anyOf: [{ type: "string" }, { type: "boolean" }, number] };
  if (type === "declared understood-namespace profile") return { const: "core-v1" };
  if (type === "closed operation ID") return { enum: Object.keys(docxOperationSchemas) };
  if (type === "Length" || type.startsWith("Length (explicit")) return { type: "object", properties: { value: number, unit: { enum: ["emu", "in", "cm", "mm", "pt", ...(type === "Length" ? ["twip"] : [])] } }, required: ["value", "unit"], additionalProperties: false };
  if (type === "RGBColor" || type === "RGB hex") return { type: "string", pattern: "^[0-9A-Fa-f]{6}$" };
  if (Object.hasOwn(docxEnumSymbols, type)) return { type: "object", properties: { enum: docxEnumCanonicalNames[type] ? { enum: [type, docxEnumCanonicalNames[type]!] } : { const: type }, name: { enum: docxEnumSymbols[type]! } }, required: ["enum", "name"], additionalProperties: false };
  if (type === "BinaryInput") return { oneOf: [
    { type: "object", properties: { kind: { const: "bytes" }, base64: { type: "string", contentEncoding: "base64", pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$" } }, required: ["kind", "base64"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "vfs" }, path: identifier, capability: identifier }, required: ["kind", "path", "capability"], additionalProperties: false }
  ] };
  if (type === "Uint8Array") return { ...valueSchema("BinaryInput", definitions), description: "SDK Uint8Array; JSON binary input uses explicit encoded bytes." };
  if (type === "Input") return { anyOf: [valueSchema("BinaryInput", definitions), valueSchema("VfsPath", definitions)] };
  if (type === "VfsPath") return objectSchema({ path: "identifier", capability: "identifier" }, definitions);
  if (type === "ByteSink") return objectSchema({ capability: "identifier" }, definitions);
  if (type === "DocumentContext") return objectSchema({ vfs: "?identifier", limits: "?LimitOptions", timestamp: "?UTC instant", author: "?string", fonts: "?identifier", template: "?BinaryInput" }, definitions);
  if (type === "LimitOptions") return objectSchema(Object.fromEntries(Object.keys(documentLimitDefaults).map(key => [key, "?nonnegative safe integer"])), definitions);
  if (type === "LimitName") return { enum: Object.keys(documentLimitDefaults) };
  if (type === "logical cell coordinate") return { type: "string", pattern: "^[A-Z]+[1-9][0-9]*$", description: "Both decoded coordinates must fit safe integers." };
  if (type === "LocationToken") return { type: "string", pattern: "^docx-loc-v1\\.[A-Za-z0-9_-]+$", description: "Canonical unpadded base64url UTF-8 location payload with closed fields and document fingerprint." };
  if (type === "OriginalDocumentContentV1") {
    contentDefinitions(definitions);
    const margins = objectSchema(Object.fromEntries(["top", "right", "bottom", "left", "header", "footer", "gutter"].map(key => [key, "?Length"])), definitions);
    const colors = objectSchema(Object.fromEntries(["dark1", "light1", "dark2", "light2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hyperlink", "followedHyperlink"].map(key => [key, "?RGBColor"])), definitions);
    return { type: "object", properties: { version: { const: 1 }, blocks: { type: "array", items: { $ref: "#/$defs/Block" } },
      page: { ...objectSchema({ width: "?Length", height: "?Length", orientation: "?portrait|landscape" }, definitions), properties: { width: valueSchema("Length", definitions), height: valueSchema("Length", definitions), orientation: { enum: ["portrait", "landscape"] }, margins } },
      styles: { type: "array", items: objectSchema({ name: "identifier", type: "paragraph|character|table", font: "?identifier", size: "?Length", bold: "?boolean", italic: "?boolean" }, definitions) },
      theme: { type: "object", properties: { name: identifier, majorFont: identifier, minorFont: identifier, colors }, required: ["name", "majorFont", "minorFont"], additionalProperties: false }
    }, required: ["version", "blocks"], additionalProperties: false };
  }
  if (type === "DeclaredControlRecord" || type === "DeclaredTemplateRecord") return { type: "object", properties: { values: { type: "array", items: objectSchema({ binding: "identifier", value: "DeclaredBindingValue" }, definitions), description: "Binding identifiers must be unique within each record." } }, required: ["values"], additionalProperties: false };
  if (type === "TemplateData") return valueSchema("DeclaredTemplateRecord | ReadonlyArray<DeclaredTemplateRecord>", definitions);
  if (type.startsWith("ReadonlyArray<") && type.endsWith(">")) return { type: "array", items: valueSchema(type.slice(14, -1), definitions) };
  if (type === "bounded range 1..9") return { type: "object", properties: { start: { type: "integer", minimum: 1, maximum: 9 }, end: { type: "integer", minimum: 1, maximum: 9 } }, required: ["start", "end"], additionalProperties: false, description: "start must not exceed end." };
  if (type === "Baseline") return { enum: ["baseline", "superscript", "subscript"] };
  if (type === "ThemeFont") return { enum: ["majorAscii", "majorHAnsi", "majorEastAsia", "majorBidi", "minorAscii", "minorHAnsi", "minorEastAsia", "minorBidi"] };
  if (type === "ShadingPattern") return { enum: ["clear", "solid", "pct5", "pct10", "pct20", "pct25", "pct50", "pct75"] };
  if (type === "Border") return { ...objectSchema({ style: "none|single|double|dotted|dashed", width: "Length", color: "RGBColor", space: "?Length" }, definitions), description: "Width and space are nonnegative lengths." };
  if (type === "ExpandedName") return objectSchema({ namespaceURI: "string", localName: "identifier" }, definitions);
  if (type === "Receiver") return receiverSchema(undefined, definitions);
  if (type === "Iterable<readonly [string, RelationshipView]>") return { type: "array", items: { type: "array", prefixItems: [identifier, receiverSchema("RelationshipView", definitions)], minItems: 2, maxItems: 2, items: false } };
  if (type === "XmlNodeInput") {
    if (!definitions.XmlNodeInput) {
      definitions.XmlNodeInput = {};
      const element = objectSchema({ kind: "identifier", name: "ExpandedName", attributes: "?ReadonlyArray<{name: ExpandedName; value: string}>" }, definitions);
      definitions.XmlNodeInput = { oneOf: [
        { ...element, properties: { ...element.properties, kind: { const: "element" }, children: { type: "array", items: { $ref: "#/$defs/XmlNodeInput" } } } },
        ...["text", "comment"].map(kind => ({ type: "object", properties: { kind: { const: kind }, text: { type: "string" } }, required: ["kind", "text"], additionalProperties: false })),
        { type: "object", properties: { kind: { const: "processingInstruction" }, target: identifier, data: { type: "string" } }, required: ["kind", "target", "data"], additionalProperties: false }
      ], description: "Comments and processing instructions must obey XML lexical restrictions; DTD and entities are forbidden." };
    }
    return { $ref: "#/$defs/XmlNodeInput" };
  }
  if (type.startsWith("{") && type.endsWith("}")) {
    const fields: Record<string, string> = {};
    for (const declaration of type.slice(1, -1).split(";")) {
      if (!declaration.trim()) continue;
      const separator = declaration.indexOf(":");
      const name = declaration.slice(0, separator).trim();
      fields[name.endsWith("?") ? name.slice(0, -1) : name] = `${name.endsWith("?") ? "?" : ""}${declaration.slice(separator + 1).trim()}`;
    }
    return objectSchema(fields, definitions);
  }
  if (type === "BatchV1") return objectSchema({ version: "literal 1", operations: "ReadonlyArray<OperationV1>" }, definitions);
  if (type === "OperationV1") return { oneOf: Object.entries(docxOperationSchemas).filter(([, declaration]) => declaration.batchFields !== undefined).map(([id, declaration]) => {
    const properties: Record<string, DocxJsonSchema> = { operation: { const: id }, arguments: fieldsSchema(declaration.batchFields!, definitions) };
    const required = ["operation", "arguments"];
    if (declaration.receiver) { properties.receiver = receiverSchema(declaration.receiver, definitions); required.push("receiver"); }
    if (declaration.resultHandle?.allowed) properties.resultHandle = identifier;
    return { type: "object", properties, required, additionalProperties: false };
  }) };

  if (Object.values(docxOperationSchemas).some(schema => schema.receiver === type || (schema.resultHandle?.allowed && schema.resultHandle.type === type))) return receiverSchema(type, definitions);
  return { not: {}, description: `No transport value is declared for ${type}.` };
}

export function docxValueSchema(type: string): DocxJsonSchema {
  const definitions: Record<string, DocxJsonSchema> = {};
  const schema = valueSchema(type, definitions);
  return Object.keys(definitions).length ? { ...schema, $defs: definitions } : schema;
}
export function getDocxOperationSchema(id: string, transport: "sdk" | "cli" | "batch" = "sdk"): DocxJsonSchema {
  const declaration = docxOperationSchemas[id];
  if (!declaration) throw new DocxUsageError("Unknown operation schema.");
  const fields = transport === "cli" ? declaration.fields : transport === "batch" ? declaration.batchFields : declaration.sdkFields;
  if (!fields) throw new DocxUsageError("Operation is not available in batch.");
  const definitions: Record<string, DocxJsonSchema> = {};
  const applicable = transport === "batch" ? fields : { ...Object.fromEntries(declaration.commonOptions.map(key => [key, docxCommonOptions[key]!])), ...fields };
  const schema = fieldsSchema(applicable, definitions);
  const conditions: DocxJsonSchema[] = [];
  if (id === "text.replace") conditions.push({ anyOf: [
    { properties: { trackChanges: { const: true } }, required: ["trackChanges", "author", "timestamp"] },
    { properties: { trackChanges: { const: false } }, not: { anyOf: [{ required: ["author"] }, { required: ["timestamp"] }] } },
  ] });
  if (id === "revisions.add") conditions.push({ anyOf: [
    { properties: { kind: { const: "insert" } }, required: ["text"] },
    { properties: { kind: { const: "delete" } }, not: { required: ["text"] } },
  ] });
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...schema, ...(conditions.length ? { allOf: conditions } : {}), ...(Object.keys(definitions).length ? { $defs: definitions } : {}) };
}
