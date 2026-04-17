import path from "node:path";
import { createTimestamp, isNotFound, readFileIfExists } from "@poe-code/config-mutations";
import {
  defineScope,
  readDocument,
  readMergedDocument,
  writeScope
} from "@poe-code/poe-code-config";
import {
  parseNullablePluginConfigEntries,
  type PluginConfigEntry
} from "@poe-code/poe-agent";
import { superintendentConfigScope } from "@poe-code/superintendent";
import type { FileSystem } from "../utils/file-system.js";

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
}

export interface SaveConfigOptions extends ConfigStoreOptions {
  apiKey: string;
}

export interface ConfiguredServiceMetadata {
  files: string[];
}

interface LegacyConfigDocument {
  apiKey?: string;
  configured_services?: Record<string, ConfiguredServiceMetadata>;
}

export interface SaveConfiguredServiceOptions extends ConfigStoreOptions {
  service: string;
  metadata: ConfiguredServiceMetadata;
}

export interface UnconfigureServiceOptions extends ConfigStoreOptions {
  service: string;
}

export const coreConfigScope = defineScope("core", {
  apiKey: {
    type: "string",
    default: "",
    env: "POE_API_KEY",
    doc: "Poe API key"
  },
  poeBaseUrl: {
    type: "string",
    default: "https://api.poe.com/v1",
    env: "POE_BASE_URL",
    doc: "Poe API base URL"
  }
});

export const ralphConfigScope = defineScope("ralph", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_RALPH_PLAN_DIRECTORY",
    doc: "Custom directory for Ralph plan documents"
  },
  tui: {
    type: "boolean",
    default: false,
    env: "POE_RALPH_TUI",
    doc: "Enable the Ralph dashboard by default for terminal TTY runs"
  }
});

export const pipelineConfigScope = defineScope("pipeline", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_PIPELINE_PLAN_DIRECTORY",
    doc: "Custom directory for Pipeline plan files"
  },
  tui: {
    type: "boolean",
    default: false,
    env: "POE_PIPELINE_TUI",
    doc: "Enable the Pipeline dashboard by default for terminal TTY runs"
  }
});

export const experimentConfigScope = defineScope("experiment", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_EXPERIMENT_PLAN_DIRECTORY",
    doc: "Custom directory for Experiment doc files"
  },
  tui: {
    type: "boolean",
    default: false,
    env: "POE_EXPERIMENT_TUI",
    doc: "Enable the Experiment dashboard by default for terminal TTY runs"
  }
});

export const planConfigScope = defineScope("plan", {
  plan_directory: {
    type: "string",
    default: "docs/plans",
    env: "POE_PLAN_DIRECTORY",
    doc: "Directory where `poe-code plan <question>` writes planning documents"
  }
});

export const agentConfigScope = defineScope("agent", {
  plugins: {
    type: "json",
    default: null as PluginConfigEntry[] | null,
    parse: parseNullablePluginConfigEntries,
    doc: "Ordered poe-agent plugin registry entries. Null keeps the built-in default bundle."
  }
});

export const knownConfigScopes = [
  coreConfigScope,
  ralphConfigScope,
  pipelineConfigScope,
  experimentConfigScope,
  planConfigScope,
  agentConfigScope,
  superintendentConfigScope
] as const;

const CORE_SCOPE = coreConfigScope.scope;

export async function saveConfig(options: SaveConfigOptions): Promise<void> {
  const { fs, filePath, apiKey } = options;
  await migrateLegacyConfigIfNeeded(fs, filePath);

  const document = await readDocument(fs, filePath);
  const existingCore = document[CORE_SCOPE] ?? {};
  await writeScope(fs, filePath, CORE_SCOPE, {
    ...existingCore,
    apiKey
  });
}

export async function loadConfig(options: ConfigStoreOptions): Promise<string | null> {
  const { fs, filePath, projectFilePath } = options;
  await migrateLegacyConfigIfNeeded(fs, filePath);

  const document = await readMergedDocument(fs, filePath, projectFilePath);
  const core = document[CORE_SCOPE];
  const apiKey = typeof core?.apiKey === "string" ? core.apiKey : "";

  return apiKey.length > 0 ? apiKey : null;
}

export async function deleteConfig(options: ConfigStoreOptions): Promise<boolean> {
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
  const { fs, filePath, projectFilePath } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);

  const document = await readMergedDocument(fs, filePath, projectFilePath);
  return normalizeConfiguredServices(document[configuredServicesScope]);
}

export async function saveConfiguredService(options: SaveConfiguredServiceOptions): Promise<void> {
  const { fs, filePath, service, metadata } = options;
  await migrateLegacyConfigIfNeeded(fs, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(document[configuredServicesScope]);
  services[service] = normalizeConfiguredServiceMetadata(metadata);

  await writeScope(fs, filePath, configuredServicesScope, services);
}

export async function unconfigureService(options: UnconfigureServiceOptions): Promise<boolean> {
  const { fs, filePath, service } = options;
  await migrateLegacyConfigIfNeeded(fs, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(document[configuredServicesScope]);

  if (!(service in services)) {
    return false;
  }

  delete services[service];
  await writeScope(fs, filePath, configuredServicesScope, services);
  return true;
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

  return { files };
}

async function migrateLegacyConfigIfNeeded(fs: FileSystem, filePath: string): Promise<void> {
  await migrateLegacyCredentialsIfNeeded(fs, filePath);

  const currentRaw = await readFileIfExists(fs, filePath);
  if (currentRaw === null) {
    return;
  }

  const legacyDocument = normalizeLegacyConfigDocument(parseLegacyConfigDocument(currentRaw));
  if (!legacyDocument.apiKey) {
    return;
  }

  const document = await readDocument(fs, filePath);
  const existingCore = document[CORE_SCOPE] ?? {};
  if (typeof existingCore.apiKey === "string" && existingCore.apiKey.length > 0) {
    return;
  }

  await writeScope(fs, filePath, CORE_SCOPE, {
    ...existingCore,
    apiKey: legacyDocument.apiKey
  });
}

async function migrateLegacyCredentialsIfNeeded(fs: FileSystem, filePath: string): Promise<void> {
  const currentRaw = await readFileIfExists(fs, filePath);
  if (currentRaw !== null) {
    return;
  }

  await migrateLegacyCredentialsFile(fs, filePath);
}

async function migrateLegacyCredentialsFile(fs: FileSystem, configPath: string): Promise<void> {
  const legacyPath = path.join(path.dirname(configPath), "credentials.json");
  const raw = await readFileIfExists(fs, legacyPath);
  if (raw === null) {
    return;
  }

  let legacyDocument: LegacyConfigDocument;
  try {
    legacyDocument = normalizeLegacyConfigDocument(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      await recoverInvalidConfig(fs, legacyPath, raw);
      await fs.unlink(legacyPath);
      return;
    }
    throw error;
  }

  if (legacyDocument.configured_services) {
    await writeScope(fs, configPath, configuredServicesScope, legacyDocument.configured_services);
  }

  if (legacyDocument.apiKey) {
    await writeScope(fs, configPath, CORE_SCOPE, {
      apiKey: legacyDocument.apiKey
    });
  }

  await fs.unlink(legacyPath);
}

function parseLegacyConfigDocument(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeLegacyConfigDocument(value: unknown): LegacyConfigDocument {
  if (!isRecord(value)) {
    return {};
  }

  const document: LegacyConfigDocument = {};
  if (typeof value.apiKey === "string" && value.apiKey.length > 0) {
    document.apiKey = value.apiKey;
  }

  const services = normalizeConfiguredServices(value.configured_services);
  if (Object.keys(services).length > 0) {
    document.configured_services = services;
  }

  return document;
}

function normalizeConfiguredServices(value: unknown): Record<string, ConfiguredServiceMetadata> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Record<string, ConfiguredServiceMetadata> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }

    entries[key] = normalizeConfiguredServiceMetadata({
      files: Array.isArray(entry.files) ? entry.files : []
    });
  }

  return entries;
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
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  return path.join(directory, `${baseName}.invalid-${createTimestamp()}.json`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const configuredServicesScope = "configured_services";
const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
