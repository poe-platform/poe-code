import { UserError } from "./user-error.js";

export type ValidationError = {
  path: string;
  message: string;
};

const MAX_RENDERED_VALIDATION_ERRORS = 10;

export function throwValidationErrors(errors: readonly ValidationError[]): void {
  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw new UserError(errors[0]?.message ?? "Invalid parameters.");
  }

  const rendered = errors
    .slice(0, MAX_RENDERED_VALIDATION_ERRORS)
    .map((error) => `  - ${error.path}: ${error.message}`);
  const remaining = errors.length - rendered.length;

  if (remaining > 0) {
    rendered.push(`  … and ${remaining} more`);
  }

  throw new UserError(`${errors.length} parameter errors:\n${rendered.join("\n")}`);
}
