import {
  compileJsonSchema,
  formatIssues,
  normalizeLegacyNullability,
  cloneDefaultValue,
  isJsonValue,
  type CompiledJsonSchema
} from "../src/index.js";
const nullableSchema: Record<string, unknown> = normalizeLegacyNullability({
  type: "string",
  nullable: true
});
void compileJsonSchema(nullableSchema);
const schema: CompiledJsonSchema = compileJsonSchema(
  { $ref: "https://example.test/message" },
  {
    registry: { "https://example.test/message": { type: "object" } },
    formats: { message: (value: string) => value.length > 0 }
  }
);
const input = { message: "hello" };
const cloned: typeof input = cloneDefaultValue(input);
const json: boolean = isJsonValue(cloned, { maxDepth: Infinity, maxNodes: 100 });
void json;
const compatibleClone: typeof import("toolcraft-schema").cloneDefaultValue = cloneDefaultValue;
const compatibleJson: typeof import("toolcraft-schema").isJsonValue = isJsonValue;
void compatibleClone;
void compatibleJson;
const result = schema.validate(input);
if (result.ok) {
  const message: string = result.value.message;
  void message;
} else {
  const formatted: string = formatIssues(result.issues);
  void formatted;
}
