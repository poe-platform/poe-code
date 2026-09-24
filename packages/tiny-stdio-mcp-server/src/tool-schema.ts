import { compileJsonSchema, normalizeLegacyNullability, type StandardIssue, type StandardResult, type StandardSchema } from "toolcraft-schema";
import { ToolError, JSON_RPC_ERROR_CODES, type OutputSchema } from "./types.js";

export type PreparedToolSchema = {
  schema: OutputSchema;
} & ({
  standard: false;
  validate(value: unknown): StandardResult<unknown>;
} | {
  standard: true;
  validate(value: unknown): StandardResult<unknown> | Promise<StandardResult<unknown>>;
});

export function prepareToolSchema(source: unknown, io: "input" | "output"): PreparedToolSchema {
  try {
    let standard: StandardSchema["~standard"] | undefined;
    if (((typeof source === "object" && source !== null) || typeof source === "function") && "~standard" in source) {
      standard = source["~standard"] as StandardSchema["~standard"];
      if (standard?.version !== 1 || typeof standard.validate !== "function") {
        throw new Error("Expected Standard Schema v1 validation");
      }
      if (typeof standard.jsonSchema?.[io] !== "function") {
        throw new Error("Expected Standard JSON Schema v1 conversion; upgrade the schema library or provide a JSON Schema");
      }
    }
    const document = standard === undefined ? source : standard.jsonSchema[io]({ target: "draft-2020-12" });
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      throw new Error(`${io}Schema must be a JSON Schema object`);
    }
    const schema = normalizeLegacyNullability(document) as OutputSchema;
    const compiled = compileJsonSchema(schema);
    if (standard !== undefined) return {
      schema,
      standard: true,
      async validate(value) {
        try { return await standard.validate(value); }
        catch { throw new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR, "Tool schema validation failed"); }
      }
    };
    return {
      schema,
      standard: false,
      validate(value) {
        const result = compiled.validate(value);
        return result.ok ? { value: result.value } : { issues: result.issues };
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${io} schema is invalid: ${message}`, { cause: error });
  }
}

export function formatToolIssues(issues: readonly StandardIssue[]): string {
  return issues.map((issue) => {
    const path = issue.path?.map((segment) => String(typeof segment === "object" ? segment.key : segment)).join("/");
    return `${path ? `data/${path}` : "data"} ${issue.message}`;
  }).join(", ");
}
