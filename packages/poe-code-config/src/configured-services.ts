import { randomUUID } from "node:crypto";
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
import { hasOwnErrorCode } from "./errors.js";
import { readDocument, readMergedDocument, readMergedDocumentReadonly, writeScope } from "./store.js";

export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
  projectFilePath?: string;
  providerRegistry?: Pick<ProviderRegistry, "get">;
  warn?: (message: string) => void;
  readOnly?: boolean;
}

export interface ConfiguredServiceMetadata {
  provider: string;
  apiShape?: ApiShapeId;
  files: string[];
  model?: string;
  reasoningEffort?: string;
  baseUrl?: string;
  shapeBaseUrl?: string[];
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
  if (!options.readOnly) {
    await migrateLegacyCredentialsIfNeeded(fs, filePath);
    await migrateConfiguredServiceLayers(options, [
      filePath,
      ...(projectFilePath && projectFilePath !== filePath ? [projectFilePath] : [])
    ]);
  }

  const readConfig = options.readOnly ? readMergedDocumentReadonly : readMergedDocument;
  const document = await readConfig(fs, filePath, projectFilePath);
  return normalizeConfiguredServices(getOwnEntry(document, configuredServicesScope));
}

export async function saveConfiguredService(options: SaveConfiguredServiceOptions): Promise<void> {
  const { fs, filePath, service, metadata } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);
  await migrateConfiguredServicesIfNeeded(options, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(getOwnEntry(document, configuredServicesScope));
  const registry = options.providerRegistry ?? defaultProviderRegistry;
  defineDataProperty(services, service, normalizeConfiguredServiceMetadata({
    ...metadata,
    apiShape:
      metadata.apiShape ??
      deriveApiShape({
        service,
        provider: metadata.provider,
        registry,
        warn: options.warn ?? console.warn
      })
  }));

  await writeScope(fs, filePath, configuredServicesScope, services);
}

export async function unconfigureService(options: UnconfigureServiceOptions): Promise<boolean> {
  const { fs, filePath, service } = options;
  await migrateLegacyCredentialsIfNeeded(fs, filePath);

  const document = await readDocument(fs, filePath);
  const services = normalizeConfiguredServices(getOwnEntry(document, configuredServicesScope));

  if (!Object.hasOwn(services, service)) {
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
  const migration = await prepareConfiguredServicesMigration(options, filePath);
  if (migration) {
    await writeScope(options.fs, filePath, configuredServicesScope, migration.migrated);
  }
}

async function migrateConfiguredServiceLayers(
  options: ConfigStoreOptions,
  filePaths: string[]
): Promise<void> {
  const migrations = (await Promise.all(
    filePaths.map((filePath) => prepareConfiguredServicesMigration(options, filePath))
  )).filter((migration) => migration !== undefined);
  const committed: ConfiguredServicesMigration[] = [];

  try {
    for (const migration of migrations) {
      await writeScope(options.fs, migration.filePath, configuredServicesScope, migration.migrated);
      committed.push(migration);
    }
  } catch (error) {
    for (const migration of committed.reverse()) {
      await writeScope(options.fs, migration.filePath, configuredServicesScope, migration.original).catch(() => undefined);
    }
    throw error;
  }
}

interface ConfiguredServicesMigration {
  filePath: string;
  migrated: Record<string, unknown>;
  original: Record<string, unknown>;
}

async function prepareConfiguredServicesMigration(
  options: ConfigStoreOptions,
  filePath: string
): Promise<ConfiguredServicesMigration | undefined> {
  const document = await readDocument(options.fs, filePath);
  const rawServices = getOwnEntry(document, configuredServicesScope);
  if (!isRecord(rawServices)) {
    return undefined;
  }

  let needsMigration = false;
  const migrated: Record<string, unknown> = {};
  const registry = options.providerRegistry ?? defaultProviderRegistry;

  for (const [service, entry] of Object.entries(rawServices)) {
    if (!isRecord(entry)) {
      continue;
    }

    const providerValue = getOwnEntry(entry, "provider");
    const provider = typeof providerValue === "string" ? providerValue : "poe";
    const normalizedEntry: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      defineDataProperty(normalizedEntry, key, value);
    }
    defineDataProperty(normalizedEntry, "provider", provider);

    if (typeof providerValue !== "string") {
      needsMigration = true;
    }

    const apiShapeValue = getOwnEntry(entry, "apiShape");
    if (!isApiShape(apiShapeValue)) {
      const apiShape = deriveApiShape({
        service,
        provider,
        registry,
        warn: options.warn ?? console.warn
      });
      if (apiShape) {
        defineDataProperty(normalizedEntry, "apiShape", apiShape);
        needsMigration = true;
      }
    }

    defineDataProperty(migrated, service, normalizedEntry);
  }

  if (needsMigration) {
    return {
      filePath,
      migrated,
      original: rawServices
    };
  }

  return undefined;
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

    const providerValue = getOwnEntry(entry, "provider");
    const apiShapeValue = getOwnEntry(entry, "apiShape");
    const filesValue = getOwnEntry(entry, "files");
    const modelValue = getOwnEntry(entry, "model");
    const reasoningEffortValue = getOwnEntry(entry, "reasoningEffort");
    const baseUrlValue = getOwnEntry(entry, "baseUrl");
    const shapeBaseUrlValue = getOwnEntry(entry, "shapeBaseUrl");

    defineDataProperty(entries, key, normalizeConfiguredServiceMetadata({
      provider: typeof providerValue === "string" ? providerValue : "poe",
      apiShape: isApiShape(apiShapeValue) ? apiShapeValue : undefined,
      files: Array.isArray(filesValue) ? filesValue : [],
      model: typeof modelValue === "string" ? modelValue : undefined,
      reasoningEffort: typeof reasoningEffortValue === "string" ? reasoningEffortValue : undefined,
      baseUrl: typeof baseUrlValue === "string" ? baseUrlValue : undefined,
      shapeBaseUrl: Array.isArray(shapeBaseUrlValue) ? shapeBaseUrlValue : undefined
    }));
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
    files,
    model: normalizeOptionalText(metadata.model),
    reasoningEffort: normalizeOptionalText(metadata.reasoningEffort),
    baseUrl: normalizeOptionalText(metadata.baseUrl),
    shapeBaseUrl: normalizeOptionalTextList(metadata.shapeBaseUrl)
  });
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalTextList(value: string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
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

  const configuredServices = getOwnEntry(legacyDocument, "configured_services");
  if (isRecord(configuredServices)) {
    await writeScope(fs, configPath, configuredServicesScope, configuredServices);
  }

  const apiKey = getOwnEntry(legacyDocument, "apiKey");
  if (typeof apiKey === "string" && apiKey.length > 0) {
    await writeScope(fs, configPath, CORE_SCOPE, {
      apiKey
    });
  }

  await fs.unlink(legacyPath);
}

function normalizeLegacyConfigDocument(value: unknown): LegacyConfigDocument {
  if (!isRecord(value)) {
    return {};
  }

  const document = Object.create(null) as LegacyConfigDocument;
  const apiKey = getOwnEntry(value, "apiKey");
  if (typeof apiKey === "string" && apiKey.length > 0) {
    document.apiKey = apiKey;
  }

  const services = normalizeConfiguredServices(getOwnEntry(value, "configured_services"));
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
  await writeInvalidBackup(fs, filePath, content);
  await writeFileAtomically(fs, filePath, EMPTY_DOCUMENT);
}

function createInvalidBackupPath(filePath: string): string {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  return path.join(directory, `${baseName}.invalid-${createTimestamp()}.json`);
}

async function writeInvalidBackup(fs: FileSystem, filePath: string, content: string): Promise<void> {
  const backupPath = createInvalidBackupPath(filePath);
  const backupStem = backupPath.slice(0, -".json".length);

  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? backupPath : `${backupStem}-${suffix}.json`;

    try {
      await fs.writeFile(candidate, content, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        await fs.unlink(candidate).catch(() => undefined);
        throw error;
      }
    }
  }
}

async function writeFileAtomically(fs: FileSystem, filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let tempCreated = false;

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (tempCreated || !isAlreadyExists(error)) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isApiShape(value: unknown): value is ApiShapeId {
  return (
    value === "openai-chat-completions" ||
    value === "openai-responses" ||
    value === "anthropic-messages" ||
    value === "google-generations"
  );
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
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

const agentsById = new Map(allAgents.map((agent) => [agent.id, agent]));
const defaultProviderRegistry = new ProviderRegistry([
  poeProvider,
  anthropicProvider,
  cloudflareProvider
]);
const CORE_SCOPE = "core";
const configuredServicesScope = "configured_services";
const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
