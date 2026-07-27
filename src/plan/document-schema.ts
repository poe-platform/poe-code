type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

type JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: JsonSchemaType | readonly JsonSchemaType[];
  const?: unknown;
  default?: unknown;
  enum?: readonly unknown[];
  minimum?: number;
  minLength?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
};

export const planDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json";

export const planDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: planDocumentSchemaId,
  title: "Generic plan document",
  type: "object",
  properties: {
    readiness: {
      type: "string",
      enum: ["draft", "ready"]
    },
    kind: {
      type: "string",
      const: "plan"
    }
  },
  required: ["kind"],
  additionalProperties: true
};
