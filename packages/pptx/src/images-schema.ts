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
const imageLength = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: {
    value: { type: "number", minimum: -27273042316900, maximum: 27273042316900 },
    unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
  }
};
const extractedProperties = {
  name: { type: "string" },
  path: { type: "string" },
  bytes: { type: "integer", minimum: 0 },
  sha256: { type: "string", minLength: 64, maxLength: 64 },
  contentType: nullableString,
  sourceParts: { type: "array", items: { type: "string" } },
  occurrences: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(occurrenceProperties),
      properties: occurrenceProperties
    }
  }
};
export const imageSchemas = {
  "images.extract": {
    description:
      "Extract selected original image bytes with deterministic safe names and SHA256 manifests. Default output is per occurrence; explicit unique groups identical bytes while retaining provenance. External links reject. Active formats are copied as bytes without decoding or rendering. Multi-file publication requires a transaction or explicit allowPartialOutput. maxOutputs lowers the trusted archive-member ceiling; maxOutputBytes bounds total extracted bytes and the report independently.",
    input: textGetSchema.input,
    options: {
      type: "object",
      additionalProperties: false,
      $defs: textGetSchema.result.$defs,
      properties: {
        json: { type: "boolean" },
        limit: {
          ...textGetSchema.options.properties.limit,
          properties: {
            ...textGetSchema.options.properties.limit.properties,
            maxOutputs: { type: "integer", minimum: 1 }
          }
        },
        select: textGetSchema.options.properties.select,
        slide: textGetSchema.options.properties.slide,
        image: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        scope: { enum: scopes },
        unique: { type: "boolean" },
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        outputDir: { type: "string", minLength: 1, not: { const: "-" } },
        force: { type: "boolean" },
        dryRun: { type: "boolean" },
        allowPartialOutput: { type: "boolean" }
      },
      allOf: [
        {
          if: { required: ["select"] },
          then: { not: { anyOf: ["scope", "slide", "image"].map((key) => ({ required: [key] })) } }
        },
        {
          if: { not: { required: ["dryRun"], properties: { dryRun: { const: true } } } },
          then: { required: ["outputDir"] }
        },
        {
          if: { required: ["force"], properties: { force: { const: true } } },
          then: { required: ["outputDir"] }
        }
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: "images.extract" },
        affected: { type: "integer", minimum: 0 },
        data: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["outputs", "dryRun"],
              properties: {
                dryRun: { type: "boolean" },
                outputs: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(extractedProperties),
                    properties: extractedProperties
                  }
                }
              }
            }
          ]
        }
      }
    }
  },
  "images.set": {
    description:
      "Edit selected picture occurrences. Signed crop fractions quantize to 1/100000; crop edits require positive visible area on both axes. Other edits preserve existing extended crop. Opacity leaves original media bytes intact. Border width uses explicit lengths.",
    input: textGetSchema.input,
    options: {
      type: "object",
      additionalProperties: false,
      $defs: textGetSchema.result.$defs,
      properties: {
        ...Object.fromEntries(
          ["cropLeft", "cropRight", "cropTop", "cropBottom"].map((key) => [
            key,
            { type: "number", minimum: -21474.83648, maximum: 21474.83647 }
          ])
        ),
        rotation: { type: "number", minimum: -360000, maximum: 360000 },
        flipHorizontal: { type: "boolean" },
        flipVertical: { type: "boolean" },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        borderColor: { type: "string", minLength: 6, maxLength: 6 },
        borderWidth: {
          ...imageLength,
          description: "Nonnegative length, at most 20116800 EMUs after conversion.",
          properties: {
            ...imageLength.properties,
            value: { ...imageLength.properties.value, minimum: 0 }
          }
        },
        altText: { type: "string" },
        select: textGetSchema.options.properties.select,
        scope: { enum: scopes.filter((scope) => scope !== "shared") },
        slide: textGetSchema.options.properties.slide,
        image: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        all: { type: "boolean" },
        allowEmpty: { type: "boolean" },
        json: { type: "boolean" },
        limit: textGetSchema.options.properties.limit,
        output: { type: "string", minLength: 1 },
        inPlace: { type: "boolean" },
        force: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      allOf: [
        {
          anyOf: [
            "cropLeft",
            "cropRight",
            "cropTop",
            "cropBottom",
            "rotation",
            "flipHorizontal",
            "flipVertical",
            "opacity",
            "borderColor",
            "borderWidth",
            "altText"
          ].map((key) => ({ required: [key] }))
        },
        {
          if: { required: ["image"], properties: { scope: { const: "slides" } } },
          then: { required: ["slide"] }
        },
        {
          if: { required: ["select"] },
          then: {
            not: { anyOf: ["scope", "slide", "image", "all"].map((key) => ({ required: [key] })) }
          }
        },
        { not: { required: ["output", "inPlace"] } },
        {
          if: { required: ["force"], properties: { force: { const: true } } },
          then: { required: ["output"] }
        },
        {
          if: { not: { required: ["dryRun"], properties: { dryRun: { const: true } } } },
          then: {
            oneOf: [
              { required: ["output"] },
              { required: ["inPlace"], properties: { inPlace: { const: true } } }
            ]
          }
        }
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: "images.set" },
        affected: { type: "integer", minimum: 0 },
        data: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["dryRun", "occurrences", "affectedSlides"],
              properties: {
                dryRun: { type: "boolean" },
                affectedSlides: { type: "array", items: { type: "integer", minimum: 1 } },
                occurrences: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(occurrenceProperties),
                    properties: occurrenceProperties
                  }
                }
              }
            }
          ]
        }
      }
    }
  },
  "images.replace": {
    description:
      "Clone and rebind selected image occurrences by default. Explicit shared replacement reports all references across scopes. PNG/JPEG/GIF bytes only; external links, vector/fallback pairs and media owning relationships are rejected. No fetching or decoding. Preservation defaults to true; false geometry resets to intrinsic size at origin, false crop clears crop, false alt text clears description and title. Explicit altText overrides description.",
    input: textGetSchema.input,
    options: {
      type: "object",
      additionalProperties: false,
      $defs: textGetSchema.result.$defs,
      required: ["file"],
      properties: {
        file: { type: "string", minLength: 1 },
        contentType: { enum: ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/x-wmf"] },
        select: textGetSchema.options.properties.select,
        scope: { enum: scopes },
        slide: textGetSchema.options.properties.slide,
        image: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        shared: { type: "boolean", default: false },
        all: { type: "boolean" },
        allowEmpty: { type: "boolean" },
        preserveCrop: { type: "boolean", default: true },
        preserveGeometry: { type: "boolean", default: true },
        preserveAltText: { type: "boolean", default: true },
        altText: { type: "string" },
        json: { type: "boolean" },
        limit: textGetSchema.options.properties.limit,
        output: { type: "string", minLength: 1 },
        inPlace: { type: "boolean" },
        force: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      allOf: [
        {
          if: { required: ["image"], properties: { scope: { const: "slides" } } },
          then: { required: ["slide"] }
        },
        {
          if: { required: ["scope"], properties: { scope: { const: "shared" } } },
          then: { required: ["shared"], properties: { shared: { const: true } } }
        },
        {
          anyOf: [
            { required: ["select"] },
            { required: ["image"] },
            { required: ["all"], properties: { all: { const: true } } }
          ]
        },
        {
          if: { required: ["select"] },
          then: {
            not: { anyOf: ["scope", "slide", "image", "all"].map((key) => ({ required: [key] })) }
          }
        },
        { not: { required: ["output", "inPlace"] } },
        {
          if: { required: ["force"], properties: { force: { const: true } } },
          then: { required: ["output"] }
        },
        {
          if: { not: { required: ["dryRun"], properties: { dryRun: { const: true } } } },
          then: {
            oneOf: [
              { required: ["output"] },
              { required: ["inPlace"], properties: { inPlace: { const: true } } }
            ]
          }
        }
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: "images.replace" },
        affected: { type: "integer", minimum: 0 },
        data: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["dryRun", "shared", "occurrences", "affectedSlides"],
              properties: {
                dryRun: { type: "boolean" },
                shared: { type: "boolean" },
                affectedSlides: { type: "array", items: { type: "integer", minimum: 1 } },
                occurrences: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(occurrenceProperties),
                    properties: occurrenceProperties
                  }
                }
              }
            }
          ]
        }
      }
    }
  },
  "images.add": {
    description:
      "Insert explicit PNG/JPEG/GIF bytes on one slide. A supported extension supplies the content type unless explicit; bytes must match. Intrinsic sizing uses admitted dimensions and DPI. One dimension preserves aspect; two dimensions default to stretch. No image decoding or network access.",
    input: textGetSchema.input,
    options: {
      type: "object",
      additionalProperties: false,
      required: ["slide", "file"],
      properties: {
        slide: textGetSchema.options.properties.slide,
        placeholder: { type: "integer", minimum: 0, maximum: 4294967295 },
        file: { type: "string", minLength: 1 },
        contentType: { enum: ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/x-wmf"] },
        left: imageLength,
        top: imageLength,
        width: imageLength,
        height: imageLength,
        fit: { enum: ["contain", "cover", "stretch"] },
        altText: { type: "string" },
        json: { type: "boolean" },
        limit: textGetSchema.options.properties.limit,
        output: { type: "string", minLength: 1 },
        inPlace: { type: "boolean" },
        force: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      allOf: [
        {
          if: { required: ["placeholder"] },
          then: {
            properties: { contentType: { enum: ["image/png", "image/jpeg"] } },
            not: {
              anyOf: ["left", "top", "width", "height", "fit"].map((key) => ({ required: [key] }))
            }
          }
        },
        { if: { required: ["fit"] }, then: { required: ["width", "height"] } },
        { not: { required: ["output", "inPlace"] } },
        {
          if: { required: ["force"], properties: { force: { const: true } } },
          then: { required: ["output"] }
        },
        {
          if: { not: { required: ["dryRun"], properties: { dryRun: { const: true } } } },
          then: {
            oneOf: [
              { required: ["output"] },
              { required: ["inPlace"], properties: { inPlace: { const: true } } }
            ]
          }
        }
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: "images.add" },
        affected: { type: "integer", minimum: 0, maximum: 1 },
        data: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["images", "dryRun"],
              properties: { images: { const: 1 }, dryRun: { type: "boolean" } }
            }
          ]
        }
      }
    }
  },
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
