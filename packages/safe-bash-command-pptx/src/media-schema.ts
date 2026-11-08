import { textGetSchema } from "./command-schema.js";
export const mediaUsage =
  "Usage: pptx media list|get|add|replace|extract INPUT [--slide N --shape NAME | --select TOKEN] [--json]\n" +
  "  --scope slides|layouts|masters|notes|notes-master|handout-master|shared\n" +
  "  --limit NAME=VALUE; slide positions are one-based; get requires exactly one occurrence.\n" +
  "Inventory embedded and linked media, types/hashes, posters, playback metadata, captions and timing.\n" +
  "External targets remain inert. Metadata parsing does not prove playback.\n" +
  "  add: --slide N --file PATH --kind audio|video --mime-type TYPE --left LENGTH --top LENGTH --width LENGTH --height LENGTH --poster PATH\n" +
  "  replace: --slide N --shape NAME --file PATH --poster PATH [--shared]\n" +
  "  add/replace: --output PATH|--in-place|--dry-run; --poster-content-type TYPE; add: --trim-start MS --trim-end MS --loop true|false --volume 0..100000\n" +
  "  extract: --output-dir DIR [--force --allow-partial-output --deduplicate]\n";
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
const mediaLength = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: { value: { type: "number" }, unit: { enum: ["emu", "in", "cm", "mm", "pt"] } }
};
for (const action of ["add", "replace", "extract"]) {
  const operation = `media.${action}`;
  const properties = {
    json: { type: "boolean" },
    limit: { type: "object" },
    slide: { type: "integer", minimum: 1 },
    ...(action === "add" ? {} : { shape: { type: "string" }, select: { type: "string" } }),
    scope: {
      enum:
        action !== "add"
          ? ["slides", "layouts", "masters", "notes", "notes-master", "handout-master", "shared"]
          : ["slides"]
    },
    ...(action === "extract"
      ? {
          outputDir: { type: "string", minLength: 1 },
          force: { type: "boolean" },
          allowPartialOutput: { type: "boolean" },
          deduplicate: { type: "boolean" }
        }
      : {
          file: { type: "string", minLength: 1 },
          poster: { type: "string", minLength: 1 },
          posterContentType: { enum: ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/x-wmf"] },
          mimeType: { type: "string" },
          kind: { enum: ["audio", "video"] },
          output: { type: "string" },
          inPlace: { type: "boolean" },
          force: { type: "boolean" },
          dryRun: { type: "boolean" },
          ...(action === "add"
            ? {
                left: mediaLength,
                top: mediaLength,
                width: mediaLength,
                height: mediaLength,
                trimStart: { type: "integer", minimum: 0 },
                trimEnd: { type: "integer", minimum: 0 },
                loop: { type: "boolean" },
                volume: { type: "integer", minimum: 0, maximum: 100000 }
              }
            : {
                shared: { type: "boolean" },
                all: { type: "boolean" },
                allowEmpty: { type: "boolean" }
              })
        })
  };
  Object.assign(mediaSchemas, {
    [operation]: {
      description: mediaUsage,
      input: textGetSchema.input,
      options: {
        type: "object",
        additionalProperties: false,
        required:
          action === "add"
            ? ["file", "poster", "kind", "mimeType", "slide", "left", "top", "width", "height"]
            : action === "replace"
              ? ["file", "poster"]
              : ["outputDir"],
        properties
      },
      result: {
        ...textGetSchema.result,
        ...(action === "extract"
          ? {
              allOf: [
                {
                  if: { properties: { ok: { const: true } } },
                  then: { properties: { data: { type: "object" }, errors: { maxItems: 0 } } },
                  else: { properties: { errors: { minItems: 1 } } }
                }
              ]
            }
          : {}),
        properties: {
          ...textGetSchema.result.properties,
          operation: { const: operation },
          affected: { type: "integer", minimum: 0 },
          data: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required:
                  action === "extract" ? ["outputs", "dryRun"] : ["dryRun", "affectedSlides"],
                properties:
                  action === "extract"
                    ? {
                        dryRun: { const: false },
                        outputs: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "name",
                              "path",
                              "bytes",
                              "sha256",
                              "contentType",
                              "sourceParts",
                              "occurrenceIds"
                            ],
                            properties: {
                              name: { type: "string" },
                              path: { type: "string" },
                              bytes: { type: "integer", minimum: 0 },
                              sha256: { type: "string", minLength: 64, maxLength: 64 },
                              contentType: nullableString,
                              sourceParts: { type: "array", items: { type: "string" } },
                              occurrenceIds: { type: "array", items: { type: "string" } }
                            }
                          }
                        }
                      }
                    : {
                        dryRun: { type: "boolean" },
                        affectedSlides: { type: "array", items: { type: "integer", minimum: 1 } }
                      }
              }
            ]
          }
        }
      }
    }
  });
}
