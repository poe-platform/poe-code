import type { ScopeDefinition, ScopeSchema } from "./types.js";

export function defineScope<const S extends ScopeSchema>(
  scope: string,
  schema: S
): ScopeDefinition<S> {
  return {
    scope,
    schema
  };
}

export { runtimeConfigScope } from "./runtime.js";
