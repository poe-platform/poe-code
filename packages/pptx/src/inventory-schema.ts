const styleSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["part", "layer", "path"],
  properties: { part: { type: "string" }, layer: { type: "string" }, path: { type: "string" } }
} as const;
const styleValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "token", "status", "source", "references", "reason"],
  properties: {
    value: { type: ["string", "number", "boolean", "null"] },
    token: { type: ["string", "null"] },
    status: { enum: ["resolved", "unresolved", "absent"] },
    source: { anyOf: [styleSourceSchema, { type: "null" }] },
    references: { type: "array", items: styleSourceSchema },
    reason: { type: ["string", "null"] }
  }
} as const;

export const inventorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "slides",
    "textStyles",
    "masters",
    "layouts",
    "themes",
    "parts",
    "media",
    "relationships",
    "unsupported",
    "features",
    "counts"
  ],
  properties: {
    textStyles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part", "shapeId", "paragraph", "run", "properties"],
        properties: {
          part: { type: "string" },
          shapeId: { type: "string" },
          paragraph: { type: "integer", minimum: 0 },
          run: { type: ["integer", "null"], minimum: 0 },
          properties: {
            type: "object",
            additionalProperties: false,
            required: [
              "bold",
              "italic",
              "size",
              "latin",
              "eastAsia",
              "complex",
              "color",
              "language",
              "underline",
              "strike",
              "baseline",
              "capitalization",
              "spacing",
              "highlight"
            ],
            properties: Object.fromEntries(
              [
                "bold",
                "italic",
                "size",
                "latin",
                "eastAsia",
                "complex",
                "color",
                "language",
                "underline",
                "strike",
                "baseline",
                "capitalization",
                "spacing",
                "highlight"
              ].map((key) => [key, styleValueSchema])
            )
          }
        }
      }
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "part", "position", "shapeCount", "layout", "master", "theme", "show"],
        properties: {
          id: { type: "string" },
          part: { type: "string" },
          position: { type: "integer", minimum: 1 },
          shapeCount: { type: "integer", minimum: 0 },
          layout: { type: ["string", "null"] },
          master: { type: ["string", "null"] },
          theme: { type: ["string", "null"] },
          show: {
            type: "object",
            additionalProperties: false,
            required: ["explicit", "effective"],
            properties: { explicit: { type: ["boolean", "null"] }, effective: { type: "boolean" } }
          }
        }
      }
    },
    masters: { type: "array", items: { type: "string" } },
    layouts: { type: "array", items: { type: "string" } },
    themes: { type: "array", items: { type: "string" } },
    parts: { type: "array", items: { $ref: "#/$defs/inventoryPart" } },
    media: { type: "array", items: { $ref: "#/$defs/inventoryPart" } },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "id", "type", "target", "external", "targetPart"],
        properties: {
          owner: { type: "string" },
          id: { type: "string" },
          type: { type: "string" },
          target: { type: "string" },
          external: { type: "boolean" },
          targetPart: { type: ["string", "null"] }
        }
      }
    },
    unsupported: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part", "reason"],
        properties: { part: { type: "string" }, reason: { type: "string" } }
      }
    },
    features: {
      type: "object",
      additionalProperties: false,
      required: ["structure", "slideVisibility", "effectiveFormatting", "mediaMetadata", "editing"],
      properties: {
        structure: { const: true },
        slideVisibility: { const: true },
        effectiveFormatting: { const: false },
        mediaMetadata: { const: false },
        editing: { const: false }
      }
    },
    counts: {
      type: "object",
      additionalProperties: false,
      required: ["slides", "masters", "layouts", "themes", "slideShapes", "parts", "media"],
      properties: {
        slides: { type: "integer", minimum: 0 },
        masters: { type: "integer", minimum: 0 },
        layouts: { type: "integer", minimum: 0 },
        themes: { type: "integer", minimum: 0 },
        slideShapes: { type: "integer", minimum: 0 },
        parts: { type: "integer", minimum: 0 },
        media: { type: "integer", minimum: 0 }
      }
    }
  }
} as const;

export const inventoryPartSchema = {
  type: "object",
  additionalProperties: false,
  required: ["part", "contentType", "bytes", "sha256"],
  properties: {
    part: { type: "string" },
    contentType: { type: ["string", "null"] },
    bytes: { type: "integer", minimum: 0 },
    sha256: { type: "string", minLength: 64, maxLength: 64 }
  }
} as const;
