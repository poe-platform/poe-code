import { patternPresets, dashPresets } from "./drawing-format.js";
import { themeColorSlots } from "./themes.js";
const ratio = { type: "number", minimum: 0, maximum: 1 };
const rgb = { type: "string", pattern: "^[0-9A-Fa-f]{6}$" };
export const drawingColorSchema = {
  anyOf: [
    rgb,
    ...["rgb", "theme"].map((key) => ({
      type: "object",
      additionalProperties: false,
      required: [key],
      properties: {
        [key]:
          key === "rgb" ? rgb : { enum: [...themeColorSlots, "tx1", "tx2", "bg1", "bg2", "phClr"] },
        brightness: { type: "number", minimum: -1, maximum: 1 },
        opacity: ratio
      }
    }))
  ]
};
const length = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: {
    value: { type: "number", minimum: 0 },
    unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
  }
};
const fill = {
  oneOf: [
    ...["inherit", "none"].map((kind) => ({
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: kind } }
    })),
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "solid" }, color: drawingColorSchema }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "stops", "angle"],
      properties: {
        kind: { const: "gradient" },
        angle: { type: "number", minimum: -360000, maximum: 360000 },
        stops: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["position", "color"],
            properties: { position: ratio, color: drawingColorSchema }
          }
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "preset"],
      properties: {
        kind: { const: "pattern" },
        preset: { enum: patternPresets },
        foreground: drawingColorSchema,
        background: drawingColorSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "mode"],
      properties: {
        kind: { const: "picture" },
        relationshipId: { type: "string", minLength: 1 },
        mode: { enum: ["stretch", "tile"] },
        crop: {
          type: "object",
          additionalProperties: false,
          required: ["left", "top", "right", "bottom"],
          properties: { left: ratio, top: ratio, right: ratio, bottom: ratio }
        }
      }
    }
  ]
};
export const drawingUpdateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fill,
    line: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        fill,
        width: { anyOf: [length, { type: "null" }] },
        dash: { enum: [...dashPresets, null] }
      }
    },
    shadowInherit: { type: "boolean" },
    shadow: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["blur", "color", "opacity"],
          properties: { blur: length, color: drawingColorSchema, opacity: ratio }
        }
      ]
    }
  },
  minProperties: 1,
  not: { required: ["shadow", "shadowInherit"] }
};
export const drawingSchemaDefinitions = Object.fromEntries(
  ["shapes.drawing.get", "shapes.drawing.set", "shapes.effects.set"].map((operation) => {
    const mutation = operation.endsWith(".set"),
      effects = operation === "shapes.effects.set";
    return [
      operation,
      {
        description:
          "Local drawing fills, lines, alpha and zero-offset outer shadows; theme colors remain references. Complex effects and 3D are preserve-only.",
        input: { type: "string", minLength: 1 },
        options: {
          type: "object",
          additionalProperties: false,
          ...(effects ? { required: ["shadow", "opacity", "shadowBlur", "shadowColor"] } : {}),
          properties: {
            json: { type: "boolean" },
            limit: { type: "object" },
            scope: { enum: ["slides", "layouts", "masters", "shared"] },
            slide: { type: "integer", minimum: 1 },
            part: { type: "string" },
            select: { type: "string" },
            shape: { type: "string" },
            ...(mutation
              ? {
                  output: { type: "string" },
                  inPlace: { type: "boolean" },
                  force: { type: "boolean" },
                  dryRun: { type: "boolean" },
                  all: { type: "boolean" },
                  allowEmpty: { type: "boolean" },
                  ...(effects
                    ? {
                        shadow: { type: "boolean" },
                        opacity: ratio,
                        shadowBlur: length,
                        shadowColor: drawingColorSchema
                      }
                    : {
                        fill,
                        fillKind: {
                          enum: ["inherit", "none", "solid", "gradient", "pattern", "picture"]
                        },
                        color: drawingColorSchema,
                        stops: {
                          type: "array",
                          minItems: 2,
                          maxItems: 10000,
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["position", "color"],
                            properties: { position: ratio, color: drawingColorSchema }
                          }
                        },
                        angle: { type: "number", minimum: -360000, maximum: 360000 },
                        pattern: { enum: patternPresets },
                        mode: { enum: ["stretch", "tile"] },
                        foreground: drawingColorSchema,
                        background: drawingColorSchema,
                        file: { type: "string", minLength: 1 },
                        line: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            fill,
                            width: { anyOf: [length, { type: "null" }] },
                            dash: { enum: [...dashPresets, null] }
                          }
                        },
                        shadowInherit: { type: "boolean" }
                      })
                }
              : {})
          }
        },
        result: {}
      }
    ];
  })
);
