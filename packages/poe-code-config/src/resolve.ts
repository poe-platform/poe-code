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
    const fileValue = resolveFileValue(field, getOwnRecordValue(fileValues, key), key);
    const value = envValue ?? fileValue;
    defineDataProperty(
      resolved,
      key,
      (value === undefined ? cloneValue(field.default) : value) as InferConfig<S>[typeof key]
    );
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

function getOwnRecordValue(
  record: Record<string, unknown> | undefined,
  key: string
): unknown | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    defineDataProperty(clone, key, cloneValue(entry));
  }
  return clone as T;
}

function resolveEnvValue<T extends SchemaField>(
  field: T,
  env: Record<string, string | undefined>,
  key: string
): InferSchemaField<T> | undefined {
  if (!field.env) {
    return undefined;
  }

  const raw = getOwnRecordValue(env, field.env);
  if (raw === undefined) {
    return undefined;
  }

  return typeof raw === "string" ? coerceValue(field, raw, key) : undefined;
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
  return Number.isFinite(parsed) ? parsed : undefined;
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
