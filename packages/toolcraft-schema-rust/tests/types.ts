import { compileJsonSchema, formatIssues, type CompiledJsonSchema } from "../src/index.js";
const schema: CompiledJsonSchema = compileJsonSchema(
  { $ref: "https://example.test/message" },
  {
    registry: { "https://example.test/message": { type: "object" } }
  }
);
const input = { message: "hello" };
const result = schema.validate(input);
if (result.ok) {
  const message: string = result.value.message;
  void message;
} else {
  const formatted: string = formatIssues(result.issues);
  void formatted;
}
