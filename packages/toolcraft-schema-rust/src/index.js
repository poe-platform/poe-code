import { createRequire } from "node:module";

const { NativeCompiledSchema } = createRequire(import.meta.url)("./toolcraft-schema-rust.node");

export function compileJsonSchema(schema, options = {}) {
  if (Object.keys(options).length !== 0)
    throw new Error("Schema compilation options are not yet implemented");
  const compiled = new NativeCompiledSchema(schema);
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
