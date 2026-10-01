import type { AnySchema, Static } from "./index.js";
export type SchemaDescriptor = AnySchema;
export type ValidationIssue = {
  path: readonly string[];
  expected: string;
  received: string;
  message: string;
  keyword?: string;
};
export type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      issues: readonly ValidationIssue[];
    };
export interface ValidationOptions {
  defaults?: "none" | "optional" | "all";
}
export declare function validate<S extends SchemaDescriptor>(
  schema: S,
  value: unknown,
  options?: ValidationOptions
): ValidationResult<Static<S>>;
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
