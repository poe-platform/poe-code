import { isPlainRecord, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import type { ValidationError } from "./validation-errors.js";

export function resolveDiscriminatedBranch(
  schema: Extract<AnySchema, { kind: "oneOf" }>,
  value: unknown,
  discriminatorKey: string,
  label: string,
  errors: ValidationError[]
): { discriminator: string; branch: ObjectSchema<any>; value: Record<string, unknown> } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({ path: label, message: `Invalid value for "${label}". Expected an object.` });
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const fieldLabel = label.length === 0 ? discriminatorKey : `${label}.${discriminatorKey}`;
  const branchNames = Object.keys(schema.branches);
  const expected = branchNames.length === 0
    ? "No branches are available."
    : `Expected one of: ${branchNames.join(", ")}.`;
  if (!Object.hasOwn(record, discriminatorKey)) {
    errors.push({ path: fieldLabel, message: `Missing discriminator "${fieldLabel}". ${expected}` });
    return undefined;
  }

  if (!isPlainRecord(record)) {
    errors.push({ path: label, message: `Invalid value for "${label}". Expected an object, got non-plain object.` });
    return undefined;
  }

  const discriminator = record[discriminatorKey];
  if (typeof discriminator !== "string" || !Object.hasOwn(schema.branches, discriminator)) {
    const received = typeof discriminator === "string"
      ? JSON.stringify(discriminator)
      : discriminator === null ? "null" : typeof discriminator;
    errors.push({ path: fieldLabel, message: `Invalid discriminator "${fieldLabel}": ${received}. ${expected}` });
    return undefined;
  }

  const { [discriminatorKey]: ignoredDiscriminator, ...branchValue } = record;
  void ignoredDiscriminator;
  return { discriminator, branch: schema.branches[discriminator], value: branchValue };
}
