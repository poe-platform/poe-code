import type { NumberSchema } from "toolcraft-schema";

export function isValidNumberSchemaValue(value: unknown, schema: NumberSchema): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (schema.jsonType !== "integer" || Number.isInteger(value)) &&
    (schema.minimum === undefined || value >= schema.minimum) &&
    (schema.maximum === undefined || value <= schema.maximum)
  );
}

export function getExpectedNumberDescription(schema: NumberSchema): string {
  const type = schema.jsonType === "integer" ? "an integer" : "a number";
  const bounds = [
    schema.minimum === undefined ? undefined : `greater than or equal to ${schema.minimum}`,
    schema.maximum === undefined ? undefined : `less than or equal to ${schema.maximum}`
  ].filter((bound): bound is string => bound !== undefined);

  return bounds.length === 0 ? type : `${type} ${bounds.join(" and ")}`;
}
