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
export declare function compileJsonSchema(schema: unknown): CompiledJsonSchema;
export declare function formatIssues(issues: readonly ValidationIssue[]): string;
