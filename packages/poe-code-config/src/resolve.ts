import type {
  InferConfig,
  SchemaField,
  ScopeSchema,
  TypeMap
} from "./types.js";

export function resolveScope<S extends ScopeSchema>(
  schema: S,
  fileValues?: Record<string, unknown>,
  env: Record<string, string | undefined> = {}
): InferConfig<S> {
  const resolved = {} as InferConfig<S>;

  for (const key of Object.keys(schema) as Array<keyof S & string>) {
    const field = schema[key];
    const envValue = resolveEnvValue(field, env);
    const fileValue = resolveFileValue(field, fileValues?.[key]);
    resolved[key] = (envValue ?? fileValue ?? field.default) as InferConfig<S>[typeof key];
  }

  return resolved;
}

function resolveEnvValue<T extends SchemaField>(
  field: T,
  env: Record<string, string | undefined>
): TypeMap[T["type"]] | undefined {
  if (!field.env) {
    return undefined;
  }

  const raw = env[field.env];
  if (raw === undefined) {
    return undefined;
  }

  return coerceValue(field, raw);
}

function resolveFileValue<T extends SchemaField>(
  field: T,
  value: unknown
): TypeMap[T["type"]] | undefined {
  return coerceValue(field, value);
}

function coerceValue<T extends SchemaField>(
  field: T,
  value: unknown
): TypeMap[T["type"]] | undefined {
  switch (field.type) {
    case "string":
      return typeof value === "string" ? value as TypeMap[T["type"]] : undefined;
    case "number":
      return coerceNumber(value) as TypeMap[T["type"]] | undefined;
    case "boolean":
      return coerceBoolean(value) as TypeMap[T["type"]] | undefined;
  }
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return undefined;
}
