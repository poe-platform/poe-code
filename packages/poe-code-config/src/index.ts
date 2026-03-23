export type {
  ConfigDocument,
  ConfigFieldType,
  ConfigStore,
  ConfigStoreOptions,
  InferConfig,
  SchemaField,
  ScopeDefinition,
  ScopedConfig,
  ScopeSchema,
  TypeMap
} from "./types.js";

export { defineScope } from "./schema.js";
export { createConfigStore } from "./config.js";
export { resolveScope } from "./resolve.js";
export { readDocument, resolveConfigPath, writeScope } from "./store.js";
