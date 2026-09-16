import { inspectSchema, textGetSchema } from "./command-schema.js";

const modernAuthorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "initials", "userId", "providerId", "part", "xml"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    initials: { type: ["string", "null"] },
    userId: { type: "string" },
    providerId: { type: "string" },
    part: { type: "string" },
    xml: { type: "string" }
  }
};
const legacyCommentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "selector",
    "location",
    "slide",
    "part",
    "authorId",
    "index",
    "author",
    "initials",
    "text",
    "timestamp",
    "left",
    "top"
  ],
  properties: {
    id: { type: "string" },
    selector: { type: "string" },
    location: inspectSchema.result.properties.locations.items,
    slide: { type: "integer", minimum: 1 },
    part: { type: "string" },
    authorId: { type: "string" },
    index: { type: "integer" },
    author: { type: "string" },
    initials: { type: "string" },
    text: { type: "string" },
    timestamp: { type: "string" },
    left: { type: "number" },
    top: { type: "number" }
  }
};
const modernCommentSchema = {
  ...legacyCommentSchema,
  required: [
    ...legacyCommentSchema.required,
    "format",
    "status",
    "threadId",
    "parentId",
    "authorIdentity",
    "replies",
    "reactions",
    "opaqueXml"
  ],
  properties: {
    ...legacyCommentSchema.properties,
    index: { type: "null" },
    format: { const: "modern" },
    status: { type: "string" },
    threadId: { type: "string" },
    parentId: { type: ["string", "null"] },
    authorIdentity: { oneOf: [{ type: "null" }, modernAuthorSchema] },
    replies: { type: "array", maxItems: 0 },
    reactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "instances"],
        properties: {
          type: { type: "string" },
          instances: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["authorId", "timestamp"],
              properties: { authorId: { type: "string" }, timestamp: { type: "string" } }
            }
          }
        }
      }
    },
    opaqueXml: { type: "string" }
  }
};

export const commentsUsage =
  "Usage: pptx comments list|get|add|set|remove INPUT [selection]\n" +
  "Selection: --slide N [--id ID] or --select TOKEN, never combined.\n" +
  "Add accepts a slide selector and assigns a new comment ID; --id is not accepted.\n" +
  "Modern threads, replies, identities and reactions are read-only; unknown extensions remain opaque.\n" +
  "Legacy comments use explicit --author TEXT --timestamp UTC --text TEXT for add.\n" +
  "Set accepts --text, --author, --timestamp, --left LENGTH and --top LENGTH.\n" +
  "Optional --author-id ID and --initials TEXT distinguish authors sharing a display name.\n" +
  "Scope: slides. Positions default to zero; no author or clock is inferred.\n" +
  "Mutations require selection or --all and --output PATH | --in-place | --dry-run.\n" +
  "Common: --json --limit NAME=VALUE --allow-empty; --force requires --output.\n";

export const commentSchemas = Object.fromEntries(
  ["list", "get", "add", "set", "remove"].map((action) => {
    const mutation = ["add", "set", "remove"].includes(action);
    const editing = action === "add" || action === "set";
    return [
      `comments.${action}`,
      {
        description: commentsUsage,
        input: inspectSchema.input,
        options: {
          type: "object",
          additionalProperties: false,
          ...(action === "add" ? { required: ["text", "author", "timestamp"] } : {}),
          properties: {
            json: { type: "boolean" },
            limit: textGetSchema.options.properties.limit,
            select: inspectSchema.options.properties.select,
            slide: inspectSchema.options.properties.slide,
            scope: { const: "slides" },
            ...(action === "add" ? {} : { id: { type: "string", minLength: 3 } }),
            ...(editing
              ? {
                  text: { type: "string" },
                  author: { type: "string" },
                  authorId: { type: "string" },
                  initials: { type: "string" },
                  timestamp: { type: "string" },
                  left: { type: "string" },
                  top: { type: "string" }
                }
              : {}),
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
            ...(action === "set"
              ? [
                  {
                    anyOf: [
                      "text",
                      "author",
                      "authorId",
                      "initials",
                      "timestamp",
                      "left",
                      "top"
                    ].map((key) => ({ required: [key] }))
                  }
                ]
              : []),
            {
              if: { required: ["select"] },
              then: { not: { anyOf: ["slide", "scope", "id"].map((key) => ({ required: [key] })) } }
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
            operation: { const: `comments.${action}` },
            affected: mutation ? { type: "integer", minimum: 0 } : { const: 0 },
            data: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: mutation ? ["dryRun"] : ["comments", "authors"],
                  properties: mutation
                    ? { dryRun: { type: "boolean" } }
                    : {
                        authors: {
                          type: "array",
                          items: {
                            oneOf: [
                              modernAuthorSchema,
                              {
                                type: "object",
                                additionalProperties: false,
                                required: ["id", "name", "initials", "part", "xml"],
                                properties: {
                                  id: { type: "string" },
                                  name: { type: "string" },
                                  initials: { type: "string" },
                                  part: { type: "string" },
                                  xml: { type: "string" }
                                }
                              }
                            ]
                          }
                        },
                        comments: {
                          type: "array",
                          items: {
                            oneOf: [
                              legacyCommentSchema,
                              {
                                ...modernCommentSchema,
                                properties: {
                                  ...modernCommentSchema.properties,
                                  replies: { type: "array", items: modernCommentSchema }
                                }
                              }
                            ]
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
