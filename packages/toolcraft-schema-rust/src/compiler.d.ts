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

export interface JsonSchemaProperty {
  readonly name: string;
  /** Required regardless of the object's selected alternative or condition. */
  readonly required: boolean;
  /** Isolated annotation/schema copies, including resolved references. */
  readonly schemas: readonly unknown[];
  /** Candidate hint; validate the complete object to enforce composition rules. */
  validate(value: unknown): ValidationResult<unknown>;
}
export declare function projectJsonSchemaProperties(
  schema: unknown,
  options?: CompileJsonSchemaOptions
): readonly JsonSchemaProperty[];
