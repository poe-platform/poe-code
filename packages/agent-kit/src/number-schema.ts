import type { NumberSchema } from "toolcraft-schema";

export function isValidNumberSchemaValue(
  value: unknown,
  schema: NumberSchema
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (schema.jsonType !== "integer" || Number.isInteger(value))
  );
}

export function getExpectedNumberDescription(schema: NumberSchema): string {
  return schema.jsonType === "integer" ? "an integer" : "a number";
}
