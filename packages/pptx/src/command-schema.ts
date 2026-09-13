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

export const slidesAddSchema = {
  description:
    "Insert a slide at a one-based position (default append), explicitly bound to an exact layout name or part URI. Preserve inherited layout defaults; ambiguous placeholder matches fail.",
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["layout"],
    properties: {
      layout: { type: "string", minLength: 1 },
      position: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
        description: "One-based final insertion position; omitted means append."
      },
      name: { type: "string" },
      hidden: { type: "boolean" },
      followMasterBackground: { type: "boolean" },
      title: { type: "string" },
      body: { type: "string" },
      placeholders: {
        type: "array",
        description: "CLI --placeholders-json; exact placeholder type and optional index.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "text"],
          properties: {
            type: { type: "string", minLength: 1 },
            index: { type: "integer", minimum: 0, maximum: 4294967295 },
            text: { type: "string" }
          }
        }
      },
      json: { type: "boolean", default: false },
      limit: xmlSelection.limit,
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    },
    allOf: xmlSetSchema.options.allOf.slice(xmlSelectionRules.length)
  },
  result: {
    ...createSchema.result,
    properties: {
      ...createSchema.result.properties,
      operation: { const: "slides.add" },
      data: {
        oneOf: [
          { type: "null" },
          {
            ...createSchema.result.properties.data.oneOf[1],
            properties: {
              ...createSchema.result.properties.data.oneOf[1]!.properties,
              effects: {
                ...createSchema.result.properties.data.oneOf[1]!.properties!.effects,
                items: {
                  ...createSchema.result.properties.data.oneOf[1]!.properties!.effects.items,
                  properties: {
                    ...createSchema.result.properties.data.oneOf[1]!.properties!.effects.items
                      .properties,
                    feature: { const: "F07" }
                  }
                }
              }
            }
          }
        ]
      }
    }
  }
};

const slideSelectionSchema = {
  ...selectionQuerySchema,
  properties: {
    ...selectionQuerySchema.properties,
    kind: { const: "slide" },
    scope: { const: "slides" },
    part: false
  },
  allOf: [
    {
      anyOf: [
        ...["position", "id", "name", "token"].map((field) => ({ required: [field] })),
        { required: ["all"], properties: { all: { const: true } } }
      ]
    }
  ]
};

function slideMutationSchema(
  operation: "slides.move" | "slides.set" | "slides.remove" | "slides.duplicate"
) {
  return {
    description:
      operation === "slides.duplicate"
        ? "Duplicate selected slide-local content at a required one-based insertion position, with fresh identities and independent mutable resources; unsupported references are rejected."
        : operation === "slides.remove"
          ? "Remove selected slides and proven unreferenced owned parts; retain shared resources. Affected known references require explicit referencePolicy remove; unresolved opaque targets are rejected."
          : "Move selected slides to a final one-based position after removal; preserve slide identity. Set supports labels and visibility; layout and background changes are unavailable.",
    input: inspectSchema.input,
    options: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        selection: {
          oneOf: [
            slideSelectionSchema,
            { type: "array", minItems: 1, items: slideSelectionSchema }
          ],
          description: "CLI --selection-json; ordered selection queries."
        },
        slide: inspectSchema.options.properties.slide,
        select: inspectSchema.options.properties.select,
        scope: { const: "slides" },
        all: { type: "boolean", default: false },
        allowEmpty: { type: "boolean", default: false },
        ...(operation === "slides.remove"
          ? {
              referencePolicy: {
                const: "remove",
                description:
                  "CLI --reference-policy remove; explicitly remove affected known references."
              }
            }
          : {
              position: {
                ...slidesAddSchema.options.properties.position,
                description:
                  operation === "slides.duplicate"
                    ? "One-based insertion position for the copied slides."
                    : "One-based final position after removing the selected slides."
              }
            }),
        ...(operation === "slides.set"
          ? { name: { type: "string" }, hidden: { type: "boolean" } }
          : {}),
        json: { type: "boolean", default: false },
        limit: xmlSelection.limit,
        output: { type: "string", minLength: 1 },
        inPlace: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        dryRun: { type: "boolean", default: false }
      },
      allOf: [
        ...slidesAddSchema.options.allOf,
        {
          anyOf: [
            { required: ["selection"] },
            { required: ["slide"] },
            { required: ["select"] },
            { required: ["all"], properties: { all: { const: true } } }
          ]
        },
        {
          if: { required: ["selection"] },
          then: {
            not: {
              anyOf: ["slide", "select", "scope", "all"].map((field) => ({ required: [field] }))
            }
          }
        },
        ...(operation === "slides.remove"
          ? []
          : [
              {
                anyOf: (operation === "slides.move" || operation === "slides.duplicate"
                  ? ["position"]
                  : ["position", "name", "hidden"]
                ).map((field) => ({ required: [field] }))
              }
            ]),
        {
          if: { required: ["select"] },
          then: {
            not: { anyOf: ["slide", "scope", "all"].map((field) => ({ required: [field] })) }
          }
        }
      ]
    },
    result: {
      ...slidesAddSchema.result,
      properties: {
        ...slidesAddSchema.result.properties,
        operation: { const: operation },
        affected: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        data: {
          oneOf: [
            { type: "null" },
            {
              ...createSchema.result.properties.data.oneOf[1],
              properties: {
                ...createSchema.result.properties.data.oneOf[1]!.properties,
                effects: {
                  type: "array",
                  items: {
                    ...createSchema.result.properties.data.oneOf[1]!.properties!.effects.items,
                    properties: {
                      ...createSchema.result.properties.data.oneOf[1]!.properties!.effects.items
                        .properties,
                      action: {
                        const:
                          operation === "slides.duplicate"
                            ? "add"
                            : operation === "slides.remove"
                              ? "remove"
                              : "update"
                      },
                      feature: { const: "F07" }
                    }
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
}
export const slidesMoveSchema = slideMutationSchema("slides.move");
export const slidesSetSchema = slideMutationSchema("slides.set");
export const slidesRemoveSchema = slideMutationSchema("slides.remove");

export const slidesDuplicateSchema = slideMutationSchema("slides.duplicate");
