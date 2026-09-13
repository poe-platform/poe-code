import { selectionQuerySchema } from "./selector-schema.js";
import { inventorySchema, inventoryPartSchema } from "./inventory-schema.js";

export const inspectSchema = {
  input: { type: "string", minLength: 1, description: "Explicit VFS path, or - for stdin." },
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      json: { type: "boolean", default: false },
      slide: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
        description: "One-based slide-list position."
      },
      shape: {
        type: "string",
        minLength: 1,
        description: "Exact case-sensitive name, including numeric strings."
      },
      part: { type: "string", minLength: 1 },
      select: { type: "string", minLength: 1 },
      scope: selectionQuerySchema.properties.scope,
      all: { type: "boolean", default: false }
    },
    allOf: [
      {
        if: { required: ["select"] },
        then: {
          not: {
            anyOf: ["slide", "shape", "part", "scope", "all"].map((key) => ({ required: [key] }))
          }
        }
      },
      { not: { required: ["slide", "part"] } },
      {
        if: { required: ["shape"] },
        then: { oneOf: [{ required: ["slide"] }, { required: ["part"] }] }
      },
      { if: { required: ["slide"] }, then: { properties: { scope: { const: "slides" } } } }
    ]
  },
  selectionQuery: selectionQuerySchema,
  result: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["version", "operation", "ok", "data", "warnings", "errors", "affected", "locations"],
    properties: {
      version: { const: 1 },
      operation: { const: "inspect" },
      ok: { type: "boolean" },
      affected: { const: 0 },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["fingerprint", "records", "inventory"],
            properties: {
              fingerprint: { type: "string" },
              records: { type: "array", items: { $ref: "#/$defs/record" } },
              inventory: inventorySchema
            }
          }
        ]
      },
      warnings: { type: "array", items: { $ref: "#/$defs/diagnostic" } },
      errors: { type: "array", items: { $ref: "#/$defs/diagnostic" } },
      locations: { type: "array", items: { $ref: "#/$defs/location" } }
    },
    allOf: [
      {
        if: { properties: { ok: { const: true } } },
        then: { properties: { data: { type: "object" }, errors: { maxItems: 0 } } },
        else: {
          properties: {
            data: { type: "null" },
            errors: { minItems: 1 },
            locations: { maxItems: 0 }
          }
        }
      }
    ],
    $defs: {
      inventoryPart: inventoryPartSchema,
      location: {
        type: "object",
        additionalProperties: false,
        required: ["fingerprint", "scope", "owner", "objectId", "coordinateSystem"],
        properties: {
          fingerprint: { type: "string" },
          scope: selectionQuerySchema.properties.scope,
          owner: { type: "string" },
          objectId: { type: "string" },
          coordinateSystem: { const: "identity" }
        }
      },
      record: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "id", "name", "part", "scope", "position", "location", "token"],
        properties: {
          kind: selectionQuerySchema.properties.kind,
          id: { type: "string" },
          name: { type: "string" },
          part: { type: "string" },
          scope: selectionQuerySchema.properties.scope,
          position: { type: "integer", minimum: 1 },
          objectType: { type: "string" },
          location: { $ref: "#/$defs/location" },
          token: { type: "string" }
        }
      },
      diagnostic: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "context"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          context: {
            type: "object",
            additionalProperties: false,
            required: ["phase"],
            properties: {
              phase: { type: "string" },
              candidates: { type: "array", items: { $ref: "#/$defs/location" } }
            }
          }
        }
      }
    }
  }
} as const;
