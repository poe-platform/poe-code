import { inspectSchema, textGetSchema, xmlGetSchema } from "./command-schema.js";
export const packageToolsUsage =
  "Usage: pptx extract INPUT --output-dir DIR [--parts JSON] [--allow-partial-output]\n       pptx pack --manifest PATH --output PATH [--kind pptx|potx|ppsx] [--dry-run]\nExplicit scoped files only; --force --json --limit NAME=VALUE.\nPack verifies hashes and the complete package graph.\nAuthor and timestamp overrides are unavailable; metadata is preserved.\n";
const string = { type: "string", minLength: 1 };
const output = {
  type: "object",
  additionalProperties: false,
  required: ["path", "sha256", "bytes"],
  properties: {
    path: string,
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    bytes: { type: "integer", minimum: 0 }
  }
};
export const packageToolsSchemas = Object.fromEntries(
  ["extract", "pack"].map((operation) => [
    operation,
    {
      description: packageToolsUsage,
      input: operation === "extract" ? inspectSchema.input : { type: "array", maxItems: 0 },
      options: {
        type: "object",
        additionalProperties: false,
        required: operation === "extract" ? ["outputDir"] : ["manifest"],
        ...(operation === "pack"
          ? {
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
            }
          : {}),
        properties: {
          json: { type: "boolean" },
          limit: {
            ...xmlGetSchema.options.properties.limit,
            properties: {
              ...xmlGetSchema.options.properties.limit.properties,
              ...(operation === "extract" ? { maxOutputs: { type: "integer", minimum: 1 } } : {})
            }
          },
          force: { type: "boolean" },
          ...(operation === "extract"
            ? {
                outputDir: { ...string, not: { const: "-" } },
                parts: { type: "array", minItems: 1, uniqueItems: true, items: string },
                allowPartialOutput: { type: "boolean" }
              }
            : {
                manifest: string,
                output: string,
                dryRun: { type: "boolean" },
                kind: { enum: ["pptx", "potx", "ppsx"] },
                timestamp: string,
                author: { type: "string" }
              })
        }
      },
      result: {
        ...textGetSchema.result,
        allOf: [
          {
            if: { properties: { ok: { const: true } } },
            then: { properties: { data: { type: "object" }, errors: { maxItems: 0 } } },
            else: {
              properties: {
                errors: { minItems: 1 },
                ...(operation === "pack" ? { data: { type: "null" }, affected: { const: 0 } } : {})
              }
            }
          }
        ],
        properties: {
          ...textGetSchema.result.properties,
          affected: { type: "integer", minimum: 0 },
          operation: { const: operation },
          data: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required:
                  operation === "extract"
                    ? ["outputs", "dryRun"]
                    : ["outputs", "dryRun", "fingerprint", "effects"],
                properties: {
                  dryRun: { type: "boolean" },
                  outputs: {
                    type: "array",
                    items:
                      operation === "extract"
                        ? {
                            ...output,
                            required: [...output.required, "part", "name", "contentType"],
                            properties: {
                              ...output.properties,
                              part: string,
                              name: string,
                              contentType: { type: ["string", "null"] }
                            }
                          }
                        : output
                  },
                  ...(operation === "pack"
                    ? {
                        fingerprint: { type: ["string", "null"] },
                        effects: { type: "array", items: { type: "string" } }
                      }
                    : {})
                }
              }
            ]
          }
        }
      }
    }
  ])
);
