import path from "node:path";
import { allAgents, resolveAgentId, type AgentDefinition } from "@poe-code/agent-defs";
import { createTimestamp, readFileIfExists, type FileSystem } from "@poe-code/config-mutations";
import {
  anthropicProvider,
  cloudflareProvider,
  poeProvider,
  ProviderRegistry,
  resolveApiShape,
  type ApiShapeId
} from "@poe-code/providers";
import { readDocument, readMergedDocument, writeScope } from "./store.js";

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
  providerRegistry?: Pick<ProviderRegistry, "get">;
  warn?: (message: string) => void;
}

export interface ConfiguredServiceMetadata {
  provider: string;
  apiShape?: ApiShapeId;
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

export async function loadConfiguredServices(
  options: ConfigStoreOptions
): Promise<Record<string, ConfiguredServiceMetadata>> {
  const { fs, filePath, projectFilePath } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);
  await migrateConfiguredServicesIfNeeded(options, filePath);
  if (projectFilePath && projectFilePath !== filePath) {
    await migrateConfiguredServicesIfNeeded(options, projectFilePath);
  }

  const document = await readMergedDocument(fs, filePath, projectFilePath);
  return normalizeConfiguredServices(document[configuredServicesScope]);
}

export async function saveConfiguredService(options: SaveConfiguredServiceOptions): Promise<void> {
  const { fs, filePath, service, metadata } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);
  await migrateConfiguredServicesIfNeeded(options, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(document[configuredServicesScope]);
  const registry = options.providerRegistry ?? defaultProviderRegistry;
  services[service] = normalizeConfiguredServiceMetadata({
    ...metadata,
    apiShape:
      metadata.apiShape ??
      deriveApiShape({
        service,
        provider: metadata.provider,
        registry,
        warn: options.warn ?? console.warn
      })
  });

  await writeScope(fs, filePath, configuredServicesScope, services);
}

export async function unconfigureService(options: UnconfigureServiceOptions): Promise<boolean> {
  const { fs, filePath, service } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(document[configuredServicesScope]);

  if (!(service in services)) {
    return false;
  }

  delete services[service];
  await writeScope(fs, filePath, configuredServicesScope, services);
  return true;
}

async function migrateConfiguredServicesIfNeeded(
  options: ConfigStoreOptions,
  filePath: string
): Promise<void> {
  const document = await readDocument(options.fs, filePath);
  const rawServices = document[configuredServicesScope];
  if (!isRecord(rawServices)) {
    return;
  }

  let needsMigration = false;
  const migrated: Record<string, unknown> = {};
  const registry = options.providerRegistry ?? defaultProviderRegistry;

  for (const [service, entry] of Object.entries(rawServices)) {
    if (!isRecord(entry)) {
      continue;
    }

    const provider = typeof entry.provider === "string" ? entry.provider : "poe";
    const normalizedEntry: Record<string, unknown> = {
      ...entry,
      provider
    };

    if (typeof entry.provider !== "string") {
      needsMigration = true;
    }

    if (typeof entry.apiShape !== "string") {
      const apiShape = deriveApiShape({
        service,
        provider,
        registry,
        warn: options.warn ?? console.warn
      });
      if (apiShape) {
        normalizedEntry.apiShape = apiShape;
        needsMigration = true;
      }
    }

    migrated[service] = normalizedEntry;
  }

  if (needsMigration) {
    await writeScope(options.fs, filePath, configuredServicesScope, migrated);
  }
}

function deriveApiShape(input: {
  service: string;
  provider: string;
  registry: Pick<ProviderRegistry, "get">;
  warn: (message: string) => void;
}): ApiShapeId | undefined {
  const provider = input.registry.get(input.provider);
  const agent = resolveConfiguredAgent(input.service);
  const apiShape = provider && agent ? resolveApiShape(provider, agent) : undefined;
  if (!apiShape) {
    input.warn(
      `Unable to derive apiShape for configured service "${input.service}" with provider "${input.provider}".`
    );
  }
  return apiShape;
}

function resolveConfiguredAgent(service: string): AgentDefinition | undefined {
  const agentId = resolveAgentId(service);
  return agentId ? agentsById.get(agentId) : undefined;
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
      provider: typeof entry.provider === "string" ? entry.provider : "poe",
      apiShape: typeof entry.apiShape === "string" ? (entry.apiShape as ApiShapeId) : undefined,
      files: Array.isArray(entry.files) ? entry.files : []
    });
  }

  return entries;
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

  return omitUndefined({
    provider: metadata.provider,
    apiShape: metadata.apiShape,
    files
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

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const agentsById = new Map(allAgents.map((agent) => [agent.id, agent]));
const defaultProviderRegistry = new ProviderRegistry([
  poeProvider,
  anthropicProvider,
  cloudflareProvider
]);
const CORE_SCOPE = "core";
const configuredServicesScope = "configured_services";
const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
