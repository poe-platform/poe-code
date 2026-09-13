import { drawingSchemaDefinitions } from "./drawing-schema.js";
import { paragraphNumberingSchemes } from "./text-paragraphs.js";
import { MSO_TEXT_UNDERLINE_TYPE } from "./text-runs.js";
import { selectionQuerySchema } from "./selector-schema.js";
import { inventorySchema, inventoryPartSchema } from "./inventory-schema.js";
import { MSO_AUTO_SHAPE_TYPE, shapePresets } from "./shape-presets.js";

const shapeValues = {
  adjustments: {
    type: "array",
    maxItems: 4096,
    items: { type: "number" },
    description: "Complete normalized preset adjustment values in guide order."
  },
  kind: {
    enum: [
      "text-box",
      ...Object.keys(shapePresets),
      ...Object.values(MSO_AUTO_SHAPE_TYPE).filter((value) => typeof value === "number")
    ]
  },
  name: { type: "string" },
  text: { type: "string" },
  title: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  altText: { type: ["string", "null"] },
  locked: { type: ["boolean", "null"] },
  rotation: { type: "number", minimum: -360000, maximum: 360000 },
  flipHorizontal: { type: "boolean" },
  flipVertical: { type: "boolean" },
  fill: { anyOf: [{ enum: ["solid", null] }, { type: "string", pattern: "^[0-9A-Fa-f]{6}$" }] },
  lineColor: {
    anyOf: [{ enum: ["solid", null] }, { type: "string", pattern: "^[0-9A-Fa-f]{6}$" }]
  },
  ...Object.fromEntries(
    ["left", "top", "width", "height", "lineWidth"].map((key) => [
      key,
      {
        type: key === "lineWidth" ? ["object", "null"] : "object",
        additionalProperties: false,
        required: ["value", "unit"],
        properties: {
          value: {
            type: "number",
            ...(["width", "height"].includes(key)
              ? { exclusiveMinimum: 0 }
              : key === "lineWidth"
                ? { minimum: 0 }
                : {})
          },
          unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
        }
      }
    ])
  )
};
const shapeSchemaDefinitions = Object.fromEntries(
  ["list", "get", "add", "set"].map((action) => [
    "shapes." + action,
    {
      description:
        "Text boxes and documented preset shapes. Lengths use explicit units. Unknown geometry and formatting are preserve-only. Shape IDs are read-only and allocated per drawing tree.",
      input: { type: "string", minLength: 1 },
      options: {
        type: "object",
        additionalProperties: false,
        ...(action === "add" ? { required: ["kind", "left", "top", "width", "height"] } : {}),
        properties: {
          json: { type: "boolean" },
          limit: { type: "object" },
          scope: { enum: ["slides", "layouts", "masters", "shared"] },
          slide: { type: "integer", minimum: 1 },
          part: { type: "string" },
          select: { type: "string" },
          shape: { type: "string" },
          ...(["add", "set"].includes(action)
            ? {
                ...shapeValues,
                output: { type: "string" },
                inPlace: { type: "boolean" },
                force: { type: "boolean" },
                dryRun: { type: "boolean" },
                ...(action === "set"
                  ? { all: { type: "boolean" }, allowEmpty: { type: "boolean" } }
                  : {})
              }
            : {})
        }
      },
      result: {
        type: "object",
        required: [
          "version",
          "operation",
          "ok",
          "data",
          "warnings",
          "errors",
          "affected",
          "locations"
        ],
        properties: {
          version: { const: 1 },
          operation: { const: "shapes." + action },
          ok: { type: "boolean" },
          data: { type: ["object", "null"] },
          warnings: { type: "array" },
          errors: { type: "array" },
          affected: { type: "integer", minimum: 0 },
          locations: { type: "array" }
        }
      }
    }
  ])
);

const pathCoordinate = { type: "integer", minimum: -2147483647, maximum: 2147483647 };
const pathValue = {
  type: "object",
  additionalProperties: false,
  required: ["unit", "width", "height", "commands"],
  properties: {
    unit: { const: "emu" },
    width: { type: "integer", minimum: 1, maximum: 2147483647 },
    height: { type: "integer", minimum: 1, maximum: 2147483647 },
    commands: {
      type: "array",
      minItems: 2,
      maxItems: 4096,
      items: {
        oneOf: Object.entries({
          move: ["x", "y"],
          line: ["x", "y"],
          quadratic: ["cx", "cy", "x", "y"],
          cubic: ["cx1", "cy1", "cx2", "cy2", "x", "y"],
          close: []
        }).map(([type, coordinates]) => ({
          type: "object",
          additionalProperties: false,
          required: ["type", ...coordinates],
          properties: {
            type: { const: type },
            ...Object.fromEntries(coordinates.map((key) => [key, pathCoordinate]))
          }
        }))
      }
    }
  }
};
for (const action of ["add", "set"]) {
  const base = shapeSchemaDefinitions["shapes." + action]!;
  const update = Object.fromEntries(Object.entries(shapeValues).filter(([key]) => key !== "kind"));
  Object.assign(shapeSchemaDefinitions, {
    ["shapes.paths." + action]: {
      ...base,
      description:
        "Bounded local EMU move, line, quadratic and cubic paths with optional closure and retained command order without winding evaluation. Arbitrary formulas and geometry remain preserve-only.",
      options: {
        ...base.options,
        ...(action === "add" ? { required: ["left", "top", "width", "height"] } : {}),
        properties: {
          json: { type: "boolean" },
          limit: { type: "object" },
          scope: { enum: ["slides", "layouts", "masters", "shared"] },
          part: { type: "string" },
          slide: { type: "integer", minimum: 1 },
          shape: { type: "string" },
          select: { type: "string" },
          output: { type: "string" },
          inPlace: { type: "boolean" },
          force: { type: "boolean" },
          dryRun: { type: "boolean" },
          ...(action === "add"
            ? update
            : { all: { type: "boolean" }, allowEmpty: { type: "boolean" } }),
          path: pathValue,
          vertices: {
            type: "array",
            minItems: 2,
            maxItems: 4095,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y"],
              properties: { x: pathCoordinate, y: pathCoordinate }
            }
          },
          close: { type: "boolean" }
        }
      }
    }
  });
}

for (const action of ["list", "get"]) {
  const base = shapeSchemaDefinitions["shapes." + action]!;
  Object.assign(shapeSchemaDefinitions, {
    ["shapes.paths." + action]: {
      ...base,
      description:
        "Inspect original custom geometry XML without formula evaluation. Supported paths include local EMU commands.",
      options: {
        ...base.options,
        properties: {
          json: { type: "boolean" },
          limit: { type: "object" },
          scope: { enum: ["slides", "layouts", "masters", "shared"] },
          part: { type: "string" },
          slide: { type: "integer", minimum: 1 },
          shape: { type: "string" },
          select: { type: "string" }
        }
      }
    }
  });
}

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

const retainedSettingsPart = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["part", "xml"],
  properties: {
    part: { type: "string", minLength: 1 },
    xml: { type: "string", minLength: 1 }
  }
};
const settingsValues = {
  type: "object",
  additionalProperties: false,
  required: [
    "width",
    "height",
    "orientation",
    "notesWidth",
    "notesHeight",
    "notesOrientation",
    "slideNumberStart",
    "loop",
    "showType",
    "printProperties",
    "viewProperties"
  ],
  properties: {
    width: { type: ["integer", "null"], minimum: -9007199254740991, maximum: 9007199254740991 },
    height: { type: ["integer", "null"], minimum: -9007199254740991, maximum: 9007199254740991 },
    notesWidth: {
      type: ["integer", "null"],
      minimum: -9007199254740991,
      maximum: 9007199254740991
    },
    notesHeight: {
      type: ["integer", "null"],
      minimum: -9007199254740991,
      maximum: 9007199254740991
    },
    orientation: { enum: ["portrait", "landscape", null] },
    notesOrientation: { enum: ["portrait", "landscape", null] },
    slideNumberStart: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
    loop: { type: "boolean" },
    showType: { enum: ["speaker", "window", "kiosk"] },
    printProperties: retainedSettingsPart,
    viewProperties: retainedSettingsPart
  }
};
const settingsOptions = {
  width: creationLength,
  height: creationLength,
  notesWidth: {
    ...creationLength,
    properties: { ...creationLength.properties, value: { type: "number", minimum: 0 } }
  },
  notesHeight: {
    ...creationLength,
    properties: { ...creationLength.properties, value: { type: "number", minimum: 0 } }
  },
  orientation: { enum: ["portrait", "landscape"] },
  notesOrientation: { enum: ["portrait", "landscape"] },
  slideNumberStart: settingsValues.properties.slideNumberStart,
  loop: { type: "boolean" },
  showType: settingsValues.properties.showType,
  scaleContent: {
    type: "boolean",
    default: false,
    description:
      "Canvas-only by default. Explicit content scaling rejects unsupported transforms without publishing."
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
          category: { type: "string", maxLength: 255 },
          contentStatus: { type: "string", maxLength: 255 },
          identifier: { type: "string", maxLength: 255 },
          language: { type: "string", maxLength: 255 },
          version: { type: "string", maxLength: 255 },
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

export const settingsSchemas = Object.fromEntries(
  ["list", "get", "set"].map((action) => {
    const mutation = action === "set";
    return [
      `settings.${action}`,
      {
        description:
          "Presentation settings. Dimensions are canvas-only by default; notes dimensions are independent. Print and view properties are inventoried as bounded XML with owning parts. Unrequested grid, view, print and vendor settings are preserved.",
        input: inspectSchema.input,
        options: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {
            json: { type: "boolean", default: false },
            limit: xmlSelection.limit,
            ...(mutation
              ? {
                  ...settingsOptions,
                  output: { type: "string", minLength: 1 },
                  inPlace: { type: "boolean", default: false },
                  force: { type: "boolean", default: false },
                  dryRun: { type: "boolean", default: false }
                }
              : {})
          },
          ...(mutation
            ? {
                allOf: [
                  ...xmlSetSchema.options.allOf.slice(xmlSelectionRules.length),
                  {
                    anyOf: Object.keys(settingsOptions)
                      .filter((key) => key !== "scaleContent")
                      .map((key) => ({ required: [key] }))
                  },
                  {
                    if: {
                      required: ["scaleContent"],
                      properties: { scaleContent: { const: true } }
                    },
                    then: {
                      anyOf: ["width", "height", "orientation"].map((key) => ({ required: [key] }))
                    }
                  }
                ]
              }
            : {})
        },
        result: {
          ...inspectSchema.result,
          properties: {
            ...inspectSchema.result.properties,
            operation: { const: `settings.${action}` },
            affected: mutation ? { type: "integer", minimum: 0, maximum: 1 } : { const: 0 },
            data: {
              oneOf: [
                { type: "null" },
                mutation
                  ? {
                      ...createSchema.result.properties.data.oneOf[1],
                      properties: {
                        ...createSchema.result.properties.data.oneOf[1]!.properties,
                        effects: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["location", "action", "feature"],
                            properties: {
                              location: { $ref: "#/$defs/location" },
                              action: { const: "update" },
                              feature: { const: "F10" }
                            }
                          }
                        }
                      }
                    }
                  : {
                      type: "object",
                      additionalProperties: false,
                      required: ["fingerprint", action === "list" ? "records" : "settings"],
                      properties: {
                        fingerprint: { type: "string" },
                        ...(action === "list"
                          ? {
                              records: {
                                type: "array",
                                minItems: 1,
                                maxItems: 1,
                                items: settingsValues
                              }
                            }
                          : { settings: settingsValues })
                      }
                    }
              ]
            }
          }
        }
      }
    ];
  })
);

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
        ...(operation === "slides.duplicate"
          ? {
              mediaPolicy: {
                enum: ["shared-media", "isolated-instance"],
                default: "shared-media",
                description: "CLI --media-policy; unchanged media sharing or per-copy isolation."
              }
            }
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

export const slidesImportSchema = {
  description:
    "Import ordered slides and supported dependency closure with source appearance by default. Destination theme mapping, conflicting notes masters, tables/global table styles, embedded fonts, unequal presentation text defaults, unknown extension references, mixed dialects and unselected slide links are rejected. Dimension policy destination preserves source coordinates and destination slide size.",
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["source", "sourceSlides"],
    properties: {
      source: inspectSchema.input,
      sourceSlides: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        description: "CLI --source-slides JSON; ordered unique one-based slide positions."
      },
      position: slidesAddSchema.options.properties.position,
      themePolicy: { enum: ["source", "destination"], default: "source" },
      dimensionPolicy: { enum: ["reject", "destination"], default: "reject" },
      json: { type: "boolean", default: false },
      limit: xmlSelection.limit,
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    },
    allOf: slidesAddSchema.options.allOf
  },
  result: {
    ...slidesDuplicateSchema.result,
    properties: {
      ...slidesDuplicateSchema.result.properties,
      operation: { const: "slides.import" },
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
                    feature: { const: "F08" }
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

export const slidesMergeSchema = {
  description:
    "Append ordered sources using import dependency closure. The same ordered sourceSlides selection applies to every source; omitted means all. Explicit source theme is supported; destination theme mapping is rejected.",
  input: inspectSchema.input,
  options: {
    ...slidesImportSchema.options,
    required: ["sources", "themePolicy"],
    properties: {
      sources: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["vfsPath"],
          properties: { vfsPath: inspectSchema.input }
        }
      },
      sourceSlides: slidesImportSchema.options.properties.sourceSlides,
      themePolicy: { enum: ["source", "destination"] },
      dimensionPolicy: slidesImportSchema.options.properties.dimensionPolicy,
      json: { type: "boolean", default: false },
      limit: xmlSelection.limit,
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    }
  },
  result: {
    ...slidesImportSchema.result,
    properties: { ...slidesImportSchema.result.properties, operation: { const: "slides.merge" } }
  }
};

const splitManifest = {
  type: "object",
  additionalProperties: false,
  required: ["outputs", "sources"],
  properties: {
    outputs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "sha256", "bytes"],
        properties: {
          path: { type: "string" },
          sha256: { type: "string" },
          bytes: { type: "integer", minimum: 0 }
        }
      }
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceSlide", "sourceLocation"],
        properties: {
          sourceSlide: { type: "integer", minimum: 1 },
          sourceLocation: { $ref: "#/$defs/location" }
        }
      }
    }
  }
};
export const slidesSplitSchema = {
  description:
    "Emit one independently valid package per selected slide in requested order, named slide-NNNNNN.pptx by emitted order. Navigation outside each output is rejected. Publication requires an atomic adapter transaction or explicit allowPartialOutput; failure then reports only completed outputs.",
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["slides"],
    properties: {
      slides: slidesImportSchema.options.properties.sourceSlides,
      outputDir: { type: "string", minLength: 1, not: { const: "-" } },
      allowPartialOutput: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      limit: xmlSelection.limit,
      force: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false }
    },
    allOf: [
      {
        anyOf: [
          { required: ["outputDir"] },
          { required: ["dryRun"], properties: { dryRun: { const: true } } }
        ]
      },
      {
        if: { required: ["force"], properties: { force: { const: true } } },
        then: { required: ["outputDir"] }
      }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "slides.split" },
      affected: { type: "integer", minimum: 0 },
      data: { oneOf: [{ type: "null" }, splitManifest] }
    },
    allOf: [
      {
        if: { properties: { ok: { const: true } } },
        then: { properties: { data: splitManifest, errors: { maxItems: 0 } } },
        else: { properties: { errors: { minItems: 1 } } }
      }
    ]
  }
};

const membershipRecord = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "position", "slides", "location", "token"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    position: { type: "integer", minimum: 1 },
    slides: { type: "array", items: { type: "integer", minimum: 1 } },
    location: { $ref: "#/$defs/location" },
    token: { type: "string" }
  }
};
export const membershipSchemas = Object.fromEntries(
  ["sections", "shows"].flatMap((kind) =>
    ["list", "get", "add", "set", "remove"].map((action) => {
      const mutation = !["list", "get"].includes(action);
      const data = mutation
        ? {
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
                        action: { enum: ["add", "update", "remove"] },
                        feature: { const: "F09" }
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
                        bytes: { type: "integer", minimum: 0 }
                      }
                    }
                  },
                  fingerprint: { type: ["string", "null"] }
                }
              }
            ]
          }
        : {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["records", "fingerprint"],
                properties: {
                  records: { type: "array", items: membershipRecord },
                  fingerprint: { type: "string" }
                }
              }
            ]
          };
      return [
        `${kind}.${action}`,
        {
          input: inspectSchema.input,
          options: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            ...(action === "add" ? { required: ["name", "slides"] } : {}),
            properties: {
              json: { type: "boolean" },
              limit: xmlSelection.limit,
              select: { type: "string", minLength: 1 },
              scope: { const: "presentation" },
              slide: { type: "integer", minimum: 1 },
              ...(mutation
                ? {
                    output: { type: "string", minLength: 1 },
                    inPlace: { type: "boolean" },
                    force: { type: "boolean" },
                    dryRun: { type: "boolean" },
                    all: { type: "boolean" },
                    allowEmpty: { type: "boolean" }
                  }
                : {}),
              ...(["add", "set"].includes(action)
                ? {
                    name: { type: "string" },
                    slides: {
                      type: "array",
                      minItems: 1,
                      uniqueItems: true,
                      items: { type: "integer", minimum: 1 }
                    },
                    position: { type: "integer", minimum: 1 }
                  }
                : {})
            },
            allOf: [
              {
                if: { required: ["select"] },
                then: {
                  not: { anyOf: ["slide", "scope", "all"].map((key) => ({ required: [key] })) }
                }
              },
              ...(action === "set"
                ? [
                    {
                      anyOf: ["name", "slides", "position"].map((key) => ({ required: [key] }))
                    }
                  ]
                : []),
              ...(mutation
                ? [
                    {
                      anyOf: [
                        { required: ["output"] },
                        { required: ["inPlace"], properties: { inPlace: { const: true } } },
                        { required: ["dryRun"], properties: { dryRun: { const: true } } }
                      ]
                    },
                    {
                      if: { required: ["inPlace"], properties: { inPlace: { const: true } } },
                      then: { not: { required: ["output"] } }
                    },
                    {
                      if: {
                        required: ["output", "json"],
                        properties: { output: { const: "-" }, json: { const: true } }
                      },
                      then: { required: ["dryRun"], properties: { dryRun: { const: true } } }
                    },
                    {
                      if: { required: ["force"], properties: { force: { const: true } } },
                      then: { required: ["output"] }
                    }
                  ]
                : [])
            ]
          },
          result: {
            ...inspectSchema.result,
            properties: {
              ...inspectSchema.result.properties,
              operation: { const: `${kind}.${action}` },
              affected: { type: "integer", minimum: 0 },
              data
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
            ]
          }
        }
      ];
    })
  )
);

const masterRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["part", "name", "layouts", "affectedSlides"],
  properties: {
    part: { type: "string" },
    name: { type: "string" },
    layouts: { type: "array", items: { type: "string" } },
    affectedSlides: { type: "array", uniqueItems: true, items: { type: "integer", minimum: 1 } }
  }
};
const masterShapeValues = {
  name: { type: "string" },
  text: { type: "string" },
  left: {
    ...creationLength,
    properties: { ...creationLength.properties, value: { type: "number" } }
  },
  top: {
    ...creationLength,
    properties: { ...creationLength.properties, value: { type: "number" } }
  },
  width: creationLength,
  height: creationLength
};
const layoutValues = {
  name: { type: "string" },
  master: { type: "string", minLength: 1 },
  text: { type: "string" },
  type: { type: "string", minLength: 1 },
  preserve: { type: "boolean" },
  showMasterShapes: { type: "boolean" },
  matchingName: { type: "string" }
};
const layoutRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "part",
    "id",
    "master",
    "name",
    "type",
    "preserve",
    "showMasterShapes",
    "matchingName",
    "placeholders",
    "affectedSlides"
  ],
  properties: {
    part: { type: "string" },
    id: { type: "string" },
    master: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    preserve: { type: "boolean" },
    showMasterShapes: { type: "boolean" },
    matchingName: { type: "string" },
    placeholders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shapeId", "type", "index", "name", "x", "y", "width", "height", "provenance"],
        properties: {
          shapeId: { type: "string" },
          type: { type: "string" },
          index: { type: "integer", minimum: 0, maximum: 4294967295 },
          name: { type: "string" },
          ...Object.fromEntries(
            ["x", "y", "width", "height"].map((key) => [key, { type: ["integer", "null"] }])
          ),
          provenance: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "width", "height"],
            properties: Object.fromEntries(
              ["x", "y", "width", "height"].map((key) => [
                key,
                { enum: ["layout", "master", null] }
              ])
            )
          }
        }
      }
    },
    affectedSlides: masterRecordSchema.properties.affectedSlides
  }
};
const masterOperationFields: Record<string, Record<string, unknown>> = {
  "masters.list": {},
  "masters.get": {},
  "masters.add": {
    name: { type: "string", minLength: 1 },
    text: { type: "string" },
    theme: { type: "string", minLength: 1 }
  },
  "masters.set": {
    name: { type: "string" },
    text: { type: "string" },
    shape: { type: "string", minLength: 1 }
  },
  "layouts.list": {},
  "layouts.get": {},
  "layouts.remove": {},
  "layouts.set": { ...layoutValues, shape: { type: "string", minLength: 1 } },
  "layouts.add": {
    ...layoutValues,
    name: { type: "string", minLength: 1 },
    placeholders: {
      type: "array",
      description: "CLI --placeholders-json; original layout placeholder declarations.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          index: { type: "integer", minimum: 0, maximum: 4294967295 },
          name: { type: "string" },
          text: { type: "string" },
          x: { type: "integer" },
          y: { type: "integer" },
          width: { type: "integer", minimum: 0 },
          height: { type: "integer", minimum: 0 }
        }
      }
    }
  },
  "layouts.apply": {
    layout: { type: "string", minLength: 1 },
    placeholderPolicy: { enum: ["type-index", "reject-unmatched"] }
  },
  "shapes.add": { ...masterShapeValues, kind: { const: "text-box" } },
  "shapes.set": { ...masterShapeValues, shape: { type: "string", minLength: 1 } },
  "themes.list": {},
  "themes.get": {},
  "themes.set": {
    name: { type: "string" },
    colorSlot: {
      enum: [
        "dk1",
        "lt1",
        "dk2",
        "lt2",
        "accent1",
        "accent2",
        "accent3",
        "accent4",
        "accent5",
        "accent6",
        "hlink",
        "folHlink"
      ]
    },
    color: { type: "string", minLength: 6, maxLength: 6 },
    fontSlot: {
      enum: [
        "majorLatin",
        "minorLatin",
        "majorEastAsia",
        "minorEastAsia",
        "majorComplex",
        "minorComplex"
      ]
    },
    font: { type: "string" }
  },
  "backgrounds.list": {},
  "backgrounds.get": {},
  "backgrounds.set": {
    kind: { enum: ["solid", "gradient", "picture", "inherit", "style-reference"] },
    color: { type: "string", minLength: 6, maxLength: 6 },
    stops: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["position", "color"],
        properties: {
          position: { type: "number", minimum: 0, maximum: 1 },
          color: { type: "string", minLength: 6, maxLength: 6 },
          opacity: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    angle: { type: "number" },
    file: { type: "string", minLength: 1 },
    styleIndex: { type: "integer", minimum: 1 },
    styleColor: { type: "string", minLength: 6, maxLength: 6 }
  }
};

const themeRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["part", "name", "override", "colors", "fonts", "affectedSlides"],
  properties: {
    part: { type: "string" },
    name: { type: "string" },
    override: { type: "boolean" },
    colors: { type: "object", additionalProperties: { type: ["string", "null"] } },
    fonts: { type: "object", additionalProperties: { type: ["string", "null"] } },
    affectedSlides: masterRecordSchema.properties.affectedSlides
  }
};
const backgroundRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "part",
    "kind",
    "color",
    "stops",
    "angle",
    "imagePart",
    "styleIndex",
    "styleColor",
    "affectedSlides"
  ],
  properties: {
    part: { type: "string" },
    kind: { type: "string" },
    color: { type: ["string", "null"] },
    stops: { type: ["array", "null"], items: { type: "object" } },
    angle: { type: ["number", "null"] },
    imagePart: { type: ["string", "null"] },
    styleIndex: { type: ["integer", "null"] },
    styleColor: { type: ["string", "null"] },
    affectedSlides: masterRecordSchema.properties.affectedSlides
  }
};

export const masterSchemas = Object.fromEntries(
  Object.entries(masterOperationFields).map(([operation, fields]) => {
    const mutation = !operation.endsWith(".list") && !operation.endsWith(".get");
    const layout = operation.startsWith("layouts.");
    const applying = operation === "layouts.apply";
    const theme = operation.startsWith("themes.");
    const background = operation.startsWith("backgrounds.");
    const adding = operation.endsWith(".add");
    const required =
      operation === "masters.add"
        ? ["name"]
        : operation === "shapes.add"
          ? ["kind", "left", "top", "width", "height"]
          : operation === "layouts.add"
            ? ["name", "master"]
            : applying
              ? ["layout", "placeholderPolicy"]
              : operation === "backgrounds.set"
                ? ["kind"]
                : [];
    return [
      operation,
      {
        description: theme
          ? "Inspect and edit shared palette and font slots, including overrides; unsupported theme content is preserved."
          : background
            ? "Inspect and edit slide, layout or master fills and style references, preserving effects. Shared scope requires a concrete owner."
            : layout
              ? "Layout properties and master associations; apply requires explicit placeholder policy, retains local content and rejects ambiguous placeholder mappings. Shared layout mutations require layouts/shared scope."
              : "Supported master content only. Mutations require explicit shared or resource scope; dependent slides are reported and local overrides retained. Shape creation supports text boxes; background editing supports solid RGB or reset to inheritance.",
        input: inspectSchema.input,
        options: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          required: [...required, ...(mutation && !applying && !background ? ["scope"] : [])],
          properties: {
            json: { type: "boolean" },
            limit: xmlSelection.limit,
            scope: {
              enum: theme
                ? ["shared"]
                : background
                  ? ["slides", "layouts", "masters", "shared"]
                  : applying
                    ? ["slides"]
                    : layout
                      ? ["layouts", "shared"]
                      : ["masters", "shared"]
            },
            ...(!adding
              ? {
                  ...(!applying ? { part: { type: "string", minLength: 1 } } : {}),
                  select: { type: "string", minLength: 1 },
                  slide: { type: "integer", minimum: 1 }
                }
              : operation === "shapes.add"
                ? {
                    part: { type: "string", minLength: 1 },
                    select: { type: "string", minLength: 1 },
                    slide: { type: "integer", minimum: 1 }
                  }
                : {}),
            ...fields,
            ...(mutation
              ? {
                  output: { type: "string", minLength: 1 },
                  inPlace: { type: "boolean" },
                  force: { type: "boolean" },
                  dryRun: { type: "boolean" },
                  ...(!adding ? { all: { type: "boolean" }, allowEmpty: { type: "boolean" } } : {})
                }
              : {})
          },
          allOf: [
            ...(background
              ? [
                  {
                    if: { required: ["scope"], properties: { scope: { const: "shared" } } },
                    then: { anyOf: [{ required: ["part"] }, { required: ["select"] }] }
                  }
                ]
              : []),
            ...(operation === "backgrounds.set"
              ? [
                  {
                    anyOf: [
                      ...["part", "select", "slide"].map((key) => ({ required: [key] })),
                      { required: ["all"], properties: { all: { const: true } } }
                    ]
                  }
                ]
              : []),
            ...(layout && mutation && !adding
              ? [
                  {
                    anyOf: [
                      ...["select", "slide", ...(!applying ? ["part"] : [])].map((key) => ({
                        required: [key]
                      })),
                      { required: ["all"], properties: { all: { const: true } } }
                    ]
                  }
                ]
              : []),
            ...(applying
              ? [{ if: { required: ["select"] }, then: { not: { required: ["scope"] } } }]
              : []),
            ...(operation === "themes.set"
              ? [
                  { anyOf: ["name", "colorSlot", "fontSlot"].map((key) => ({ required: [key] })) },
                  {
                    dependentRequired: {
                      colorSlot: ["color"],
                      color: ["colorSlot"],
                      fontSlot: ["font"],
                      font: ["fontSlot"]
                    }
                  }
                ]
              : []),
            ...(operation === "backgrounds.set"
              ? [
                  ...Object.entries({
                    solid: ["color"],
                    gradient: ["stops"],
                    picture: ["file"],
                    inherit: [],
                    "style-reference": ["styleIndex", "styleColor"]
                  }).map(([kind, required]) => ({
                    if: { properties: { kind: { const: kind } } },
                    then: {
                      required,
                      not: {
                        anyOf: ["color", "stops", "angle", "file", "styleIndex", "styleColor"]
                          .filter(
                            (key) =>
                              !(required as string[]).includes(key) &&
                              !(kind === "gradient" && key === "angle")
                          )
                          .map((key) => ({ required: [key] }))
                      }
                    }
                  }))
                ]
              : []),
            { not: { required: ["part", "slide"] } },
            {
              if: { required: ["select"] },
              then: {
                not: {
                  anyOf: ["part", "slide", "shape", "all"].map((key) => ({ required: [key] }))
                }
              }
            },
            ...(["masters.set", "layouts.set"].includes(operation)
              ? [
                  {
                    anyOf: (layout ? Object.keys(layoutValues) : ["name", "text"]).map((key) => ({
                      required: [key]
                    }))
                  },
                  {
                    if: { required: ["text"] },
                    then: { anyOf: [{ required: ["shape"] }, { required: ["select"] }] }
                  }
                ]
              : []),
            ...(operation === "shapes.set"
              ? [
                  { anyOf: Object.keys(masterShapeValues).map((key) => ({ required: [key] })) },
                  { anyOf: [{ required: ["shape"] }, { required: ["select"] }] }
                ]
              : []),
            ...(mutation
              ? [
                  {
                    anyOf: [
                      { required: ["output"] },
                      { required: ["inPlace"], properties: { inPlace: { const: true } } },
                      { required: ["dryRun"], properties: { dryRun: { const: true } } }
                    ]
                  },
                  {
                    if: { required: ["inPlace"], properties: { inPlace: { const: true } } },
                    then: { not: { required: ["output"] } }
                  },
                  {
                    if: { required: ["force"], properties: { force: { const: true } } },
                    then: { required: ["output"] }
                  },
                  {
                    if: {
                      required: ["json", "output"],
                      properties: { json: { const: true }, output: { const: "-" } }
                    },
                    then: { required: ["dryRun"], properties: { dryRun: { const: true } } }
                  }
                ]
              : [])
          ]
        },
        result: {
          ...inspectSchema.result,
          properties: {
            ...inspectSchema.result.properties,
            operation: { const: operation },
            affected: mutation ? { type: "integer", minimum: 0 } : { const: 0 },
            data: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: mutation
                    ? ["part", "affectedSlides", "effects", "outputs", "fingerprint"]
                    : ["records", "fingerprint"],
                  properties: mutation
                    ? {
                        part: { type: ["string", "null"] },
                        affectedSlides: masterRecordSchema.properties.affectedSlides,
                        effects: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["location", "action", "feature"],
                            properties: {
                              location: { $ref: "#/$defs/location" },
                              action: { enum: ["add", "set", "remove", "apply"] },
                              feature: { enum: ["F11", "F12", "F13", "F14", "F22"] }
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
                              bytes: { type: "integer", minimum: 0 }
                            }
                          }
                        },
                        fingerprint: { type: ["string", "null"] }
                      }
                    : {
                        records: {
                          type: "array",
                          items: theme
                            ? themeRecordSchema
                            : background
                              ? backgroundRecordSchema
                              : layout
                                ? layoutRecordSchema
                                : masterRecordSchema
                        },
                        fingerprint: { type: "string" }
                      }
                }
              ]
            }
          }
        }
      }
    ];
  })
);

const shapeRecordProperties = {
  shapeId: { type: "integer", minimum: 0, maximum: 4294967295 },
  name: { type: "string" },
  title: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  kind: { type: ["string", "null"] },
  ...Object.fromEntries(
    ["left", "top", "width", "height", "lineWidth"].map((key) => [
      key,
      { type: ["integer", "null"] }
    ])
  ),
  rotation: { type: "number" },
  flipHorizontal: { type: "boolean" },
  flipVertical: { type: "boolean" },
  geometry: {
    oneOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["coordinateSystem", "unit", "groupPath", "corners"],
        properties: {
          coordinateSystem: { enum: ["slide", "group"] },
          unit: { const: "emu" },
          groupPath: { type: "array", items: { type: ["string", "null"] } },
          corners: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y"],
              properties: { x: { type: "integer" }, y: { type: "integer" } }
            }
          }
        }
      }
    ]
  },
  locked: { type: ["boolean", "null"] },
  fill: { type: ["string", "null"] },
  lineColor: { type: ["string", "null"] },
  fillType: { type: ["string", "null"] },
  lineFillType: { type: ["string", "null"] },
  unsupported: { type: "array", items: { type: "string" } },
  placeholder: {
    oneOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["idx", "type", "orient", "sz"],
        properties: {
          idx: { type: "integer" },
          type: { type: "string" },
          orient: { type: "string" },
          sz: { type: "string" }
        }
      }
    ]
  },
  location: { $ref: "#/$defs/location" },
  token: { type: "string" },
  part: { type: "string" }
};
for (const action of ["group", "ungroup"]) {
  const base = shapeSchemaDefinitions["shapes.set"]!;
  const properties = Object.fromEntries(
    Object.entries(base.options.properties).filter(
      ([key]) => !Object.hasOwn(shapeValues, key) && !["all", "allowEmpty"].includes(key)
    )
  );
  Object.assign(shapeSchemaDefinitions, {
    ["shapes." + action]: {
      ...base,
      description:
        "Preserve world geometry and z-order with explicit nonnegative tolerance. Grouping requires distinct contiguous siblings; ungrouping selects one group. Identity groups preserve child XML. Transformed ungrouping requires rectangles without text, styles or strokes, nested groups and quarter-turn rotation chains. Unsupported geometry and affected references fail.",
      options: {
        ...base.options,
        required: action === "group" ? ["shapes", "tolerance"] : ["tolerance"],
        properties: {
          ...properties,
          tolerance: {
            type: "object",
            additionalProperties: false,
            required: ["value", "unit"],
            properties: {
              value: { type: "number", minimum: 0 },
              unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
            }
          },
          ...(action === "group"
            ? {
                shapes: {
                  type: "array",
                  minItems: 2,
                  uniqueItems: true,
                  items: inspectSchema.result.$defs.location
                }
              }
            : {})
        }
      }
    }
  });
}
for (const action of ["move", "align", "distribute", "duplicate"]) {
  const base = shapeSchemaDefinitions["shapes.set"]!;
  const properties = Object.fromEntries(
    Object.entries(base.options.properties).filter(([key]) => !Object.hasOwn(shapeValues, key))
  );
  Object.assign(shapeSchemaDefinitions, {
    ["shapes." + action]: {
      ...base,
      description:
        "Explicit slide or group coordinates and distinct siblings. Hidden objects participate; locked objects reject the operation. Stable drawing order breaks ties. Alignment uses the selection bounds; distribution preserves endpoints and equalizes edge gaps. Duplication allocates fresh IDs and remaps supported references.",
      options: {
        ...base.options,
        required: [
          "coordinateSystem",
          ...(action === "align"
            ? ["alignment"]
            : action === "distribute"
              ? ["axis"]
              : action === "duplicate"
                ? ["offsetX", "offsetY"]
                : [])
        ],
        properties: {
          ...properties,
          coordinateSystem: { enum: ["slide", "group"] },
          shapes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: inspectSchema.result.$defs.location
          },
          ...(action === "move"
            ? {
                order: { enum: ["front", "back", "forward", "backward"] },
                position: { type: "integer", minimum: 1 }
              }
            : action === "align"
              ? { alignment: { enum: ["left", "center", "right", "top", "middle", "bottom"] } }
              : action === "distribute"
                ? { axis: { enum: ["horizontal", "vertical"] } }
                : Object.fromEntries(
                    ["offsetX", "offsetY"].map((key) => [
                      key,
                      {
                        type: "object",
                        additionalProperties: false,
                        required: ["value", "unit"],
                        properties: {
                          value: { type: "number" },
                          unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
                        }
                      }
                    ])
                  ))
        }
      }
    }
  });
}
export const shapeSchemas = Object.fromEntries(
  Object.entries({ ...shapeSchemaDefinitions, ...drawingSchemaDefinitions }).map(
    ([operation, schema]) => {
      const mutation =
        operation.endsWith(".add") ||
        operation.endsWith(".set") ||
        operation === "shapes.group" ||
        operation === "shapes.ungroup" ||
        ["shapes.move", "shapes.align", "shapes.distribute", "shapes.duplicate"].includes(
          operation
        );
      const base = masterSchemas[mutation ? "shapes.set" : "masters.list"]!.result;
      const data = base.properties.data.oneOf[1]!;
      return [
        operation,
        {
          ...schema,
          options: {
            ...schema.options,
            allOf: [
              ...(operation === "shapes.drawing.set"
                ? [
                    {
                      anyOf: ["fill", "fillKind", "line", "shadowInherit"].map((key) => ({
                        required: [key]
                      }))
                    },
                    {
                      if: { required: ["fill"] },
                      then: {
                        not: {
                          anyOf: [
                            "fillKind",
                            "color",
                            "stops",
                            "angle",
                            "pattern",
                            "mode",
                            "foreground",
                            "background"
                          ].map((key) => ({ required: [key] }))
                        }
                      }
                    },
                    {
                      if: { required: ["file"] },
                      then: {
                        anyOf: [
                          {
                            required: ["fillKind", "mode"],
                            properties: { fillKind: { const: "picture" } }
                          },
                          {
                            required: ["fill"],
                            properties: { fill: { properties: { kind: { const: "picture" } } } }
                          }
                        ]
                      }
                    }
                  ]
                : []),
              ...(operation === "shapes.move"
                ? [{ oneOf: [{ required: ["order"] }, { required: ["position"] }] }]
                : []),
              ...(["shapes.move", "shapes.align", "shapes.distribute", "shapes.duplicate"].includes(
                operation
              )
                ? [
                    {
                      if: { required: ["shapes"] },
                      then: {
                        not: {
                          anyOf: ["select", "slide", "part", "shape", "all", "allowEmpty"].map(
                            (key) => ({
                              required: [key]
                            })
                          )
                        }
                      }
                    }
                  ]
                : []),
              { not: { required: ["part", "slide"] } },
              { not: { required: ["description", "altText"] } },
              {
                if: { required: ["select"] },
                then: {
                  not: {
                    anyOf: ["part", "slide", "shape", "all"].map((key) => ({ required: [key] }))
                  }
                }
              },
              ...(mutation ? xmlSetSchema.options.allOf.slice(xmlSelectionRules.length) : []),
              ...(mutation && operation.startsWith("shapes.paths.")
                ? [
                    {
                      oneOf: [
                        {
                          required: ["path"],
                          not: { anyOf: [{ required: ["vertices"] }, { required: ["close"] }] }
                        },
                        { required: ["vertices", "close"], not: { required: ["path"] } }
                      ]
                    }
                  ]
                : []),
              ...(operation === "shapes.set"
                ? [{ anyOf: Object.keys(shapeValues).map((key) => ({ required: [key] })) }]
                : []),
              ...(operation === "shapes.ungroup"
                ? [
                    {
                      anyOf: ["shape", "select", "slide", "part"].map((key) => ({
                        required: [key]
                      }))
                    }
                  ]
                : [])
            ]
          },
          result: {
            ...base,
            properties: {
              ...base.properties,
              operation: { const: operation },
              data: {
                oneOf: [
                  { type: "null" },
                  {
                    ...data,
                    properties: mutation
                      ? {
                          ...data.properties,
                          dryRun: { type: "boolean" },
                          effects: {
                            ...data.properties!.effects!,
                            items: {
                              ...data.properties!.effects!.items,
                              properties: {
                                ...data.properties!.effects!.items.properties,
                                feature:
                                  operation.startsWith("shapes.drawing.") ||
                                  operation.startsWith("shapes.effects.")
                                    ? { const: "F27" }
                                    : [
                                          "shapes.move",
                                          "shapes.align",
                                          "shapes.distribute",
                                          "shapes.duplicate"
                                        ].includes(operation)
                                      ? { const: "F25" }
                                      : operation === "shapes.group" ||
                                          operation === "shapes.ungroup"
                                        ? { const: "F24" }
                                        : data.properties!.effects!.items.properties.feature
                              }
                            }
                          }
                        }
                      : {
                          records: {
                            type: "array",
                            items: {
                              type: "object",
                              additionalProperties: false,
                              required: operation.startsWith("shapes.paths.")
                                ? [
                                    "path",
                                    "xml",
                                    "unsupported",
                                    "shapeId",
                                    "location",
                                    "token",
                                    "part"
                                  ]
                                : Object.keys(shapeRecordProperties),
                              properties: operation.startsWith("shapes.paths.")
                                ? {
                                    path: { anyOf: [pathValue, { type: "null" }] },
                                    xml: { type: ["string", "null"] },
                                    unsupported: { type: "boolean" },
                                    shapeId: { type: "integer" },
                                    name: { type: "string" },
                                    location: shapeRecordProperties.location,
                                    token: { type: "string" },
                                    part: { type: "string" }
                                  }
                                : operation === "shapes.drawing.get"
                                  ? {
                                      ...shapeRecordProperties,
                                      drawing: {
                                        type: "object",
                                        required: [
                                          "fill",
                                          "line",
                                          "shadow",
                                          "shadowInherit",
                                          "preserved"
                                        ],
                                        properties: {
                                          fill: { type: "object" },
                                          line: { type: "object" },
                                          shadow: { type: ["object", "null"] },
                                          shadowInherit: { type: "boolean" },
                                          preserved: { type: "array", items: { type: "string" } }
                                        }
                                      }
                                    }
                                  : shapeRecordProperties
                            }
                          }
                        },
                    required: mutation ? [...data.required!, "dryRun"] : ["records"]
                  }
                ]
              }
            }
          }
        }
      ];
    }
  )
);

export const textGetSchema = {
  description:
    "Read structural text order. Cached fields are not evaluated. Fine-grained table/cell/paragraph/run selectors are unavailable.",
  input: inspectSchema.input,
  options: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      json: { type: "boolean" },
      limit: xmlSelection.limit,
      select: inspectSchema.options.properties.select,
      slide: inspectSchema.options.properties.slide,
      shape: inspectSchema.options.properties.shape,
      scope: { enum: ["slides", "notes", "layouts", "masters", "notes-master", "handout-master"] }
    },
    allOf: [
      {
        if: { required: ["slide"] },
        then: { properties: { scope: { enum: ["slides", "notes", "layouts", "masters"] } } }
      },
      {
        if: { required: ["select"] },
        then: { not: { anyOf: ["scope", "slide", "shape"].map((key) => ({ required: [key] })) } }
      },
      { if: { required: ["shape"] }, then: { required: ["slide"] } }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "text.get" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["text", "order", "segments"],
            properties: {
              text: { type: "string" },
              order: { const: "structural" },
              segments: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["location", "text", "paragraphs"],
                  properties: {
                    location: { $ref: "#/$defs/location" },
                    text: { type: "string" },
                    cell: {
                      type: "object",
                      additionalProperties: false,
                      required: ["coordinateSystem", "row", "column"],
                      properties: {
                        coordinateSystem: { const: "zero-based" },
                        row: { type: "integer", minimum: 0 },
                        column: { type: "integer", minimum: 0 }
                      }
                    },
                    paragraphs: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["index", "coordinateSystem", "text", "inlines"],
                        properties: {
                          index: { type: "integer", minimum: 0 },
                          coordinateSystem: { const: "zero-based" },
                          text: { type: "string" },
                          inlines: {
                            type: "array",
                            items: {
                              oneOf: [
                                {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["kind", "text"],
                                  properties: { kind: { const: "run" }, text: { type: "string" } }
                                },
                                {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["kind", "text"],
                                  properties: { kind: { const: "break" }, text: { const: "\v" } }
                                },
                                {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["kind", "cachedText", "fieldId", "fieldType"],
                                  properties: {
                                    kind: { const: "field" },
                                    cachedText: { type: "string" },
                                    fieldId: { type: ["string", "null"] },
                                    fieldType: { type: ["string", "null"] }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      }
                    }
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

export const textReplaceSchema = {
  description:
    "Replace literal Unicode text across adjacent runs. Paragraphs, fields and breaks stop matches. Replacement inherits the first affected run style. No Unicode normalization or fine-grained range selectors.",
  input: inspectSchema.input,
  options: {
    ...textGetSchema.options,
    required: ["find", "with"],
    properties: {
      ...textGetSchema.options.properties,
      style: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        description:
          "CLI --style-json; override only replacement run bold/italic, retaining first-run other style properties.",
        properties: { bold: { type: "boolean" }, italic: { type: "boolean" } }
      },
      find: { type: "string", minLength: 1 },
      with: { type: "string" },
      first: { type: "boolean" },
      all: { type: "boolean" },
      occurrence: { type: "integer", minimum: 1, maximum: 9007199254740991 },
      allowEmpty: { type: "boolean" },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    allOf: [
      ...textGetSchema.options.allOf,
      ...xmlSetSchema.options.allOf.slice(xmlSelectionRules.length),
      {
        oneOf: [
          {
            required: ["first"],
            properties: { first: { const: true } },
            not: { anyOf: [{ required: ["all"] }, { required: ["occurrence"] }] }
          },
          {
            required: ["all"],
            properties: { all: { const: true } },
            not: { anyOf: [{ required: ["first"] }, { required: ["occurrence"] }] }
          },
          {
            required: ["occurrence"],
            not: { anyOf: [{ required: ["first"] }, { required: ["all"] }] }
          }
        ]
      }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "text.replace" },
      affected: { type: "integer", minimum: 0 },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["replacements", "dryRun"],
            properties: {
              replacements: { type: "integer", minimum: 0 },
              dryRun: { type: "boolean" }
            }
          }
        ]
      }
    }
  }
};

const runColorOptionSchema = {
  anyOf: [
    { type: "null" },
    { type: "string", minLength: 6, maxLength: 6 },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        rgb: { type: "string", minLength: 6, maxLength: 6 },
        theme: { type: "string" },
        brightness: { type: "number", minimum: -1, maximum: 1 }
      },
      oneOf: [
        { required: ["rgb"], not: { required: ["theme"] } },
        { required: ["theme"], not: { required: ["rgb"] } }
      ]
    }
  ]
};

const runFormattingProperties = {
  complexScriptCharset: { type: ["integer", "null"], minimum: -128, maximum: 127 },
  complexScriptPitchFamily: {
    enum: [null, 0, 1, 2, 16, 17, 18, 32, 33, 34, 48, 49, 50, 64, 65, 66, 80, 81, 82]
  },
  complexScriptPanose: {
    type: ["string", "null"],
    minLength: 20,
    maxLength: 20,
    description: "Exactly 20 hexadecimal digits."
  },
  eastAsiaFont: { type: ["string", "null"], minLength: 1 },
  complexScriptFont: { type: ["string", "null"], minLength: 1 },
  symbolFont: { type: ["string", "null"], minLength: 1 },
  alternateLanguage: { type: ["string", "null"], minLength: 1 },
  rtl: { type: ["boolean", "null"] },
  text: { type: "string" },
  font: { type: ["string", "null"], minLength: 1 },
  size: {
    type: ["number", "null"],
    minimum: 1,
    maximum: 4000,
    description: "Points; CLI accepts explicit length suffixes."
  },
  language: { type: ["string", "null"], minLength: 1 },
  bold: { type: ["boolean", "null"] },
  italic: { type: ["boolean", "null"] },
  underline: {
    anyOf: [
      { type: "integer", minimum: 0, maximum: 17 },
      {
        enum: Object.keys(MSO_TEXT_UNDERLINE_TYPE).filter(
          (key) =>
            key !== "MIXED" &&
            typeof MSO_TEXT_UNDERLINE_TYPE[key as keyof typeof MSO_TEXT_UNDERLINE_TYPE] === "number"
        )
      },
      { type: "null" },
      { type: "boolean" },
      {
        enum: [
          "none",
          "words",
          "sng",
          "dbl",
          "heavy",
          "dotted",
          "dottedHeavy",
          "dash",
          "dashHeavy",
          "dashLong",
          "dashLongHeavy",
          "dotDash",
          "dotDashHeavy",
          "dotDotDash",
          "dotDotDashHeavy",
          "wavy",
          "wavyHeavy",
          "wavyDbl"
        ]
      }
    ]
  },
  strike: { enum: [null, "none", "single", "double"] },
  baseline: { type: ["number", "null"], minimum: -100, maximum: 100 },
  capitalization: { enum: [null, "none", "small", "all"] },
  spacing: {
    type: ["number", "null"],
    minimum: -4000,
    maximum: 4000,
    description: "Points; CLI accepts explicit length suffixes."
  },
  color: runColorOptionSchema,
  highlight: runColorOptionSchema
};
export const textRunsSetSchema = {
  description:
    "Update selected text runs, retaining unknown XML. Omitted properties remain unchanged; null clears direct formatting to inherit. Paragraph/run CLI positions are one-based; SDK positions are zero-based. Colors accept hex or explicit JSON color values. Table/cell selectors are unavailable.",
  input: inspectSchema.input,
  options: {
    ...textGetSchema.options,
    properties: {
      ...textGetSchema.options.properties,
      ...runFormattingProperties,
      paragraph: { type: "integer", minimum: 1 },
      run: { type: "integer", minimum: 1 },
      all: { type: "boolean" },
      allowEmpty: { type: "boolean" },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    allOf: [
      {
        anyOf: [
          ...["select", "slide", "shape", "paragraph", "run"].map((key) => ({ required: [key] })),
          { required: ["all"], properties: { all: { const: true } } }
        ]
      },
      ...textGetSchema.options.allOf,
      ...xmlSetSchema.options.allOf.slice(xmlSelectionRules.length),
      { anyOf: Object.keys(runFormattingProperties).map((key) => ({ required: [key] })) },
      {
        if: { required: ["select"] },
        then: { not: { anyOf: [{ required: ["paragraph"] }, { required: ["run"] }] } }
      }
    ]
  },
  result: {
    ...textReplaceSchema.result,
    properties: {
      ...textReplaceSchema.result.properties,
      operation: { const: "text.runs.set" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["runs", "dryRun"],
            properties: { runs: { type: "integer", minimum: 0 }, dryRun: { type: "boolean" } }
          }
        ]
      }
    }
  }
};

const readRunColorSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["type", "rgb", "theme", "brightness"],
  properties: {
    type: { enum: ["RGB", "SCHEME", "HSL", "PRESET", "SCRGB", "SYSTEM"] },
    rgb: { type: ["string", "null"] },
    theme: { type: ["string", "null"] },
    brightness: { type: "number" }
  }
};
export const textRunsGetSchema = {
  description:
    "Read direct run properties without creating XML. Null means absent direct formatting; inspect reports effective values and inheritance provenance.",
  input: inspectSchema.input,
  options: {
    ...textGetSchema.options,
    properties: {
      ...textGetSchema.options.properties,
      paragraph: { type: "integer", minimum: 1 },
      run: { type: "integer", minimum: 1 }
    },
    allOf: [
      ...textGetSchema.options.allOf,
      {
        if: { required: ["select"] },
        then: { not: { anyOf: [{ required: ["paragraph"] }, { required: ["run"] }] } }
      }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "text.runs.get" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["runs"],
            properties: {
              runs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["location", "paragraph", "run", "coordinateSystem", "formatting"],
                  properties: {
                    location:
                      textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items
                        .properties.location,
                    paragraph: { type: "integer", minimum: 0 },
                    run: { type: "integer", minimum: 0 },
                    coordinateSystem: { const: "zero-based" },
                    formatting: {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(runFormattingProperties).filter(
                        (key) => key !== "text"
                      ),
                      properties: {
                        ...Object.fromEntries(
                          Object.keys(runFormattingProperties)
                            .filter((key) => key !== "text")
                            .map((key) => [key, { type: ["string", "number", "boolean", "null"] }])
                        ),
                        color: readRunColorSchema,
                        highlight: readRunColorSchema
                      }
                    }
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

export const textRunsListSchema = {
  ...textRunsGetSchema,
  description:
    "List direct run formatting without creating XML; empty selections return an empty array.",
  result: {
    ...textRunsGetSchema.result,
    properties: { ...textRunsGetSchema.result.properties, operation: { const: "text.runs.list" } }
  }
};

const paragraphFormattingProperties = {
  alignment: {
    enum: [
      null,
      "left",
      "center",
      "right",
      "justify",
      "justifyLow",
      "distributed",
      "thaiDistributed",
      1,
      2,
      3,
      4,
      5,
      6,
      7
    ]
  },
  ...Object.fromEntries(
    ["marginLeft", "marginRight", "defaultTabSize", "spaceBefore", "spaceAfter"].map((key) => [
      key,
      {
        type: ["number", "null"],
        minimum: 0,
        description: "Points; CLI accepts explicit length suffixes."
      }
    ])
  ),
  indent: {
    type: ["number", "null"],
    description: "Points; negative values create hanging indentation."
  },
  level: { type: ["integer", "null"], minimum: 0, maximum: 8 },
  rtl: { type: ["boolean", "null"] },
  lineSpacing: {
    anyOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["unit", "value"],
        properties: { unit: { enum: ["multiple", "pt"] }, value: { type: "number", minimum: 0 } }
      }
    ]
  },
  bullet: {
    anyOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { const: "none" } }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "character"],
        properties: { kind: { const: "character" }, character: { type: "string", minLength: 1 } }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "scheme"],
        properties: {
          kind: { const: "numbered" },
          scheme: { enum: paragraphNumberingSchemes },
          startAt: { type: "integer", minimum: 1, maximum: 32767 }
        }
      }
    ]
  },
  tabs: {
    anyOf: [
      { type: "null" },
      {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["position", "alignment"],
          properties: {
            position: { type: "number", minimum: 0 },
            alignment: { enum: ["left", "center", "right", "decimal"] }
          }
        }
      }
    ]
  }
};
export const textParagraphsGetSchema = {
  description:
    "Read local paragraph overrides without creating XML; null means inheritance. SDK points and zero-based paragraph positions; CLI one-based paragraph positions.",
  input: inspectSchema.input,
  options: {
    ...textGetSchema.options,
    properties: { ...textGetSchema.options.properties, paragraph: { type: "integer", minimum: 1 } },
    allOf: [
      ...textGetSchema.options.allOf,
      { if: { required: ["select"] }, then: { not: { required: ["paragraph"] } } }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "text.paragraphs.get" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["paragraphs"],
            properties: {
              paragraphs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["location", "paragraph", "coordinateSystem", "formatting"],
                  properties: {
                    location:
                      textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items
                        .properties.location,
                    paragraph: { type: "integer", minimum: 0 },
                    coordinateSystem: { const: "zero-based" },
                    formatting: {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(paragraphFormattingProperties),
                      properties: paragraphFormattingProperties
                    }
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
export const textParagraphsListSchema = {
  ...textParagraphsGetSchema,
  result: {
    ...textParagraphsGetSchema.result,
    properties: {
      ...textParagraphsGetSchema.result.properties,
      operation: { const: "text.paragraphs.list" }
    }
  }
};
export const textParagraphsSetSchema = {
  description:
    "Set selected local paragraph overrides; omitted is unchanged, null restores inheritance, and zero is explicit. No line wrapping is calculated. Options below are normalized SDK values in points. CLI lengths use explicit suffixes. --direction ltr|rtl|null maps to rtl; --numbering decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none|null maps to bullet. --bullet accepts a character or structured JSON. --tabs accepts Length records, aligned Length positions, or aligned point positions. --line-spacing accepts a multiple or explicit length.",
  input: inspectSchema.input,
  options: {
    ...textParagraphsGetSchema.options,
    properties: {
      ...textParagraphsGetSchema.options.properties,
      ...paragraphFormattingProperties,
      all: { type: "boolean" },
      allowEmpty: { type: "boolean" },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    allOf: [
      ...textParagraphsGetSchema.options.allOf,
      ...xmlSetSchema.options.allOf.slice(xmlSelectionRules.length),
      {
        anyOf: [
          ...["select", "slide", "shape", "paragraph"].map((key) => ({ required: [key] })),
          { required: ["all"], properties: { all: { const: true } } }
        ]
      },
      { anyOf: Object.keys(paragraphFormattingProperties).map((key) => ({ required: [key] })) }
    ]
  },
  result: {
    ...textReplaceSchema.result,
    properties: {
      ...textReplaceSchema.result.properties,
      operation: { const: "text.paragraphs.set" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["paragraphs", "dryRun"],
            properties: { paragraphs: { type: "integer", minimum: 0 }, dryRun: { type: "boolean" } }
          }
        ]
      }
    }
  }
};

const frameFormattingProperties = {
  ...Object.fromEntries(
    ["marginLeft", "marginRight", "marginTop", "marginBottom"].map((key) => [
      key,
      {
        type: ["number", "null"],
        minimum: -2147483648 / 12700,
        maximum: 2147483647 / 12700,
        description: "Points; CLI accepts explicit length suffixes."
      }
    ])
  ),
  verticalAnchor: { enum: [null, "top", "middle", "bottom", 1, 3, 4] },
  columns: { type: ["integer", "null"], minimum: 1, maximum: 16 },
  wrap: { type: ["boolean", "null"] },
  verticalText: {
    enum: [
      null,
      "horz",
      "vert",
      "vert270",
      "wordArtVert",
      "eaVert",
      "mongolianVert",
      "wordArtVertRtl"
    ]
  },
  rotation: { type: ["number", "null"], minimum: -2147483648 / 60000, maximum: 2147483647 / 60000 },
  autofit: { enum: [null, "none", "shape", "text", 0, 1, 2] }
};
export const textFramesGetSchema = {
  description:
    "Read local shape text frame metadata (table cells excluded) without measuring fonts or calculating text fit. Null means no direct override. Table/cell/paragraph/run selectors are unavailable.",
  input: inspectSchema.input,
  options: textGetSchema.options,
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "text.frames.get" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["frames"],
            properties: {
              frames: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["location", "formatting"],
                  properties: {
                    location:
                      textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items
                        .properties.location,
                    formatting: {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(frameFormattingProperties),
                      properties: {
                        ...frameFormattingProperties,
                        verticalAnchor: {
                          enum: [...frameFormattingProperties.verticalAnchor.enum, "just", "dist"],
                          description:
                            "Raw just/dist tokens are retained on read; writes support top/middle/bottom only."
                        }
                      }
                    }
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
export const textFramesListSchema = {
  ...textFramesGetSchema,
  result: {
    ...textFramesGetSchema.result,
    properties: {
      ...textFramesGetSchema.result.properties,
      operation: { const: "text.frames.list" }
    }
  }
};
export const textFramesSetSchema = {
  description:
    "Set shape frame metadata (table cells excluded): insets, anchor, columns, wrap, vertical text, rotation and autofit metadata. Omitted fields stay unchanged; null clears direct metadata. Text replaces frame content. Autofit never measures fonts or calculates text fit. SDK lengths use points; CLI uses explicit length suffixes. Rotation uses degrees within signed DrawingML angle bounds.",
  input: inspectSchema.input,
  options: {
    ...textGetSchema.options,
    properties: {
      ...textGetSchema.options.properties,
      ...frameFormattingProperties,
      text: { type: "string" },
      all: { type: "boolean" },
      allowEmpty: { type: "boolean" },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    allOf: [
      ...textGetSchema.options.allOf,
      ...xmlSetSchema.options.allOf.slice(xmlSelectionRules.length),
      {
        anyOf: [
          ...["select", "slide", "shape"].map((key) => ({ required: [key] })),
          { required: ["all"], properties: { all: { const: true } } }
        ]
      },
      {
        anyOf: [...Object.keys(frameFormattingProperties), "text"].map((key) => ({
          required: [key]
        }))
      }
    ]
  },
  result: {
    ...textReplaceSchema.result,
    properties: {
      ...textReplaceSchema.result.properties,
      operation: { const: "text.frames.set" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["frames", "dryRun"],
            properties: { frames: { type: "integer", minimum: 0 }, dryRun: { type: "boolean" } }
          }
        ]
      }
    }
  }
};

export const textFitSchema = {
  description:
    "Fit horizontal single-column shape text using explicitly supplied scalar font metrics. Largest integer point size within inclusive bounds; no host fonts. Margins use points in SDK and explicit units in CLI. Wrap defaults true; lineSpacing is a positive line-height multiplier. Existing paragraph spacing is replaced. Bullets, indentation and advanced shaping are unsupported.",
  input: inspectSchema.input,
  options: {
    ...textFramesSetSchema.options,
    required: ["metrics"],
    properties: {
      ...textGetSchema.options.properties,
      metrics: {
        type: "object",
        additionalProperties: false,
        required: ["family", "bold", "italic", "unitsPerEm", "lineHeight", "advances"],
        properties: {
          family: { type: "string", minLength: 1, maxLength: 256 },
          bold: { type: "boolean" },
          italic: { type: "boolean" },
          unitsPerEm: { type: "integer", minimum: 1, maximum: 1000000 },
          lineHeight: { type: "integer", minimum: 1, maximum: 1000000 },
          advances: {
            type: "object",
            minProperties: 1,
            maxProperties: 65536,
            additionalProperties: { type: "integer", minimum: 0, maximum: 1000000 }
          }
        }
      },
      fontFamily: { type: "string", minLength: 1, maxLength: 256, default: "Calibri" },
      minSize: { type: "integer", minimum: 1, maximum: 4000, default: 1 },
      maxSize: { type: "integer", minimum: 1, maximum: 4000, default: 18 },
      bold: { type: "boolean", default: false },
      italic: { type: "boolean", default: false },
      wrap: { type: "boolean", default: true },
      lineSpacing: { type: "number", minimum: 0.01, maximum: 100, default: 1 },
      ...Object.fromEntries(
        ["marginLeft", "marginRight", "marginTop", "marginBottom"].map((key) => [
          key,
          { type: "number", minimum: 0, maximum: 2147483647 / 12700 }
        ])
      ),
      all: { type: "boolean" },
      allowEmpty: { type: "boolean" },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    allOf: textFramesSetSchema.options.allOf.slice(0, -1)
  },
  result: {
    ...textFramesSetSchema.result,
    properties: {
      ...textFramesSetSchema.result.properties,
      operation: { const: "text.fit" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["frames", "sizes", "dryRun"],
            properties: {
              frames: { type: "integer", minimum: 0 },
              sizes: { type: "array", items: { type: "integer", minimum: 1, maximum: 4000 } },
              dryRun: { type: "boolean" }
            }
          }
        ]
      }
    }
  }
};
