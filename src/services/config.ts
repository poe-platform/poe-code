import path from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { FileSystem } from "../utils/file-system.js";

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
}

export interface SaveConfigOptions extends ConfigStoreOptions {
  apiKey: string;
}

export interface ConfiguredServiceMetadata {
  files: string[];
}

/**
 * Default model configuration keyed by tool name, endpoint path, or "global".
 * - "global": fallback for all tools with no specific default
 * - "<tool-name>" (e.g. "codex"): default for a specific tool
 * - "<endpoint>" (e.g. "/v1/responses"): default for a specific API endpoint
 */
export type DefaultModelsConfig = Record<string, string>;

interface ConfigDocument {
  apiKey?: string;
  configured_services?: Record<string, ConfiguredServiceMetadata>;
  default_models?: DefaultModelsConfig;
}

export interface SaveConfiguredServiceOptions
  extends ConfigStoreOptions {
  service: string;
  metadata: ConfiguredServiceMetadata;
}

export interface UnconfigureServiceOptions
  extends ConfigStoreOptions {
  service: string;
}

export interface SaveDefaultModelOptions extends ConfigStoreOptions {
  /** Key identifying the scope: "global", a tool name, or an endpoint path */
  key: string;
  model: string;
}

export interface ResolveDefaultModelOptions extends ConfigStoreOptions {
  /** Tool name or endpoint to check for a specific default before falling back to "global" */
  key: string;
}

export async function saveConfig(
  options: SaveConfigOptions
): Promise<void> {
  const { fs, filePath, apiKey } = options;
  const document = await readConfigDocument(fs, filePath);
  document.apiKey = apiKey;
  await writeConfigDocument(fs, filePath, document);
}

export async function loadConfig(
  options: ConfigStoreOptions
): Promise<string | null> {
  const { fs, filePath } = options;
  const document = await readConfigDocument(fs, filePath);
  return typeof document.apiKey === "string" && document.apiKey.length > 0
    ? document.apiKey
    : null;
}

export async function deleteConfig(
  options: ConfigStoreOptions
): Promise<boolean> {
  const { fs, filePath } = options;
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export async function loadConfiguredServices(
  options: ConfigStoreOptions
): Promise<Record<string, ConfiguredServiceMetadata>> {
  const { fs, filePath } = options;
  const document = await readConfigDocument(fs, filePath);
  return { ...(document.configured_services ?? {}) };
}

export async function saveConfiguredService(
  options: SaveConfiguredServiceOptions
): Promise<void> {
  const { fs, filePath, service, metadata } = options;
  const document = await readConfigDocument(fs, filePath);
  const normalized = normalizeConfiguredServiceMetadata(metadata);
  document.configured_services = {
    ...(document.configured_services ?? {}),
    [service]: normalized
  };
  await writeConfigDocument(fs, filePath, document);
}

export async function unconfigureService(
  options: UnconfigureServiceOptions
): Promise<boolean> {
  const { fs, filePath, service } = options;
  const document = await readConfigDocument(fs, filePath);
  const services = document.configured_services;
  if (!services || !(service in services)) {
    return false;
  }
  delete services[service];
  if (Object.keys(services).length === 0) {
    delete document.configured_services;
  }
  await writeConfigDocument(fs, filePath, document);
  return true;
}

export async function saveDefaultModel(
  options: SaveDefaultModelOptions
): Promise<void> {
  const { fs, filePath, key, model } = options;
  const document = await readConfigDocument(fs, filePath);
  document.default_models = {
    ...(document.default_models ?? {}),
    [key]: model
  };
  await writeConfigDocument(fs, filePath, document);
}

export async function loadDefaultModels(
  options: ConfigStoreOptions
): Promise<DefaultModelsConfig> {
  const { fs, filePath } = options;
  const document = await readConfigDocument(fs, filePath);
  return { ...(document.default_models ?? {}) };
}

/**
 * Resolves the configured default model for a given key.
 * Lookup order: key-specific → "global" → null
 */
export async function resolveDefaultModel(
  options: ResolveDefaultModelOptions
): Promise<string | null> {
  const defaults = await loadDefaultModels(options);
  return defaults[options.key] ?? defaults["global"] ?? null;
}

function normalizeConfiguredServiceMetadata(
  metadata: ConfiguredServiceMetadata
): ConfiguredServiceMetadata {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const entry of metadata.files ?? []) {
    if (typeof entry !== "string" || entry.length === 0) {
      continue;
    }
    if (!seen.has(entry)) {
      files.push(entry);
      seen.add(entry);
    }
  }
  return {
    files
  };
}

async function readConfigDocument(
  fs: FileSystem,
  filePath: string
): Promise<ConfigDocument> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return await parseConfigDocument(fs, filePath, raw);
  } catch (error) {
    if (isNotFound(error)) {
      return migrateLegacyCredentialsFile(fs, filePath);
    }
    throw error;
  }
}

async function migrateLegacyCredentialsFile(
  fs: FileSystem,
  configPath: string
): Promise<ConfigDocument> {
  const legacyPath = path.join(path.dirname(configPath), "credentials.json");
  try {
    const raw = await fs.readFile(legacyPath, "utf8");
    const document = await parseConfigDocument(fs, legacyPath, raw);
    await writeConfigDocument(fs, configPath, document);
    await fs.unlink(legacyPath);
    return document;
  } catch {
    return {};
  }
}

async function parseConfigDocument(
  fs: FileSystem,
  filePath: string,
  raw: string
): Promise<ConfigDocument> {
  try {
    const parsed = JSON.parse(raw);
    return normalizeConfigDocument(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      await recoverInvalidConfig(fs, filePath, raw);
      return {};
    }
    throw error;
  }
}

function normalizeConfigDocument(value: unknown): ConfigDocument {
  if (!isRecord(value)) {
    return {};
  }
  const document: ConfigDocument = {};
  if (typeof value.apiKey === "string" && value.apiKey.length > 0) {
    document.apiKey = value.apiKey;
  }
  const services = normalizeConfiguredServices(value.configured_services);
  if (Object.keys(services).length > 0) {
    document.configured_services = services;
  }
  const defaultModels = normalizeDefaultModels(value.default_models);
  if (Object.keys(defaultModels).length > 0) {
    document.default_models = defaultModels;
  }
  return document;
}

function normalizeDefaultModels(value: unknown): DefaultModelsConfig {
  if (!isRecord(value)) {
    return {};
  }
  const result: DefaultModelsConfig = {};
  for (const [key, model] of Object.entries(value)) {
    if (typeof model === "string" && model.length > 0 && key.length > 0) {
      result[key] = model;
    }
  }
  return result;
}

function normalizeConfiguredServices(
  value: unknown
): Record<string, ConfiguredServiceMetadata> {
  if (!isRecord(value)) {
    return {};
  }
  const entries: Record<string, ConfiguredServiceMetadata> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    const normalized = normalizeConfiguredServiceMetadata({
      files: Array.isArray(entry.files) ? entry.files : []
    });
    entries[key] = normalized;
  }
  return entries;
}

async function writeConfigDocument(
  fs: FileSystem,
  filePath: string,
  document: ConfigDocument
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: ConfigDocument = {};
  if (document.apiKey) {
    payload.apiKey = document.apiKey;
  }
  if (document.configured_services) {
    payload.configured_services = document.configured_services;
  }
  if (document.default_models && Object.keys(document.default_models).length > 0) {
    payload.default_models = document.default_models;
  }
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8"
  });
}

async function recoverInvalidConfig(
  fs: FileSystem,
  filePath: string,
  content: string
): Promise<void> {
  const backupPath = createInvalidBackupPath(filePath);
  await fs.writeFile(backupPath, content, { encoding: "utf8" });
  await fs.writeFile(filePath, EMPTY_DOCUMENT, { encoding: "utf8" });
}

function createInvalidBackupPath(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `${base}.invalid-${timestamp}.json`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}


const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
