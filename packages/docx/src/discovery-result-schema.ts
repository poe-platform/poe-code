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
  capabilities: result("capabilities", object({ features: { type: "array", items: object({ id: string, level: { const: "read" }, subsets: { type: "array", items: object({ name: string, level: { const: "read" }, reason: string }) }, detected: { type: "null" } }) }, host: object({
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
export const inspectionOperationMetadata: Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>> = Object.fromEntries([
  ["inspect", "Inventory package parts, metadata and document structure without rendering or linked-resource access.", ["F06"], inspectionData],
  ["validate", "Validate document bytes against the partial core-v1 profile without repairs.", ["F49"], validationData]
].map(([id, description, featureIds, data]) => [id, { description, featureIds, result: { oneOf: [object({
  version: { const: 1 }, operation: { const: id }, ok: { const: true }, data: data as DocxJsonSchema,
  warnings: array(diagnostic), errors: empty, affected: { const: 0 }, locations: array(location)
}), object({ version: { const: 1 }, operation: { const: id }, ok: { const: false }, data: { type: "null" }, warnings: array(diagnostic), errors: { type: "array", minItems: 1, items: { type: "object" } }, affected: { const: 0 }, locations: empty })] } }])) as Readonly<Record<string, { description: string; featureIds: readonly string[]; result: DocxJsonSchema }>>;
