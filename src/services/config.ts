import path from "node:path";
import { isNotFound, readFileIfExists } from "@poe-code/config-mutations";
import {
  defineScope,
  loadConfiguredServices,
  planConfigScope as sharedPlanConfigScope,
  readDocument,
  readMergedDocument,
  saveConfiguredService,
  unconfigureService,
  writeDocument,
  writeScope
} from "@poe-code/poe-code-config/core";
import type {
  ConfiguredServiceMetadata,
  SaveConfiguredServiceOptions,
  UnconfigureServiceOptions
} from "@poe-code/poe-code-config/core";
import { parseNullablePluginConfigEntries, type PluginConfigEntry } from "@poe-code/poe-agent";
import { superintendentConfigScope } from "@poe-code/superintendent";
import { codeReviewConfigScope } from "agent-code-review";
import type { FileSystem } from "../utils/file-system.js";

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
}

export interface SaveConfigOptions extends ConfigStoreOptions {
  apiKey: string;
}

interface LegacyConfigDocument {
  apiKey?: string;
  configured_services?: Record<string, ConfiguredServiceMetadata>;
}

export { loadConfiguredServices, saveConfiguredService, unconfigureService };
export type { ConfiguredServiceMetadata, SaveConfiguredServiceOptions, UnconfigureServiceOptions };

export const coreConfigScope = defineScope("core", {
  apiKey: {
    type: "string",
    default: "",
    env: "POE_API_KEY",
    doc: "Poe API key"
  },
  defaultAgent: {
    type: "string",
    default: "",
    env: "POE_DEFAULT_AGENT",
    doc: "Agent (or agent:model) used as the non-interactive --yes default when no --agent flag is provided"
  },
  poeBaseUrl: {
    type: "string",
    default: "https://api.poe.com/v1",
    env: "POE_BASE_URL",
    doc: "Poe API base URL"
  }
});

export const ralphConfigScope = defineScope("ralph", {
  "auto-archive": {
    type: "boolean",
    default: true,
    env: "POE_RALPH_AUTO_ARCHIVE",
    doc: "Archive Ralph docs after successful completion"
  },
  tui: {
    type: "boolean",
    default: false,
    env: "POE_RALPH_TUI",
    doc: "Enable the Ralph dashboard by default for terminal TTY runs"
  }
});

export const pipelineConfigScope = defineScope("pipeline", {
  "auto-archive": {
    type: "boolean",
    default: true,
    env: "POE_PIPELINE_AUTO_ARCHIVE",
    doc: "Archive pipeline plans after successful completion"
  },
  plan_directory: {
    type: "string",
    default: ".poe-code/pipeline/plans",
    env: "POE_PIPELINE_PLAN_DIRECTORY",
    doc: "Directory where pipeline plans are stored"
  },
  tui: {
    type: "boolean",
    default: false,
    env: "POE_PIPELINE_TUI",
    doc: "Enable the Pipeline dashboard by default for terminal TTY runs"
  }
});

export const gaslightConfigScope = defineScope("gaslight", {
  "auto-archive": {
    type: "boolean",
    default: false,
    env: "POE_GASLIGHT_AUTO_ARCHIVE",
    doc: "Archive Gaslight plans after all follow-up rounds succeed"
  }
});

export const experimentConfigScope = defineScope("experiment", {
  tui: {
    type: "boolean",
    default: false,
    env: "POE_EXPERIMENT_TUI",
    doc: "Enable the Experiment dashboard by default for terminal TTY runs"
  }
});

export const planConfigScope = sharedPlanConfigScope;

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
  gaslightConfigScope,
  experimentConfigScope,
  planConfigScope,
  agentConfigScope,
  superintendentConfigScope,
  codeReviewConfigScope
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
  await assertSafeConfigDeletion(fs, filePath);
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

async function assertSafeConfigDeletion(fs: FileSystem, filePath: string): Promise<void> {
  for (const target of [path.dirname(filePath), filePath]) {
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) {
        throw new Error(`Refusing configuration access through symbolic link: ${target}`);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
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
    provider: metadata.provider,
    ...(metadata.apiShape ? { apiShape: metadata.apiShape } : {}),
    files,
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {}),
    ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
    ...(metadata.shapeBaseUrl ? { shapeBaseUrl: metadata.shapeBaseUrl } : {})
  };
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
  try {
    if ((await fs.lstat(legacyPath)).isSymbolicLink()) {
      throw new Error(`Refusing legacy credentials access through symbolic link: ${legacyPath}`);
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  const raw = await readFileIfExists(fs, legacyPath);
  if (raw === null) {
    return;
  }

  let legacyDocument: LegacyConfigDocument;
  try {
    legacyDocument = normalizeLegacyConfigDocument(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return;
    }
    throw error;
  }

  const document = await readDocument(fs, configPath);
  if (legacyDocument.configured_services) {
    defineDataProperty(document, configuredServicesScope, legacyDocument.configured_services);
  }
  if (legacyDocument.apiKey) {
    defineDataProperty(document, CORE_SCOPE, { apiKey: legacyDocument.apiKey });
  }
  if (legacyDocument.configured_services || legacyDocument.apiKey) {
    await writeDocument(fs, configPath, document);
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

    defineDataProperty(entries, key, normalizeConfiguredServiceMetadata({
      provider: typeof entry.provider === "string" ? entry.provider : "poe",
      apiShape:
        typeof entry.apiShape === "string"
          ? (entry.apiShape as ConfiguredServiceMetadata["apiShape"])
          : undefined,
      files: Array.isArray(entry.files) ? entry.files : [],
      model: typeof entry.model === "string" ? entry.model : undefined,
      reasoningEffort: typeof entry.reasoningEffort === "string" ? entry.reasoningEffort : undefined,
      baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : undefined,
      shapeBaseUrl: Array.isArray(entry.shapeBaseUrl)
        ? entry.shapeBaseUrl.filter((value): value is string => typeof value === "string")
        : undefined
    }));
  }

  return entries;
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const configuredServicesScope = "configured_services";
