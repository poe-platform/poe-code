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
export { deepMergeDocuments } from "./merge.js";
export { resolveScope } from "./resolve.js";
export {
  readDocument,
  readMergedDocument,
  resolveConfigPath,
  resolveProjectConfigPath,
  writeScope
} from "./store.js";
