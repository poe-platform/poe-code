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
export {
  loadAgentModel,
  loadDefaultModel,
  resolveModel as resolveConfigModel,
  saveAgentModel,
  saveDefaultModel,
  type ModelsConfigOptions
} from "./models.js";
export { resolveScope } from "./resolve.js";
export {
  collectEnvOverrides,
  initProjectConfig,
  resolveEditTarget,
  type EditTargetOptions,
  type EnvOverrides
} from "./inspect.js";
export {
  readDocument,
  readMergedDocument,
  resolveConfigPath,
  resolveProjectConfigPath,
  writeScope
} from "./store.js";
