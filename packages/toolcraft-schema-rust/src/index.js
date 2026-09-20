import { createRequire } from "node:module";

const { NativeCompiledSchema } = createRequire(import.meta.url)("./toolcraft-schema-rust.node");

export function compileJsonSchema(schema, options = {}) {
  const compiled = new NativeCompiledSchema(schema, options);
  return {
    validate(value) {
      const result = compiled.validate(value);
      return result.ok ? { ok: true, value } : result;
    }
  };
}

export function formatIssues(issues) {
  return issues
    .map(
      (issue) =>
        `${issue.path.length === 0 ? "data" : `data/${issue.path.join("/")}`} ${issue.message}`
    )
    .join(", ");
}
