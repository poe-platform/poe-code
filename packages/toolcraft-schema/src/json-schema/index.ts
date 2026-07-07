import type { ValidationIssue } from "../validate.js";
import { compileGraph } from "./compiler.js";
import { evaluateSchema } from "./evaluate.js";
import type { CompileJsonSchemaOptions, CompiledJsonSchema } from "./types.js";

export type { CompileJsonSchemaOptions, CompiledJsonSchema } from "./types.js";

export function compileJsonSchema(
  schema: unknown,
  options: CompileJsonSchemaOptions = {}
): CompiledJsonSchema {
  const graph = compileGraph(schema, options);
  return {
    validate(value: unknown) {
      const result = evaluateSchema(graph, value);
      return result.valid ? { ok: true, value } : { ok: false, issues: result.issues };
    }
  };
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((current) => {
      const path = current.path.length === 0 ? "data" : `data/${current.path.join("/")}`;
      return `${path} ${current.message}`;
    })
    .join(", ");
}
