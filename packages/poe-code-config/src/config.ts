import { readDocument, writeScope } from "./store.js";
import { resolveScope } from "./resolve.js";
import type {
  ConfigStore,
  ConfigStoreOptions,
  InferConfig,
  ScopedConfig,
  ScopeDefinition,
  ScopeSchema
} from "./types.js";

export function createConfigStore(
  options: ConfigStoreOptions
): ConfigStore {
  const env = options.env ?? {};

  return {
    scope<S extends ScopeSchema>(definition: ScopeDefinition<S>): ScopedConfig<S> {
      return {
        async get<K extends keyof S & string>(key: K) {
          const resolved = await resolveScopedValues(options, definition, env);
          return resolved[key];
        },

        async getAll() {
          return resolveScopedValues(options, definition, env);
        },

        async set<K extends keyof S & string>(key: K, value: InferConfig<S>[K]) {
          const document = await readDocument(options.fs, options.filePath);
          const currentValues = document[definition.scope] ?? {};
          await writeScope(options.fs, options.filePath, definition.scope, {
            ...currentValues,
            [key]: value
          });
        }
      };
    }
  };
}

async function resolveScopedValues<S extends ScopeSchema>(
  options: ConfigStoreOptions,
  definition: ScopeDefinition<S>,
  env: Record<string, string | undefined>
): Promise<InferConfig<S>> {
  const document = await readDocument(options.fs, options.filePath);
  return resolveScope(definition.schema, document[definition.scope], env);
}
