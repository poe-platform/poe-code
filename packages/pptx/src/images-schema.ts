import { textGetSchema } from "./command-schema.js";
const nullableString = { type: ["string", "null"] };
const scopes = [
  "slides",
  "layouts",
  "masters",
  "notes",
  "notes-master",
  "handout-master",
  "shared"
];
const cropProperties = Object.fromEntries(
  ["left", "top", "right", "bottom"].map((key) => [key, { type: "number" }])
);
const occurrenceProperties = {
  id: { type: "string" },
  location: { $ref: "#/$defs/location" },
  sourcePart: { type: "string" },
  relationshipId: { type: "string" },
  target: { type: "string" },
  external: { type: "boolean" },
  mediaPart: nullableString,
  shapeId: nullableString,
  shapeName: nullableString,
  scope: { enum: scopes },
  inheritedBy: { type: "array", items: { type: "integer", minimum: 1 } },
  kind: { enum: ["picture", "fill", "background"] },
  role: { enum: ["primary", "svg", "fallback"] },
  position: { type: "integer", minimum: 1 },
  crop: {
    type: "object",
    additionalProperties: false,
    required: Object.keys(cropProperties),
    properties: cropProperties
  },
  altText: nullableString,
  title: nullableString,
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
          groupPath: { type: "array", items: nullableString },
          corners: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y"],
              properties: { x: { type: "number" }, y: { type: "number" } }
            }
          }
        }
      }
    ]
  },
  sha256: nullableString,
  contentType: nullableString,
  bytes: { type: ["integer", "null"], minimum: 0 }
};
const mediaProperties = {
  sha1: { type: "string", minLength: 40, maxLength: 40 },
  contentTypes: { type: "array", minItems: 1, items: nullableString },
  parts: { type: "array", minItems: 1, items: { type: "string" } },
  sha256: { type: "string", minLength: 64, maxLength: 64 },
  contentType: nullableString,
  bytes: { type: "integer", minimum: 0 },
  occurrenceIds: { type: "array", items: { type: "string" } },
  pixelWidth: { type: ["integer", "null"], minimum: 1 },
  pixelHeight: { type: ["integer", "null"], minimum: 1 },
  dpiX: { type: "number", minimum: 1 },
  dpiY: { type: "number", minimum: 1 }
};
export const imageSchemas = {
  "images.list": {
    description:
      "List image references and distinct media parts without fetching external links. SVG and fallback references retain one picture position. Explicit unique groups byte-identical parts by SHA256 while retaining their part names. Stored crop fractions can be negative or exceed one.",
    input: textGetSchema.input,
    options: {
      ...textGetSchema.options,
      $defs: textGetSchema.result.$defs,
      properties: {
        json: { type: "boolean" },
        limit: textGetSchema.options.properties.limit,
        select: textGetSchema.options.properties.select,
        slide: textGetSchema.options.properties.slide,
        image: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        scope: { enum: scopes },
        unique: { type: "boolean" }
      },
      allOf: [
        {
          if: { required: ["select"] },
          then: { not: { anyOf: ["scope", "slide", "image"].map((key) => ({ required: [key] })) } }
        }
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: "images.list" },
        data: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["occurrences", "media"],
              properties: {
                occurrences: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(occurrenceProperties),
                    properties: occurrenceProperties
                  }
                },
                media: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(mediaProperties),
                    properties: mediaProperties
                  }
                }
              }
            }
          ]
        }
      }
    }
  }
};
