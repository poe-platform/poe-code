import type { ValidationIssue, ValidationResult } from "./validate.js";

export interface CompileJsonSchemaOptions {
  registry?: Record<string, unknown>;
  formats?: Readonly<Record<string, (value: string) => boolean>>;
}

export interface CompiledJsonSchema {
  validate(value: unknown): ValidationResult<unknown>;
}

export declare function compileJsonSchema(
  schema: unknown,
  options?: CompileJsonSchemaOptions
): CompiledJsonSchema;
export declare function formatIssues(issues: readonly ValidationIssue[]): string;
export declare function normalizeLegacyNullability(source: object): Record<string, unknown>;
