import type {
  InferConfig,
  InferSchemaField,
  JsonSchemaField,
  SchemaField,
  ScopeSchema
} from "./types.js";

export function resolveScope<S extends ScopeSchema>(
  schema: S,
  fileValues?: Record<string, unknown>,
  env: Record<string, string | undefined> = {}
): InferConfig<S> {
  const resolved = {} as InferConfig<S>;

  for (const key of Object.keys(schema) as Array<keyof S & string>) {
    const field = schema[key];
    const envValue = resolveEnvValue(field, env, key);
    const fileValue = resolveFileValue(field, fileValues?.[key], key);
    defineDataProperty(resolved, key, (envValue ?? fileValue ?? field.default) as InferConfig<S>[typeof key]);
  }

  return resolved;
}

function defineDataProperty(object: object, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function resolveEnvValue<T extends SchemaField>(
  field: T,
  env: Record<string, string | undefined>,
  key: string
): InferSchemaField<T> | undefined {
  if (!field.env) {
    return undefined;
  }

  const raw = env[field.env];
  if (raw === undefined) {
    return undefined;
  }

  return coerceValue(field, raw, key);
}

function resolveFileValue<T extends SchemaField>(
  field: T,
  value: unknown,
  key: string
): InferSchemaField<T> | undefined {
  return coerceValue(field, value, key);
}

function coerceValue<T extends SchemaField>(
  field: T,
  value: unknown,
  key: string
): InferSchemaField<T> | undefined {
  switch (field.type) {
    case "string":
      return typeof value === "string" ? value as InferSchemaField<T> : undefined;
    case "number":
      return coerceNumber(value) as InferSchemaField<T> | undefined;
    case "boolean":
      return coerceBoolean(value) as InferSchemaField<T> | undefined;
    case "json":
      return coerceJson(field, value, key) as InferSchemaField<T> | undefined;
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

function coerceJson<T>(
  field: JsonSchemaField<T>,
  value: unknown,
  key: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsedValue = parseJsonValue(value, key);
  try {
    return field.parse(parsedValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON value.";
    throw new Error(`Invalid config value for "${key}": ${message}`);
  }
}

function parseJsonValue(value: unknown, key: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid config value for "${key}": expected valid JSON.`);
  }
}
