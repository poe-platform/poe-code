import { inspectSchema } from "./command-schema.js";
import { animationSchemas, animationUpdates } from "./animations-schema.js";

export const animationBatchUsage =
  "Usage: pptx batch INPUT --ops-json JSON | --ops-file PATH [output]\n" +
  "Envelope: {\"version\":1,\"operations\":[{\"operation\":\"animations.set\",\"arguments\":{\"trigger\":\"on-click\"},\"options\":{\"slide\":1,\"shape\":\"Badge\"}}]}\n" +
  "Supports animation add/set/remove only, at most 1000 ordered items.\n" +
  "Every item requires arguments; options defaults to {}. Unknown fields fail.\n" +
  "Selectors: one-based slide, shape, select Location, scope slides, all, allowEmpty.\n" +
  "Repair dependent triggers before removing their predecessor in one batch.\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Common: --json --limit NAME=VALUE. Validate all syntax, then publish once.\n";
const mutation = animationSchemas["animations.remove"]!;
const itemOptions = {
  type: "object", additionalProperties: false,
  properties: { slide: { type: "integer", minimum: 1 }, shape: { type: "string", minLength: 1 }, select: inspectSchema.result.$defs.location, scope: { const: "slides" }, all: { type: "boolean" }, allowEmpty: { type: "boolean" } },
  allOf: [
    { if: { required: ["select"] }, then: { not: { anyOf: ["scope", "slide", "shape"].map(key => ({ required: [key] })) } } },
    { if: { required: ["shape"] }, then: { required: ["slide"] } }
  ]
};
export const animationBatchEnvelopeSchema = {
  type: "object", additionalProperties: false, required: ["version", "operations"],
  properties: { version: { const: 1 }, operations: {
    type: "array", maxItems: 1000, items: { oneOf: ["add", "set", "remove"].map(action => ({
      type: "object", additionalProperties: false, required: ["operation", "arguments"],
      properties: {
        operation: { const: `animations.${action}` },
        arguments: { type: "object", additionalProperties: false, properties: action === "remove" ? {} : animationUpdates,
          ...(action === "add" ? { required: ["kind", "trigger", "target"] } : {}),
          ...(action === "set" ? { minProperties: 1 } : {}),
          ...(action === "remove" ? {} : { allOf: [{ if: { required: ["kind"], properties: { kind: { const: "appear" } } }, then: { properties: { duration: { const: 0 } } } }] })
        },
        options: action === "add" ? itemOptions : { ...itemOptions, allOf: [...itemOptions.allOf, { anyOf: [{ required: ["slide"] }, { required: ["select"] }, { required: ["all"], properties: { all: { const: true } } }] }] }
      },
      ...(action === "add" ? {} : { allOf: [{ required: ["options"] }] })
    })) }
  } }
};
export const animationBatchSchema = {
  description: animationBatchUsage, input: inspectSchema.input,
  options: {
    type: "object", additionalProperties: false,
    properties: {
      json: { type: "boolean" }, limit: mutation.options.properties.limit,
      opsJson: { type: "string", contentMediaType: "application/json", contentSchema: animationBatchEnvelopeSchema },
      opsFile: { type: "string", minLength: 1 },
      output: { type: "string", minLength: 1 }, inPlace: { type: "boolean" }, force: { type: "boolean" }, dryRun: { type: "boolean" }
    },
    allOf: [
      { oneOf: [{ required: ["opsJson"] }, { required: ["opsFile"] }] },
      { not: { required: ["output", "inPlace"], properties: { inPlace: { const: true } } } },
      { if: { required: ["force"], properties: { force: { const: true } } }, then: { required: ["output"] } },
      { if: { required: ["output", "json"], properties: { output: { const: "-" }, json: { const: true } } }, then: { required: ["dryRun"], properties: { dryRun: { const: true } } } }
    ]
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties, affected: { type: "integer", minimum: 0 }, operation: { const: "batch" },
      data: { oneOf: [{ type: "null" }, {
        type: "object", additionalProperties: false, required: ["results", "outputs"],
        properties: {
          results: { type: "array", maxItems: 1000, items: { oneOf: ["add", "set", "remove"].map(action => animationSchemas[`animations.${action}`]!.result) } },
          outputs: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "sha256", "bytes"], properties: { path: { type: "string" }, sha256: { type: "string" }, bytes: { type: "integer", minimum: 0 } } } }
        }
      }] }
    }
  }
};
