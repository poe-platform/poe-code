import {
  compileJsonSchema,
  formatIssues,
  normalizeLegacyNullability,
  cloneDefaultValue,
  isJsonValue,
  validate,
  projectJsonSchemaProperties,
  S,
  type CompiledJsonSchema
} from "../src/index.js";
const compatibleCompiler: typeof import("toolcraft-schema").compileJsonSchema = compileJsonSchema;
void compatibleCompiler;
const compatibleProjection: typeof import("toolcraft-schema").projectJsonSchemaProperties =
  projectJsonSchemaProperties;
void compatibleProjection;
const property = projectJsonSchemaProperties({ properties: { message: { type: "string" } } })[0];
const name: string = property.name;
const required: boolean = property.required;
const schemas: readonly unknown[] = property.schemas;
const propertyResult = property.validate("hello");
if (propertyResult.ok) {
  const value: unknown = propertyResult.value;
  void value;
}
void name;
void required;
void schemas;
const compatibleValidate: typeof import("toolcraft-schema").validate = validate;
const validated = validate(S.Object({ message: S.String(), count: S.Optional(S.Number()) }), {});
if (validated.ok) {
  const message: string = validated.value.message;
  const count: number | undefined = validated.value.count;
  void message;
  void count;
}
void compatibleValidate;
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
  const value: unknown = result.value;
  void value;
  // @ts-expect-error The JSON Schema compiler does not infer the input's type.
  const message: string = result.value.message;
  void message;
} else {
  const formatted: string = formatIssues(result.issues);
  void formatted;
}
