import { inspectSchema, textGetSchema } from "./command-schema.js";
export const linksUsage =
  "Usage: pptx links list|get|add|set|remove INPUT [selection] [output]\n" +
  "Selection: --slide N --shape NAME | --select TOKEN; --scope slides; --all for edits.\n" +
  "Destination: --url URL | --target-slide N | --action next|previous|first|last|last-viewed|end-show\n" +
  "Action url or slide may accompany the matching destination. URLs, including relative URLs, stay inert.\n" +
  "Advanced --path JSON selects the listed parentPath: zero-based child positions from the part root.\n" +
  "Trigger: --trigger click|hover (default click). Remove --sanitize explicitly removes unsafe actions.\n" +
  "Custom-show, launch, macro and OLE actions are preserved and never executed.\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Common: --json --limit NAME=VALUE; mutations accept --allow-empty.\n";
export const linkSchemas = Object.fromEntries(
  ["list", "get", "add", "set", "remove"].map((action) => {
    const mutation = !["list", "get"].includes(action);
    const editing = ["add", "set"].includes(action);
    return [
      `links.${action}`,
      {
        description: linksUsage,
        input: inspectSchema.input,
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...textGetSchema.options.properties,
            scope: { const: "slides" },
            trigger: { enum: ["click", "hover"] },
            path: { type: "array", items: { type: "integer", minimum: 0 } },
            ...(editing
              ? {
                  url: { type: "string", minLength: 1 },
                  targetSlide: { type: "integer", minimum: 1 },
                  action: {
                    enum: [
                      "url",
                      "slide",
                      "next",
                      "previous",
                      "first",
                      "last",
                      "last-viewed",
                      "end-show"
                    ]
                  }
                }
              : {}),
            ...(action === "remove" ? { sanitize: { type: "boolean" } } : {}),
            ...(mutation
              ? {
                  all: { type: "boolean" },
                  allowEmpty: { type: "boolean" },
                  output: { type: "string", minLength: 1 },
                  inPlace: { type: "boolean" },
                  force: { type: "boolean" },
                  dryRun: { type: "boolean" }
                }
              : {})
          },
          allOf: [
            ...textGetSchema.options.allOf,
            { if: { required: ["shape"] }, then: { required: ["slide"] } },
            ...(editing
              ? [
                  {
                    oneOf: [
                      {
                        required: ["url"],
                        properties: { action: { const: "url" } },
                        not: { required: ["targetSlide"] }
                      },
                      {
                        required: ["targetSlide"],
                        properties: { action: { const: "slide" } },
                        not: { required: ["url"] }
                      },
                      {
                        required: ["action"],
                        properties: {
                          action: {
                            enum: ["next", "previous", "first", "last", "last-viewed", "end-show"]
                          }
                        },
                        not: { anyOf: [{ required: ["url"] }, { required: ["targetSlide"] }] }
                      }
                    ]
                  }
                ]
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
          ...textGetSchema.result,
          properties: {
            ...textGetSchema.result.properties,
            operation: { const: `links.${action}` },
            data: {
              oneOf: [
                { type: "null" },
                mutation
                  ? {
                      type: "object",
                      additionalProperties: false,
                      required: ["dryRun"],
                      properties: { dryRun: { type: "boolean" } }
                    }
                  : {
                      type: "object",
                      additionalProperties: false,
                      required: ["links"],
                      properties: {
                        links: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "part",
                              "path",
                              "parentPath",
                              "location",
                              "shapeId",
                              "trigger",
                              "relationshipId",
                              "targetReference",
                              "url",
                              "targetSlide",
                              "action",
                              "kind",
                              "requiresSanitization"
                            ],
                            properties: {
                              parentPath: { type: "array", items: { type: "integer", minimum: 0 } },
                              part: { type: "string" },
                              path: { type: "array", items: { type: "integer", minimum: 0 } },
                              location:
                                textGetSchema.result.properties.data.oneOf[1]!.properties!.segments
                                  .items.properties.location,
                              shapeId: { type: ["string", "null"] },
                              trigger: { enum: ["click", "hover"] },
                              relationshipId: { type: ["string", "null"] },
                              targetReference: { type: ["string", "null"] },
                              url: { type: ["string", "null"] },
                              targetSlide: { type: ["integer", "null"], minimum: 1 },
                              action: { type: ["string", "null"] },
                              kind: {
                                enum: ["url", "slide", "navigation", "custom-show", "unsupported"]
                              },
                              requiresSanitization: { type: "boolean" }
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
