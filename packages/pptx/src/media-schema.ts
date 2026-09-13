import { textGetSchema } from "./command-schema.js";
export const mediaUsage =
  "Usage: pptx media list|get INPUT [--slide N --shape NAME | --select TOKEN] [--json]\n" +
  "  --scope slides|layouts|masters|notes|notes-master|handout-master|shared\n" +
  "  --limit NAME=VALUE; slide positions are one-based; get requires exactly one occurrence.\n" +
  "Inventory embedded and linked media, types/hashes, posters, playback metadata, captions and timing.\n" +
  "External targets remain inert. Metadata parsing does not prove playback.\n";
const nullableString = { type: ["string", "null"] };
const relationshipProperties = {
  relationshipId: { type: "string" },
  relationshipType: { type: "string" },
  target: { type: "string" },
  external: { type: "boolean" },
  mediaPart: nullableString,
  contentType: nullableString,
  bytes: { type: ["integer", "null"], minimum: 0 },
  sha256: nullableString
};
const relationshipList = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: Object.keys(relationshipProperties),
    properties: relationshipProperties
  }
};
const metadata = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["namespace", "name", "xml", "relationships"],
    properties: {
      namespace: { type: "string" },
      name: { type: "string" },
      xml: { type: "string" },
      relationships: relationshipList
    }
  }
};
const occurrenceProperties = {
  id: { type: "string" },
  location: { $ref: "#/$defs/location" },
  sourcePart: { type: "string" },
  shapeId: nullableString,
  shapeName: nullableString,
  kind: { enum: ["audio", "video", "unknown"] },
  relationships: relationshipList,
  posters: relationshipList,
  playback: metadata,
  captions: metadata,
  timing: metadata
};
const partProperties = {
  part: { type: "string" },
  contentType: nullableString,
  bytes: { type: "integer", minimum: 0 },
  sha256: { type: "string", minLength: 64, maxLength: 64 },
  sha1: { type: "string", minLength: 40, maxLength: 40 },
  occurrenceIds: { type: "array", items: { type: "string" } }
};
export const mediaSchemas = Object.fromEntries(
  ["list", "get"].map((action) => [
    `media.${action}`,
    {
      description: mediaUsage,
      input: textGetSchema.input,
      options: {
        ...textGetSchema.options,
        properties: {
          ...textGetSchema.options.properties,
          scope: {
            enum: [
              "slides",
              "layouts",
              "masters",
              "notes",
              "notes-master",
              "handout-master",
              "shared"
            ]
          }
        },
        allOf: [
          ...textGetSchema.options.allOf,
          { if: { required: ["shape"] }, then: { required: ["slide"] } }
        ]
      },
      result: {
        ...textGetSchema.result,
        properties: {
          ...textGetSchema.result.properties,
          operation: { const: `media.${action}` },
          data: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["occurrences", "media", "playbackVerified"],
                properties: {
                  occurrences: {
                    type: "array",
                    ...(action === "get" ? { minItems: 1, maxItems: 1 } : {}),
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(occurrenceProperties),
                      properties: occurrenceProperties
                    }
                  },
                  media: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(partProperties),
                      properties: partProperties
                    }
                  },
                  playbackVerified: { const: false }
                }
              }
            ]
          }
        }
      }
    }
  ])
);
