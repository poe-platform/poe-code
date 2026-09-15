import { cloneDefaultValue, validate, type AnySchema } from "toolcraft-schema";
import { getUnfilteredSchema } from "./schema-scope.js";
import type { ValidationError } from "./validation-errors.js";

export function validateAppliedDefault(schema: AnySchema, label: string, errors: ValidationError[]): unknown {
  if (schema.default === undefined) {
    return undefined;
  }

  const value = cloneDefaultValue(schema.default);
  const validation = validate(getUnfilteredSchema(schema), value, { defaults: "none" });
  if (!validation.ok) {
    errors.push({
      path: label,
      message: `Invalid default for "${label}". ${validation.issues[0]?.message ?? "Default does not satisfy schema."}`
    });
  }
  return value;
}
