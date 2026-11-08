import { isPlainRecord, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import type { ValidationError } from "./validation-errors.js";

export function validateUnionSchema(
  schema: Extract<AnySchema, { kind: "union" }>,
  value: unknown,
  label: string,
  errors: ValidationError[],
  validateBranch: (branch: ObjectSchema<any>, branchErrors: ValidationError[]) => Record<string, unknown>
): unknown {
  if (!isPlainRecord(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an object${typeof value === "object" && value !== null && !Array.isArray(value) ? ", got non-plain object" : ""}.`
    });
    return value;
  }

  const matches: Record<string, unknown>[] = [];
  const branchFailures: ValidationError[] = [];
  for (const [index, branch] of schema.branches.entries()) {
    const branchErrors: ValidationError[] = [];
    const normalized = validateBranch(branch, branchErrors);
    if (branchErrors.length === 0) {
      matches.push(normalized);
    } else {
      const firstError = branchErrors[0]!;
      branchFailures.push({ ...firstError, message: `Branch ${index + 1}: ${firstError.message}` });
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    errors.push({ path: label, message: `No union branch matched for "${label}".` }, ...branchFailures);
  } else {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected exactly one union branch, but matched ${matches.length}.`
    });
  }
  return value;
}
