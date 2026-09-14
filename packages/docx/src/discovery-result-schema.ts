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
  schema: result("schema", object({ schemaVersion: { const: 1 }, operations: { type: "array", items: object({
    id: string, path: strings, input: { type: "object" }, result: { type: "object" }, featureIds: strings,
    support: { enum: ["edit", "read", "preserve", "reject"] }
  }) } })),
  capabilities: result("capabilities", object({ features: empty, host: object({
    read: { const: false }, atomicReplace: { const: false }, transactions: { const: false }, binaryStdout: { const: true }
  }), limits: { type: "array", items: object({ name: string, ceiling: { type: "integer", minimum: 0 } }) } })),
  version: result("version", object({ name: { const: "docx" }, version: string, schemaVersion: { const: 1 } }))
};
