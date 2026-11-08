import { inspectSchema, textGetSchema } from "./command-schema.js";

export const transitionsUsage =
  "Usage: pptx transitions list|get|add|set|remove INPUT [selection] [output]\n" +
  "Selection: --slide N | --select TOKEN | --all (mutations); --scope slides\n" +
  "Edits: --kind cut|fade|push|wipe; --direction left|right|up|down\n" +
  "       --duration MS --advance-after MS|null --advance-on-click true|false\n" +
  "Timing is integer milliseconds, 0..2147483647; zero advances immediately.\n" +
  "Use --advance-after null to disable automatic advance.\n" +
  "Defaults: duration 500 (cut 0), click true, automatic advance disabled.\n" +
  "Push/wipe require direction; cut/fade forbid it. Unsupported effects retained.\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Common: --json --limit NAME=VALUE; mutations accept --allow-empty.\n";
const milliseconds = { type: "integer", minimum: 0, maximum: 2147483647 };
const updates = {
  kind: { enum: ["cut", "fade", "push", "wipe"] },
  direction: { enum: ["left", "right", "up", "down"] },
  duration: milliseconds,
  advanceAfter: { oneOf: [milliseconds, { type: "null" }] },
  advanceOnClick: { type: "boolean" }
};
export const transitionSchemas = Object.fromEntries(
  ["list", "get", "add", "set", "remove"].map((action) => {
    const mutation = !["list", "get"].includes(action);
    const editing = ["add", "set"].includes(action);
    return [
      `transitions.${action}`,
      {
        description: transitionsUsage,
        input: inspectSchema.input,
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            json: { type: "boolean" },
            limit: textGetSchema.options.properties.limit,
            select: textGetSchema.options.properties.select,
            slide: textGetSchema.options.properties.slide,
            scope: { const: "slides" },
            ...(editing ? updates : {}),
            ...(mutation
              ? {
                  all: { type: "boolean" },
                  allowEmpty: { type: "boolean" },
                  output: { type: "string", minLength: 1 },
                  inPlace: { type: "boolean" },
                  dryRun: { type: "boolean" },
                  force: { type: "boolean" }
                }
              : {})
          },
          ...(action === "add" ? { required: ["kind"] } : {}),
          allOf: [
            {
              if: { required: ["select"] },
              then: { not: { anyOf: ["slide", "scope"].map((key) => ({ required: [key] })) } }
            },
            ...(editing
              ? [
                  {
                    if: { required: ["kind"], properties: { kind: { enum: ["cut", "fade"] } } },
                    then: { not: { required: ["direction"] } }
                  },
                  {
                    if: { required: ["kind"], properties: { kind: { enum: ["push", "wipe"] } } },
                    then: { required: ["direction"] }
                  },
                  {
                    if: { required: ["kind"], properties: { kind: { const: "cut" } } },
                    then: { properties: { duration: { const: 0 } } }
                  }
                ]
              : []),
            ...(action === "set"
              ? [{ anyOf: Object.keys(updates).map((key) => ({ required: [key] })) }]
              : []),
            ...(mutation
              ? [
                  {
                    anyOf: [
                      { required: ["select"] },
                      { required: ["slide"] },
                      { required: ["all"], properties: { all: { const: true } } }
                    ]
                  },
                  {
                    anyOf: [
                      { required: ["output"] },
                      { required: ["inPlace"], properties: { inPlace: { const: true } } },
                      { required: ["dryRun"], properties: { dryRun: { const: true } } }
                    ]
                  },
                  {
                    not: {
                      required: ["output", "inPlace"],
                      properties: { inPlace: { const: true } }
                    }
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
              : [])
          ]
        },
        result: {
          ...inspectSchema.result,
          properties: {
            ...inspectSchema.result.properties,
            affected: { type: "integer", minimum: 0 },
            operation: { const: `transitions.${action}` },
            data: {
              oneOf: [
                { type: "null" },
                mutation
                  ? {
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
                              action: { const: action },
                              feature: { const: "F44" }
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
                  : {
                      type: "object",
                      additionalProperties: false,
                      required: ["items"],
                      properties: {
                        items: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["location", "kind", "name", "fields"],
                            properties: {
                              location: { $ref: "#/$defs/location" },
                              kind: { enum: ["cut", "fade", "push", "wipe", "unsupported"] },
                              name: { type: "null" },
                              fields: {
                                type: "array",
                                minItems: 4,
                                maxItems: 4,
                                items: {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["name", "value"],
                                  properties: {
                                    name: {
                                      enum: [
                                        "direction",
                                        "duration",
                                        "advanceAfter",
                                        "advanceOnClick"
                                      ]
                                    },
                                    value: {
                                      oneOf: ["null", "string", "number", "boolean"].map(
                                        (type) => ({
                                          type: "object",
                                          additionalProperties: false,
                                          required: ["type", "value"],
                                          properties: { type: { const: type }, value: { type } }
                                        })
                                      )
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
      }
    ];
  })
);
