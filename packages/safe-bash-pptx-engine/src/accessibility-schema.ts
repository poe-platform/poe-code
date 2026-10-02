import { inspectSchema, textGetSchema } from "./command-schema.js";

export const accessibilityUsage =
  "Usage: pptx accessibility list|get|set INPUT [selection] [output]\n" +
  "Selection: --slide N --shape NAME | --select TOKEN; --scope slides|layouts|masters; --all for set.\n" +
  "Metadata: --alt-text TEXT --title TEXT --decorative true|false. Empty text clears text.\n" +
  "Alt text is the object description. Decorative uses the supported Office drawing extension.\n" +
  "Reports missing/duplicate slide titles and structural object order.\n" +
  "No accessibility certification, visual reading order or contrast measurement.\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Common: --json --limit NAME=VALUE; set accepts --allow-empty.\n";
const source = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["part", "shapeId", "inherited"],
      properties: {
        part: { type: "string" },
        shapeId: { type: "string" },
        inherited: { type: "boolean" }
      }
    }
  ]
};
const object = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "part",
    "location",
    "token",
    "title",
    "altText",
    "description",
    "decorative",
    "provenance",
    "structuralOrder",
    "inheritedBy"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    part: { type: "string" },
    token: { type: "string" },
    location: inspectSchema.result.properties.locations.items,
    title: { type: ["string", "null"] },
    altText: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    decorative: { type: ["boolean", "null"] },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "decorative"],
      properties: { title: source, description: source, decorative: source }
    },
    structuralOrder: { type: "integer", minimum: 1 },
    inheritedBy: { type: "array", items: { type: "integer", minimum: 1 } }
  }
};
export const accessibilitySchemas = Object.fromEntries(
  ["list", "get", "set"].map((action) => {
    const mutation = action === "set";
    return [
      `accessibility.${action}`,
      {
        description: accessibilityUsage,
        input: inspectSchema.input,
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...textGetSchema.options.properties,
            scope: { enum: ["slides", "layouts", "masters"] },
            ...(mutation
              ? {
                  altText: { type: "string" },
                  title: { type: "string" },
                  decorative: { type: "boolean" },
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
            ...(mutation
              ? [
                  { anyOf: ["altText", "title", "decorative"].map((key) => ({ required: [key] })) },
                  {
                    anyOf: [
                      { required: ["slide"] },
                      { required: ["select"] },
                      { required: ["all"], properties: { all: { const: true } } }
                    ]
                  },
                  {
                    if: { required: ["select"] },
                    then: { not: { required: ["all"], properties: { all: { const: true } } } }
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
            operation: { const: `accessibility.${action}` },
            data: {
              oneOf: [
                { type: "null" },
                mutation
                  ? {
                      type: "object",
                      additionalProperties: false,
                      required: ["dryRun", "affectedSlides"],
                      properties: {
                        dryRun: { type: "boolean" },
                        affectedSlides: { type: "array", items: { type: "integer", minimum: 1 } }
                      }
                    }
                  : {
                      type: "object",
                      additionalProperties: false,
                      required: ["objects", "slides", "order", "limitations"],
                      properties: {
                        objects: { type: "array", items: object },
                        order: { const: "structural" },
                        limitations: { type: "array", items: { type: "string" } },
                        slides: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "slide",
                              "part",
                              "titles",
                              "missingTitle",
                              "duplicateTitle",
                              "multipleTitles"
                            ],
                            properties: {
                              slide: { type: "integer", minimum: 1 },
                              part: { type: "string" },
                              titles: { type: "array", items: { type: "string" } },
                              missingTitle: { type: "boolean" },
                              duplicateTitle: { type: "boolean" },
                              multipleTitles: { type: "boolean" }
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
