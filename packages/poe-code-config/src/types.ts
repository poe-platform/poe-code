import type { FileSystem } from "@poe-code/config-mutations";

export type ConfigFieldType = "string" | "number" | "boolean";

export interface TypeMap {
  string: string;
  number: number;
  boolean: boolean;
}

export interface SchemaField<T extends ConfigFieldType = ConfigFieldType> {
  type: T;
  default: TypeMap[T];
  doc: string;
  env?: string;
}

export type ScopeSchema = Record<string, SchemaField>;

export type InferConfig<S extends ScopeSchema> = {
  [K in keyof S]: TypeMap[S[K]["type"]];
};

export interface ScopeDefinition<S extends ScopeSchema> {
  scope: string;
  schema: S;
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

export type ConfigDocument = Record<string, Record<string, unknown>>;
