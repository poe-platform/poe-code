export const selectionQuerySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Presentation selection query version 1",
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["slide", "part", "object"] },
    scope: {
      enum: [
        "slides",
        "notes",
        "layouts",
        "masters",
        "notes-master",
        "handout-master",
        "presentation",
        "shared"
      ]
    },
    owner: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    name: { type: "string" },
    part: { type: "string", minLength: 1 },
    token: {
      type: "string",
      minLength: 1,
      description:
        "Canonical identity token emitted by inspection; validated against admitted bytes."
    },
    all: { type: "boolean" },
    position: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["coordinateSystem", "value"],
          properties: {
            coordinateSystem: { const: "one-based" },
            value: { type: "integer", minimum: 1, maximum: 9007199254740991 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["coordinateSystem", "value"],
          properties: {
            coordinateSystem: { const: "zero-based" },
            value: { type: "integer", minimum: 0, maximum: 9007199254740991 }
          }
        }
      ]
    }
  },
  oneOf: [
    {
      required: ["token"],
      not: {
        anyOf: ["scope", "owner", "position", "id", "name", "part", "all"].map((key) => ({
          required: [key]
        }))
      }
    },
    {
      required: ["kind"],
      not: { required: ["token"] },
      allOf: [
        { if: { properties: { kind: { const: "object" } } }, then: { required: ["owner"] } },
        {
          if: { properties: { kind: { const: "slide" } } },
          then: { properties: { scope: { const: "slides" } } }
        },
        { if: { required: ["part"] }, then: { properties: { kind: { const: "part" } } } },
        {
          not: {
            anyOf: [
              ["position", "id"],
              ["position", "name"],
              ["position", "part"],
              ["id", "name"],
              ["id", "part"],
              ["name", "part"]
            ].map((required) => ({ required }))
          }
        }
      ]
    }
  ]
} as const;
