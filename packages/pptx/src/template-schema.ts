import { inspectSchema, textGetSchema } from "./command-schema.js";

export const templateUsage =
  "Usage: pptx template apply INPUT (--data-json JSON | --data-file PATH) [output]\n" +
  "Bindings declare name, kind, scope: slides, slide, and cardinality: one|all.\n" +
  "Text slots use {{name}}; tables and images use a shape named {{name}}.\n" +
  "All selected slide slots require bindings. Values are literal; expressions are never evaluated.\n" +
  "Mutations require --output PATH | --in-place | --dry-run. Common: --json --limit NAME=VALUE.\n";
const text = { type: "string", maxLength: 1048576 };
export const templateBindingsSchema = {
  type: "array",
  maxItems: 1000,
  items: {
    oneOf: ["text", "table", "image"].map((kind) => ({
      type: "object",
      additionalProperties: false,
      required: ["name", "kind", "scope", "slide", "cardinality", kind],
      properties: {
        name: { ...text, minLength: 1 },
        kind: { const: kind },
        scope: { const: "slides" },
        slide: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        cardinality: { enum: ["one", "all"] },
        [kind]:
          kind === "text"
            ? text
            : kind === "table"
              ? {
                  type: "array",
                  minItems: 1,
                  maxItems: 250000,
                  items: { type: "array", minItems: 1, maxItems: 250000, items: text }
                }
              : {
                  type: "object",
                  additionalProperties: false,
                  required: ["bytes", "contentType"],
                  properties: {
                    bytes: {
                      type: "array",
                      minItems: 1,
                      items: { type: "integer", minimum: 0, maximum: 255 }
                    },
                    contentType: { type: "string", minLength: 1 }
                  }
                }
      }
    }))
  }
};
export const templateSchema = {
  description: templateUsage,
  input: inspectSchema.input,
  bindings: templateBindingsSchema,
  options: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataJson: text,
      dataFile: { type: "string", minLength: 1 },
      json: { type: "boolean" },
      limit: textGetSchema.options.properties.limit,
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" }
    },
    oneOf: [{ required: ["dataJson"] }, { required: ["dataFile"] }],
    allOf: [
      {
        anyOf: [
          { required: ["output"] },
          { required: ["inPlace"], properties: { inPlace: { const: true } } },
          { required: ["dryRun"], properties: { dryRun: { const: true } } }
        ]
      },
      { not: { required: ["output", "inPlace"], properties: { inPlace: { const: true } } } },
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
    ...textGetSchema.result,
    properties: {
      ...textGetSchema.result.properties,
      operation: { const: "template.apply" },
      data: { type: ["object", "null"] }
    }
  }
};
