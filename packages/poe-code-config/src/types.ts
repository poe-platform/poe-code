import type { FileSystem } from "@poe-code/config-mutations";

export type PrimitiveConfigFieldType = "string" | "number" | "boolean";
export type ConfigFieldType = PrimitiveConfigFieldType | "json";

export interface TypeMap {
  string: string;
  number: number;
  boolean: boolean;
}

export interface PrimitiveSchemaField<T extends PrimitiveConfigFieldType = PrimitiveConfigFieldType> {
  type: T;
  default: TypeMap[T];
  doc: string;
  env?: string;
}

export interface JsonSchemaField<T = unknown> {
  type: "json";
  default: T;
  parse: (value: unknown) => T;
  doc: string;
  env?: string;
}

export type SchemaField = PrimitiveSchemaField | JsonSchemaField;

export type InferSchemaField<T extends SchemaField> = T extends PrimitiveSchemaField<infer U>
  ? TypeMap[U]
  : T extends JsonSchemaField<infer U>
    ? U
    : never;

export type ScopeSchema = Record<string, SchemaField>;

export type InferConfig<S extends ScopeSchema> = {
  [K in keyof S]: InferSchemaField<S[K]>;
};

export interface ScopeDefinition<S extends ScopeSchema> {
  scope: string;
  schema: S;
}

export interface MemoryConfidenceConfig extends Record<string, unknown> {
  rejectUntagged?: boolean;
  minInferredConfidence?: number;
}

export interface MemoryCacheConfig extends Record<string, unknown> {
  enabled?: boolean;
  maxAgeMs?: number;
}

export interface MemoryMcpConfig extends Record<string, unknown> {
  allowWrites?: boolean;
}

export interface MemoryQueryConfig extends Record<string, unknown> {
  defaultBudgetTokens?: number;
}

export interface MemoryConfig extends Record<string, unknown> {
  ingestAgent?: string;
  ingestTimeoutMs?: number;
  maxPageBytes?: number;
  confidence?: MemoryConfidenceConfig;
  cache?: MemoryCacheConfig;
  mcp?: MemoryMcpConfig;
  query?: MemoryQueryConfig;
}

export interface ScopedConfig<S extends ScopeSchema> {
  get<K extends keyof S & string>(key: K): Promise<InferConfig<S>[K]>;
  getAll(): Promise<InferConfig<S>>;
  set<K extends keyof S & string>(key: K, value: InferConfig<S>[K]): Promise<void>;
}

export interface ConfigStore {
  scope<S extends ScopeSchema>(definition: ScopeDefinition<S>): ScopedConfig<S>;
}

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
  env?: Record<string, string | undefined>;
}

export type ConfigDocument = Record<string, Record<string, unknown>> & {
  memory?: MemoryConfig;
};
