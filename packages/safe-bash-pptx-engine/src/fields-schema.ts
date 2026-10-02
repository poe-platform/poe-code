import { inspectSchema, textGetSchema } from "./command-schema.js";
const location =
  textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items.properties.location;
const values = {
  kind: { enum: ["slide-number", "date", "footer", "header"] },
  text: { type: "string" },
  update: { enum: ["preserve", "explicit"] },
  timestamp: {
    type: "string",
    format: "date-time",
    description: "Valid explicit UTC Z timestamp; no clock reading or field evaluation."
  }
};
export const fieldSchemas = Object.fromEntries(
  ["list", "get", "set", "add", "remove"].map((action) => {
    const mutation = !["list", "get"].includes(action);
    const editing = ["set", "add"].includes(action);
    return [
      `fields.${action}`,
      {
        description:
          "Read or explicitly edit cached field text. Preserve is default and rejects text/time; explicit requires text and date fields additionally require caller timestamp. Add appends to the last paragraph of the single selected body, with an empty cache under preserve. No field evaluation, implicit numbering, placeholder creation or inherited-content flattening.",
        input: inspectSchema.input,
        options: {
          ...textGetSchema.options,
          properties: {
            ...textGetSchema.options.properties,
            ...(mutation
              ? {
                  all: { type: "boolean" },
                  allowEmpty: { type: "boolean" },
                  output: { type: "string", minLength: 1 },
                  inPlace: { type: "boolean" },
                  force: { type: "boolean" },
                  dryRun: { type: "boolean" }
                }
              : {}),
            ...(editing ? values : {})
          },
          ...(action === "add" ? { required: ["kind"] } : {}),
          allOf: [
            ...textGetSchema.options.allOf,
            ...(mutation
              ? [
                  {
                    anyOf: [
                      { required: ["dryRun"], properties: { dryRun: { const: true } } },
                      { required: ["output"] },
                      { required: ["inPlace"], properties: { inPlace: { const: true } } }
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
              : []),
            ...(mutation
              ? [
                  {
                    anyOf: [
                      { required: ["all"], properties: { all: { const: true } } },
                      ...["select", "slide", "shape"].map((key) => ({ required: [key] }))
                    ]
                  }
                ]
              : []),
            ...(action === "set"
              ? [{ anyOf: ["kind", "update"].map((key) => ({ required: [key] })) }]
              : []),
            ...(editing
              ? [
                  {
                    if: { required: ["update"], properties: { update: { const: "explicit" } } },
                    then: { required: ["text"] },
                    else: { not: { anyOf: [{ required: ["text"] }, { required: ["timestamp"] }] } }
                  },
                  {
                    if: {
                      required: ["kind", "update"],
                      properties: { kind: { const: "date" }, update: { const: "explicit" } }
                    },
                    then: { required: ["timestamp"] }
                  },
                  {
                    if: { required: ["kind", "timestamp"] },
                    then: { properties: { kind: { const: "date" } } }
                  }
                ]
              : [])
          ]
        },
        result: {
          ...inspectSchema.result,
          properties: {
            ...inspectSchema.result.properties,
            operation: { const: `fields.${action}` },
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
                              location,
                              action: { const: action },
                              feature: { const: "F21" }
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
                              location,
                              kind: { enum: [...values.kind.enum, "unknown"] },
                              name: { type: ["string", "null"] },
                              fields: {
                                type: "array",
                                minItems: 5,
                                maxItems: 5,
                                items: {
                                  oneOf: [
                                    {
                                      type: "object",
                                      additionalProperties: false,
                                      required: ["name", "value"],
                                      properties: {
                                        name: { const: "fieldType" },
                                        value: {
                                          oneOf: [
                                            {
                                              type: "object",
                                              additionalProperties: false,
                                              required: ["type", "value"],
                                              properties: {
                                                type: { const: "null" },
                                                value: { type: "null" }
                                              }
                                            },
                                            {
                                              type: "object",
                                              additionalProperties: false,
                                              required: ["type", "value"],
                                              properties: {
                                                type: { const: "string" },
                                                value: { type: "string" }
                                              }
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    ...["cachedText", "coordinateSystem"].map((name) => ({
                                      type: "object",
                                      additionalProperties: false,
                                      required: ["name", "value"],
                                      properties: {
                                        name: { const: name },
                                        value: {
                                          type: "object",
                                          additionalProperties: false,
                                          required: ["type", "value"],
                                          properties: {
                                            type: { const: "string" },
                                            value:
                                              name === "coordinateSystem"
                                                ? { const: "zero-based" }
                                                : { type: "string" }
                                          }
                                        }
                                      }
                                    })),
                                    ...["paragraph", "inline"].map((name) => ({
                                      type: "object",
                                      additionalProperties: false,
                                      required: ["name", "value"],
                                      properties: {
                                        name: { const: name },
                                        value: {
                                          type: "object",
                                          additionalProperties: false,
                                          required: ["type", "value"],
                                          properties: {
                                            type: { const: "number" },
                                            value: { type: "integer", minimum: 0 }
                                          }
                                        }
                                      }
                                    }))
                                  ]
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
