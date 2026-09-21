import {native} from "./native.js";
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
  const type=field.type;
  if(type==="json")return coerceJson(field,value,key) as InferSchemaField<T>|undefined;
  const tag=typeof value==="string"?1:typeof value==="number"?2:typeof value==="boolean"?3:0;
  const resolved=native.configCoerce(type,tag,tag===1?value as string:"",tag===2?value as number:0,tag===3?value as boolean:false);
  return resolved===null?undefined:resolved as InferSchemaField<T>;
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
