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

const xmlSelection = {
  limit: {
    type: "object",
    additionalProperties: false,
    properties: {
      maxBytes: { type: "integer", minimum: 1 },
      maxNodes: { type: "integer", minimum: 1 },
      maxDepth: { type: "integer", minimum: 1 },
      maxOutputBytes: { type: "integer", minimum: 512 }
    },
    description:
      "CLI repeats --limit NAME=VALUE for distinct names; all values must lower explicit trusted ceilings."
  },
  part: { type: "string", minLength: 1 },
  select: { type: "string", minLength: 1 },
  scope: selectionQuerySchema.properties.scope,
  json: { type: "boolean", default: false }
} as const;
const xmlSelectionRules = [
  { oneOf: [{ required: ["part"] }, { required: ["select"] }] },
  { if: { required: ["select"] }, then: { not: { required: ["scope"] } } }
];
function xmlResult(operation: string, mutation: boolean) {
  return {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: operation },
      affected: mutation ? { type: "integer", minimum: 0, maximum: 1 } : { const: 0 },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: mutation ? ["part", "dryRun"] : ["part", "format", "xml"],
            properties: mutation
              ? { part: { type: "string" }, dryRun: { type: "boolean" } }
              : {
                  part: { type: "string" },
                  format: { enum: ["original", "pretty"] },
                  xml: { type: "string" }
                }
          }
        ]
      }
    }
  };
}
export const xmlGetSchema = {
  description:
    "Original XML bytes or explicitly labeled pretty text. Existing manifest and relationship metadata requires an exact part URI and explicit shared scope; metadata locations do not introduce selector tokens.",
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { ...xmlSelection, pretty: { type: "boolean", default: false } },
    allOf: xmlSelectionRules
  },
  result: xmlResult("xml.get", false)
};
export const xmlSetSchema = {
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["file"],
    properties: {
      ...xmlSelection,
      file: { type: "string", minLength: 1 },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    },
    allOf: [
      ...xmlSelectionRules,
      {
        if: { required: ["inPlace"], properties: { inPlace: { const: true } } },
        then: { not: { required: ["output"] } }
      },
      {
        if: { required: ["force"], properties: { force: { const: true } } },
        then: { required: ["output"] }
      },
      {
        anyOf: [
          { required: ["output"] },
          { required: ["inPlace"], properties: { inPlace: { const: true } } },
          { required: ["dryRun"], properties: { dryRun: { const: true } } }
        ]
      },
      {
        if: {
          required: ["output", "json"],
          properties: { output: { const: "-" }, json: { const: true } }
        },
        then: { required: ["dryRun"], properties: { dryRun: { const: true } } }
      }
    ]
  },
  result: xmlResult("xml.set", true)
};
