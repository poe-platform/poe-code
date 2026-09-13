import { textGetSchema } from "./command-schema.js";
export const diffModes = [
  "structural",
  "text",
  "media",
  "relationships",
  "effective-formatting",
  "raw"
] as const;
export const diffUsage =
  "Usage: pptx diff LEFT RIGHT [--mode MODE] [--json] [--limit NAME=VALUE]\n" +
  "Modes: structural (default), text, media, relationships, raw.\n" +
  "effective-formatting is rejected until inherited formatting can be resolved.\n" +
  "Formatting is explicitly raw; media uses SHA-256 without decoding or rendering.\n" +
  "Limits: maxBytes, maxNodes, maxDepth, maxOutputBytes; only lower trusted ceilings.\n" +
  "Use - for one stdin input; -- ends options. No files are modified.\n" +
  "Status: 0 equal, 1 different, 2 trouble, 130 cancelled. Differences have ok: true.\n";
export const diffSchema = {
  description: diffUsage,
  input: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 2 },
  options: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { enum: diffModes, default: "structural" },
      json: { type: "boolean" },
      limit: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          ["maxBytes", "maxNodes", "maxDepth", "maxOutputBytes"].map((name) => [
            name,
            { type: "integer", minimum: name === "maxOutputBytes" ? 512 : 1 }
          ])
        )
      }
    }
  },
  result: {
    ...textGetSchema.result,
    properties: {
      ...textGetSchema.result.properties,
      operation: { const: "diff" },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["equal", "mode", "formatting", "changes", "limitations"],
            properties: {
              equal: { type: "boolean" },
              mode: { enum: diffModes },
              formatting: { enum: ["raw", "effective"] },
              limitations: { type: "array", items: { type: "string" } },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "category", "kind", "before", "after", "left", "right"],
                  properties: {
                    id: { type: "string" },
                    category: {
                      enum: [
                        "slides",
                        "text",
                        "properties",
                        "geometry",
                        "media",
                        "relationships",
                        "opaque",
                        "raw"
                      ]
                    },
                    kind: { enum: ["added", "removed", "changed"] },
                    before: {},
                    after: {},
                    left: {
                      oneOf: [
                        { type: "null" },
                        textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items
                          .properties.location
                      ]
                    },
                    right: {
                      oneOf: [
                        { type: "null" },
                        textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items
                          .properties.location
                      ]
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
};
