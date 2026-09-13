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

const creationLength = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: {
    value: { type: "number", exclusiveMinimum: 0 },
    unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
  }
};
export const createSchema = {
  description:
    "Original Transitional macro-free presentation, template or show. Empty slide list by default. Template inputs and Strict creation are explicitly unsupported.",
  input: { type: "null" },
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      width: creationLength,
      height: creationLength,
      kind: { enum: ["pptx", "potx", "ppsx"], default: "pptx" },
      dialect: { enum: ["transitional", "strict"], default: "transitional" },
      template: { type: "string", minLength: 1 },
      author: { type: "string" },
      timestamp: {
        type: "string",
        format: "date-time",
        description: "Explicit UTC date with seconds and Z suffix."
      },
      properties: {
        type: "object",
        additionalProperties: false,
        description: "CLI --properties-json; explicit metadata only.",
        properties: {
          title: { type: "string" },
          subject: { type: "string" },
          author: { type: "string" },
          keywords: { type: "string" },
          comments: { type: "string" },
          lastModifiedBy: { type: "string" },
          revision: { type: "integer", minimum: 0, maximum: 9007199254740991 },
          created: { type: "string", format: "date-time" },
          modified: { type: "string", format: "date-time" },
          lastPrinted: { type: "string", format: "date-time" }
        }
      },
      slides: {
        type: "array",
        description:
          "CLI --slides-json; structured slide and text box coordinates are integer EMUs.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            shapes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "width", "height", "text"],
                properties: {
                  name: { type: "string" },
                  text: { type: "string" },
                  x: { type: "integer", minimum: -27273042316900, maximum: 27273042316900 },
                  y: { type: "integer", minimum: -27273042316900, maximum: 27273042316900 },
                  width: { type: "integer", minimum: 1, maximum: 27273042316900 },
                  height: { type: "integer", minimum: 1, maximum: 27273042316900 }
                }
              }
            }
          }
        }
      },
      json: { type: "boolean", default: false },
      limit: xmlSelection.limit,
      output: { type: "string", minLength: 1 },
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    },
    allOf: [
      {
        anyOf: [
          { required: ["output"] },
          { required: ["dryRun"], properties: { dryRun: { const: true } } }
        ]
      },
      {
        if: { required: ["force"], properties: { force: { const: true } } },
        then: { required: ["output"] }
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
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "create" },
      affected: { type: "integer", minimum: 0, maximum: 1 },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["effects", "outputs", "fingerprint"],
            properties: {
              effects: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["location", "action", "feature"],
                  properties: {
                    location: { $ref: "#/$defs/location" },
                    action: { const: "add" },
                    feature: { const: "F06" }
                  }
                }
              },
              outputs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["path", "sha256", "bytes"],
                  properties: {
                    path: { type: "string" },
                    sha256: { type: "string" },
                    bytes: { type: "integer", minimum: 0, maximum: 9007199254740991 }
                  }
                }
              },
              fingerprint: { type: ["string", "null"] }
            }
          }
        ]
      }
    }
  }
};
