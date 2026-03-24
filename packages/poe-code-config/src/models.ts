import type { FileSystem } from "@poe-code/config-mutations";
import { readDocument, writeScope } from "./store.js";

const SCOPE = "models";
const DEFAULT_KEY = "default";

export interface ModelsConfigOptions {
  fs: FileSystem;
  filePath: string;
}

export async function loadAgentModel(
  options: ModelsConfigOptions,
  agentId: string
): Promise<string | null> {
  const models = await readModelsScope(options);
  const value = models[agentId];
  return typeof value === "string" ? value : null;
}

export async function loadDefaultModel(
  options: ModelsConfigOptions
): Promise<string | null> {
  const models = await readModelsScope(options);
  const value = models[DEFAULT_KEY];
  return typeof value === "string" ? value : null;
}

export async function resolveModel(
  options: ModelsConfigOptions,
  agentId: string
): Promise<string | null> {
  return (await loadAgentModel(options, agentId)) ?? await loadDefaultModel(options);
}

export async function saveAgentModel(
  options: ModelsConfigOptions,
  agentId: string,
  model: string
): Promise<void> {
  const models = await readModelsScope(options);
  await writeScope(options.fs, options.filePath, SCOPE, {
    ...models,
    [agentId]: model
  });
}

export async function saveDefaultModel(
  options: ModelsConfigOptions,
  model: string
): Promise<void> {
  const models = await readModelsScope(options);
  await writeScope(options.fs, options.filePath, SCOPE, {
    ...models,
    [DEFAULT_KEY]: model
  });
}

async function readModelsScope(
  options: ModelsConfigOptions
): Promise<Record<string, unknown>> {
  const document = await readDocument(options.fs, options.filePath);
  return document[SCOPE] ?? {};
}
