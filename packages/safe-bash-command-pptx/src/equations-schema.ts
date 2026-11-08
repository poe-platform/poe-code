import { inspectSchema, textGetSchema } from "./command-schema.js";

export const equationsUsage =
  "Usage: pptx equations list|get INPUT [--slide N --shape NAME | --select TOKEN] [--json]\n" +
  "       pptx equations add INPUT --file PATH --slide N --shape NAME [output]\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Scope: slides. Insert one validated caller-authored OMML document into one selected text body.\n" +
  "Insertion accepts literal runs, fractions and sub/superscripts; other structures are inventory-only.\n" +
  "Locations select containing shapes; paragraph/equation ordinals are informational. Get rejects multiple equations.\n" +
  "Existing equations and fallbacks are preserved. No rendering, evaluation, set or remove.\n";
const record = {
  type: "object",
  additionalProperties: false,
  required: ["location", "paragraph", "equation", "coordinateSystem", "omml", "text", "supported"],
  properties: {
    location: textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items.properties.location,
    paragraph: { type: "integer", minimum: 0 },
    equation: { type: "integer", minimum: 0 },
    coordinateSystem: { const: "zero-based" },
    omml: { type: "string" },
    text: { type: "string" },
    supported: { type: "boolean" }
  }
};
export const equationSchemas = Object.fromEntries(["list", "get", "add"].map(action => {
  const adding = action === "add";
  return [`equations.${action}`, {
    description: equationsUsage,
    input: inspectSchema.input,
    options: {
      ...textGetSchema.options,
      properties: {
        ...textGetSchema.options.properties,
        scope: { const: "slides" },
        ...(adding ? {
          file: { type: "string", minLength: 1 },
          output: { type: "string", minLength: 1 },
          inPlace: { type: "boolean" }, force: { type: "boolean" }, dryRun: { type: "boolean" }
        } : {})
      },
      ...(adding ? { required: ["file"] } : {}),
      allOf: [
        ...textGetSchema.options.allOf,
        { if: { required: ["shape"] }, then: { required: ["slide"] } },
        ...(adding ? [
          { anyOf: [{ required: ["select"] }, { required: ["shape"] }] },
          { anyOf: [{ required: ["output"] }, { required: ["inPlace"], properties: { inPlace: { const: true } } }, { required: ["dryRun"], properties: { dryRun: { const: true } } }] },
          { not: { required: ["output", "inPlace"], properties: { inPlace: { const: true } } } },
          { if: { required: ["force"], properties: { force: { const: true } } }, then: { required: ["output"] } },
          { if: { required: ["output", "json"], properties: { output: { const: "-" }, json: { const: true } } }, then: { required: ["dryRun"], properties: { dryRun: { const: true } } } }
        ] : [])
      ]
    },
    result: {
      ...textGetSchema.result,
      properties: {
        ...textGetSchema.result.properties,
        operation: { const: `equations.${action}` },
        data: { oneOf: [{ type: "null" }, adding ? {
          type: "object", additionalProperties: false, required: ["dryRun"], properties: { dryRun: { type: "boolean" } }
        } : {
          type: "object", additionalProperties: false, required: ["equations"], properties: { equations: { type: "array", items: record } }
        }] }
      }
    }
  }];
}));
