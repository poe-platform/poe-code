export interface ValidationIssue {
  path: readonly string[];
  expected: string;
  received: string;
  message: string;
  keyword: string;
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
export interface CompiledJsonSchema {
  validate<T>(value: T): ValidationResult<T>;
}
export interface CompileJsonSchemaOptions {
  registry?: Record<string, unknown>;
  formats?: Record<string, (value: string) => boolean>;
}
export declare function compileJsonSchema(
  schema: unknown,
  options?: CompileJsonSchemaOptions
): CompiledJsonSchema;
export declare function formatIssues(issues: readonly ValidationIssue[]): string;
export declare function normalizeLegacyNullability(schema: object): Record<string, unknown>;
