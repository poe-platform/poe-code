import { inspectSchema, textGetSchema } from "./command-schema.js";

export const notesUsage =
  "Usage: pptx notes list|get|add|set|remove INPUT [--slide N | --select TOKEN] [--text TEXT] [output]\n" +
  "Speaker text is separate from slide-image/date/footer placeholders and other notes shapes.\n" +
  "Reads never create notes. Add requires absent notes; set creates missing speaker text.\n" +
  "Scope: notes. Use text operations with explicit notes or notes-master scope for shape edits.\n" +
  "Mutations require selection or --all and --output PATH | --in-place | --dry-run.\n" +
  "Common: --json --limit NAME=VALUE; mutations accept --allow-empty; --force requires --output.\n";

export const noteSchemas = Object.fromEntries(
  ["list", "get", "add", "set", "remove"].map((action) => {
    const mutation = ["add", "set", "remove"].includes(action);
    const editing = action === "add" || action === "set";
    return [
      `notes.${action}`,
      {
        description: notesUsage,
        input: inspectSchema.input,
        options: {
          type: "object",
          additionalProperties: false,
          ...(editing ? { required: ["text"] } : {}),
          properties: {
            json: { type: "boolean" },
            limit: textGetSchema.options.properties.limit,
            select: inspectSchema.options.properties.select,
            slide: inspectSchema.options.properties.slide,
            scope: { const: "notes" },
            ...(editing ? { text: { type: "string" } } : {}),
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
            {
              if: { required: ["select"] },
              then: { not: { anyOf: ["slide", "scope"].map((key) => ({ required: [key] })) } }
            },
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
            operation: { const: `notes.${action}` },
            data: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: [mutation ? "dryRun" : "notes"],
                  properties: mutation
                    ? { dryRun: { type: "boolean" } }
                    : {
                        notes: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "selector",
                              "location",
                              "slide",
                              "part",
                              "master",
                              "text",
                              "bodyShapeId"
                            ],
                            properties: {
                              selector: { type: "string" },
                              location: inspectSchema.result.properties.locations.items,
                              slide: { type: "integer", minimum: 1 },
                              part: { type: "string" },
                              master: { type: "string" },
                              text: { type: ["string", "null"] },
                              bodyShapeId: { type: ["string", "null"] }
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
