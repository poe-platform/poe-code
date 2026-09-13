import { inspectSchema, xmlGetSchema } from "./command-schema.js";

export const opaqueUsage =
  "Usage: pptx objects list INPUT [--scope shared] [--json]\n" +
  "       pptx objects extract INPUT --part PART --output-dir DIR --allow-partial-output [--json]\n" +
  "       pptx fonts list INPUT [--scope presentation] [--json]\n" +
  "Objects inventory all opaque package parts, including controls, extensions, fonts and models.\n" +
  "Extraction preserves exact bytes and relationship closure under generated safe names; the manifest maps original parts.\n" +
  "No activation, recursive payload parsing, installation or rendering. Shape selectors and object editing are unsupported.\n" +
  "Extraction supports --force and --dry-run. Partial output is required unless the host supplies an atomic transaction.\n" +
  "Common limits: --limit NAME=VALUE lowers trusted host ceilings.\n";
const strings = { type: "array", items: { type: "string" } };
const relationship = {
  type: "object", additionalProperties: false,
  required: ["owner", "id", "type", "target", "external", "targetPart"],
  properties: { owner: { type: "string" }, id: { type: "string" }, type: { type: "string" }, target: { type: "string" }, external: { type: "boolean" }, targetPart: { type: ["string", "null"] } }
};
const object = {
  type: "object", additionalProperties: false,
  required: ["part", "kind", "contentType", "bytes", "sha256", "activeContent", "activeReasons", "owners", "dependencies", "missing", "externalRelationships"],
  properties: {
    part: { type: "string" }, kind: { type: "string" }, contentType: { type: "string" }, bytes: { type: "integer", minimum: 0 }, sha256: { type: "string" },
    activeContent: { type: "boolean" }, activeReasons: strings, owners: strings, dependencies: strings, missing: strings,
    externalRelationships: { type: "array", items: relationship }
  }
};
const output = {
  type: "object", additionalProperties: false, required: ["part", "name", "path", "sha256", "bytes"],
  properties: { part: { type: "string" }, name: { type: "string" }, path: { type: "string" }, sha256: { type: "string" }, bytes: { type: "integer", minimum: 0 } }
};
const declaration = {
  type: "object", additionalProperties: false, required: ["part", "typeface", "charset", "pitchFamily", "variants"],
  properties: {
    part: { type: "string" }, typeface: { type: ["string", "null"] }, charset: { type: ["string", "null"] }, pitchFamily: { type: ["string", "null"] },
    variants: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["variant", "relationshipId", "part", "missing"],
      properties: { variant: { type: "string" }, relationshipId: { type: ["string", "null"] }, part: { type: ["string", "null"] }, missing: { type: "boolean" } }
    } }
  }
};
export const opaqueSchemas = Object.fromEntries(["objects.list", "objects.extract", "fonts.list"].map(operation => {
  const extraction = operation === "objects.extract";
  const fonts = operation === "fonts.list";
  const data = {
    type: "object", additionalProperties: false,
    required: extraction ? ["outputs", "relationships", "activationPerformed", "recursiveParsingPerformed", "dryRun"] : fonts ? ["fonts", "declarations", "installationPerformed"] : ["objects", "activationPerformed", "recursiveParsingPerformed"],
    properties: {
      ...(fonts ? { declarations: { type: "array", items: declaration }, installationPerformed: { const: false } } : { activationPerformed: { const: false }, recursiveParsingPerformed: { const: false } }),
      ...(extraction ? { outputs: { type: "array", items: output }, relationships: { type: "array", items: relationship }, dryRun: { type: "boolean" } }
        : { [fonts ? "fonts" : "objects"]: { type: "array", items: object } })
    }
  };
  return [operation, {
    description: opaqueUsage,
    input: inspectSchema.input,
    options: {
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      ...(extraction ? { required: ["part"] } : {}),
      properties: {
        json: { type: "boolean" }, limit: {
          ...xmlGetSchema.options.properties.limit,
          properties: { ...xmlGetSchema.options.properties.limit.properties, ...(extraction ? { maxOutputs: { type: "integer", minimum: 1 } } : {}) }
        },
        scope: { const: fonts ? "presentation" : "shared" },
        ...(extraction ? {
          part: { type: "string", minLength: 1 }, outputDir: { type: "string", minLength: 1, not: { const: "-" } },
          force: { type: "boolean" }, dryRun: { type: "boolean" }, allowPartialOutput: { type: "boolean" }
        } : {})
      },
      ...(extraction ? { allOf: [
        { anyOf: [{ required: ["outputDir"] }, { required: ["dryRun"], properties: { dryRun: { const: true } } }] },
        { if: { required: ["force"], properties: { force: { const: true } } }, then: { required: ["outputDir"] } }
      ] } : {})
    },
    result: {
      ...inspectSchema.result,
      properties: { ...inspectSchema.result.properties, operation: { const: operation }, data: { oneOf: [{ type: "null" }, data] } }
    }
  }];
}));
