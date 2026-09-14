import type { DocxJsonSchema } from "./operation-json-schema.js";

const string: DocxJsonSchema = { type: "string" };
const strings: DocxJsonSchema = { type: "array", items: string };
const empty: DocxJsonSchema = { type: "array", maxItems: 0 };
function object(properties: Readonly<Record<string, DocxJsonSchema>>): DocxJsonSchema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
function result(operation: string, data: DocxJsonSchema): DocxJsonSchema {
  return { oneOf: [object({ version: { const: 1 }, operation: { const: operation }, ok: { const: true }, data,
    warnings: empty, errors: empty, affected: { const: 0 }, locations: empty }), discoveryFailureSchema(operation)] };
}

export function discoveryFailureSchema(operation: string): DocxJsonSchema {
  return object({ version: { const: 1 }, operation: { const: operation }, ok: { const: false }, data: { type: "null" },
    warnings: empty, errors: { type: "array", minItems: 1, items: object({
      code: { enum: ["usage", "limit-exceeded", "source-failure", "sink-failure", "cancelled"] }, message: string
    }) }, affected: { const: 0 }, locations: empty });
}

export const discoveryResultSchemas = {
  help: result("help", object({ name: { const: "docx" }, paths: { type: "array", items: object({
    path: strings, usage: string, description: string, operationIds: strings
  }) } })),
  schema: result("schema", object({ schemaVersion: { const: 1 }, validationProfiles: { type: "array", items: { type: "object" } }, operations: { type: "array", items: object({
    id: string, path: strings, input: { type: "object" }, result: { type: "object" }, featureIds: strings,
    support: { enum: ["edit", "read", "preserve", "reject"] }
  }) } })),
  capabilities: result("capabilities", object({ features: { type: "array", items: object({ id: string, level: { enum: ["read", "edit"] }, subsets: { type: "array", items: object({ name: string, level: { enum: ["read", "edit"] }, reason: string }) }, detected: { type: "null" } }) }, host: object({
    read: { const: false }, atomicReplace: { const: false }, transactions: { const: false }, binaryStdout: { const: true }
  }), validationProfiles: { type: "array", items: { type: "object" } }, limits: { type: "array", items: object({ name: string, ceiling: { type: "integer", minimum: 0 } }) } })),
  version: result("version", object({ name: { const: "docx" }, version: string, schemaVersion: { const: 1 } }))
};

const number: DocxJsonSchema = { type: "integer", minimum: 0 };
const nullableString: DocxJsonSchema = { oneOf: [string, { type: "null" }] };
const boolean: DocxJsonSchema = { type: "boolean" };
const nullableBoolean: DocxJsonSchema = { oneOf: [boolean, { type: "null" }] };
const array = (items: DocxJsonSchema): DocxJsonSchema => ({ type: "array", items });
const diagnostic = object({ code: string, message: string });
const part = object({ name: string, contentType: string, bytes: number, sha256: string });
const reference = object({ owner: string, id: string, type: string, target: string, external: boolean });
const location: DocxJsonSchema = object({ kind: string, token: string, value: { type: "object" }, positions: { type: "object" } });
const property = object({ name: string, type: { enum: ["string", "boolean", "integer", "number", "date"] }, value: { oneOf: [string, boolean, { type: "number" }, { type: "null" }] }, writable: boolean, cached: boolean, part: string, group: { enum: ["core", "extended", "custom"] } });
const inspectionData = object({
  kind: { enum: ["docx", "dotx"] }, dialect: { enum: ["strict", "transitional"] }, parts: array(part), relationships: array(reference),
  contentTypes: object({ defaults: array(object({ extension: string, contentType: string })), overrides: array(object({ name: string, contentType: string })) }),
  stories: array(object({ kind: string, location, properties: array(property), references: array(reference), support: { const: "read" } })), properties: array(property),
  features: array(object({ id: string, level: { enum: ["read", "preserve"] }, subsets: array(object({ name: string, level: { enum: ["read", "preserve"] }, reason: string })), detected: boolean })),
  counts: object({ ...Object.fromEntries(["paragraphs", "runs", "tables", "rows", "cells", "images", "sections", "comments", "footnotes", "endnotes", "fields", "controls", "equations"].map(name => [name, number])), cachedPages: { oneOf: [number, { type: "null" }] } }),
  sizes: object({ archiveBytes: number, expandedBytes: number, mediaBytes: number }),
  signed: boolean, protected: boolean, pages: object({ rendered: { type: "null" }, cachedBreaks: number }),
  fonts: object({ references: strings, themeReferences: strings, embedded: strings, installed: { type: "null" } }), signatures: object({ parts: strings, verified: { type: "null" } }), media: array(part),
  annotations: array(object({ part: string, kind: string, id: nullableString, author: nullableString, date: nullableString })),
  protection: array(object({ part: string, kind: string, enforced: nullableBoolean, edit: nullableString })), warnings: array(diagnostic)
});
const validationData = object({ valid: boolean, profile: { const: "core-v1" }, checks: array(object({ id: string, status: { enum: ["passed", "failed", "unvalidated"] } })), diagnostics: array(object({ code: string, part: string, location: string, message: string })), warnings: strings });
const xmlData = object({ part: string, encoding: { enum: ["base64", "utf-8"] }, content: string, pretty: boolean, bytes: number, sha256: string });
const mutationData = object({ changed: boolean, changes: array(object({ kind: { const: "replace" }, before: location, after: location })),
  output: { oneOf: [object({ path: nullableString, bytes: number, sha256: string }), { type: "null" }] }, dryRun: boolean });
const runFormatData = object({ ...mutationData.properties, changes: array(object({ kind: { const: "format" }, before: location, after: location })) });
const paragraphEditData = object({ ...mutationData.properties, changes: array(object({ kind: { enum: ["format", "replace", "insert"] }, before: location, after: location })) });
const textData = object({ text: string, view: { enum: ["final", "original", "all"] }, hiddenText: { const: "include" },
  segments: array(object({ text: string, location, revision: { enum: ["insert", "delete", "unchanged"] },
    kind: { enum: ["text", "tab", "line-break", "page-break", "column-break", "paragraph", "cell", "row", "story"] },
    formatting: object({ bold: nullableBoolean, italic: nullableBoolean, rtl: nullableBoolean, hidden: nullableBoolean, style: nullableString,
      language: { type: "object", additionalProperties: true }, fonts: { type: "object", additionalProperties: true },
      paragraph: object({ style: nullableString, bidi: nullableBoolean }) }) })) });
export const inspectionOperationMetadata: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = Object.fromEntries([
  ["paragraphs.set", "Set direct paragraph properties; null resets inheritance. Text replaces run content and formatting while retaining paragraph properties and annotation boundaries. Tabs, borders and shading accept --tab-stops-json, --borders-json and --shading-json. Model batches remain pending.", ["F02", "F04", "F13"], paragraphEditData],
  ["paragraphs.add", "Append a block to a story or cell; a paragraph anchor inserts after, or --before. A collapsed paragraph range splits at its Unicode scalar caret and retains the suffix and section properties. Heading creation remains pending.", ["F02", "F04", "F13"], paragraphEditData],
  ["runs.add", "Append text and an optional --break line|page|column inside a paragraph. A collapsed paragraph range inserts inline without dropping suffix text or formatting.", ["F02", "F04", "F13"], paragraphEditData],
  ["runs.set", "Format selected runs or a fingerprinted run/paragraph scalar range. Omission leaves direct properties unchanged; null removes them. Explicit false/default overrides inheritance. Preserve complex-script and CJK properties. Whole-text assignment and model batches remain pending.", ["F02", "F04", "F09", "F12"], runFormatData],
  ["text.replace", "Replace literal paragraph text across formatting runs; exactly one of --first, --all or --occurrence is required. Field, object, revision and container boundaries stop matches. Inherit the first matched run; --bold/--italic explicitly override those properties.", ["F02", "F04", "F05", "F10"], mutationData],
  ["create", "Create an original DOCX/DOTX or append typed blocks to an admitted template; explicit dialect and content settings.", ["F01", "F02", "F03", "F11"], mutationData],
  ["inspect", "Inventory package parts, metadata and document structure without rendering or linked-resource access.", ["F06"], inspectionData],
  ["validate", "Validate document bytes against the partial core-v1 profile without repairs.", ["F49"], validationData],
  ["text.get", "Extract logical story text with locations, direct formatting and revision views.", ["F08", "F09"], textData],
  ["xml.get", "Read one absolute XML part as raw bytes or bounded display serialization.", ["F04", "F07"], xmlData],
  ["xml.set", "Replace one complete XML part with validated bytes; preserve opaque content and unrelated parts.", ["F04", "F07"], mutationData]
].map(([id, description, featureIds, data]) => [id, { description, featureIds, result: { oneOf: [object({
  version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema,
  warnings: array(diagnostic), errors: empty, affected: ["text.replace", "runs.set", "paragraphs.set", "paragraphs.add", "runs.add"].includes(id as string) ? number : id === "create" ? { const: 1 } : id === "xml.set" ? { type: "integer", minimum: 0, maximum: 1 } : { const: 0 }, locations: array(location)
}), object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: { type: "object" } }, affected: { const: 0 }, locations: empty })] } }])) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;
