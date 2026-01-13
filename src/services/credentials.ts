import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";

export interface CredentialsStoreOptions {
  fs: FileSystem;
  filePath: string;
}

export interface SaveCredentialsOptions extends CredentialsStoreOptions {
  apiKey: string;
}

export interface ConfiguredServiceMetadata {
  files: string[];
}

interface CredentialsDocument {
  apiKey?: string;
  configured_services?: Record<string, ConfiguredServiceMetadata>;
}

export interface SaveConfiguredServiceOptions
  extends CredentialsStoreOptions {
  service: string;
  metadata: ConfiguredServiceMetadata;
}

export interface UnconfigureServiceOptions
  extends CredentialsStoreOptions {
  service: string;
}

export async function saveCredentials(
  options: SaveCredentialsOptions
): Promise<void> {
  const { fs, filePath, apiKey } = options;
  const document = await readCredentialsDocument(fs, filePath);
  document.apiKey = apiKey;
  await writeCredentialsDocument(fs, filePath, document);
}

export async function loadCredentials(
  options: CredentialsStoreOptions
): Promise<string | null> {
  const { fs, filePath } = options;
  const document = await readCredentialsDocument(fs, filePath);
  return typeof document.apiKey === "string" && document.apiKey.length > 0
    ? document.apiKey
    : null;
}

export async function deleteCredentials(
  options: CredentialsStoreOptions
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
  options: CredentialsStoreOptions
): Promise<Record<string, ConfiguredServiceMetadata>> {
  const { fs, filePath } = options;
  const document = await readCredentialsDocument(fs, filePath);
  return { ...(document.configured_services ?? {}) };
}

export async function saveConfiguredService(
  options: SaveConfiguredServiceOptions
): Promise<void> {
  const { fs, filePath, service, metadata } = options;
  const document = await readCredentialsDocument(fs, filePath);
  const normalized = normalizeConfiguredServiceMetadata(metadata);
  document.configured_services = {
    ...(document.configured_services ?? {}),
    [service]: normalized
  };
  await writeCredentialsDocument(fs, filePath, document);
}

export async function unconfigureService(
  options: UnconfigureServiceOptions
): Promise<boolean> {
  const { fs, filePath, service } = options;
  const document = await readCredentialsDocument(fs, filePath);
  const services = document.configured_services;
  if (!services || !(service in services)) {
    return false;
  }
  delete services[service];
  if (Object.keys(services).length === 0) {
    delete document.configured_services;
  }
  await writeCredentialsDocument(fs, filePath, document);
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
  return {
    files
  };
}

async function readCredentialsDocument(
  fs: FileSystem,
  filePath: string
): Promise<CredentialsDocument> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return await parseCredentialsDocument(fs, filePath, raw);
  } catch (error) {
    if (isNotFound(error)) {
      return {};
    }
    throw error;
  }
}

async function parseCredentialsDocument(
  fs: FileSystem,
  filePath: string,
  raw: string
): Promise<CredentialsDocument> {
  try {
    const parsed = JSON.parse(raw);
    return normalizeCredentialsDocument(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      await recoverInvalidCredentials(fs, filePath, raw);
      return {};
    }
    throw error;
  }
}

function normalizeCredentialsDocument(value: unknown): CredentialsDocument {
  if (!isRecord(value)) {
    return {};
  }
  const document: CredentialsDocument = {};
  if (typeof value.apiKey === "string" && value.apiKey.length > 0) {
    document.apiKey = value.apiKey;
  }
  const services = normalizeConfiguredServices(value.configured_services);
  if (Object.keys(services).length > 0) {
    document.configured_services = services;
  }
  return document;
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

async function writeCredentialsDocument(
  fs: FileSystem,
  filePath: string,
  document: CredentialsDocument
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: CredentialsDocument = {};
  if (document.apiKey) {
    payload.apiKey = document.apiKey;
  }
  if (document.configured_services) {
    payload.configured_services = document.configured_services;
  }
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8"
  });
}

async function recoverInvalidCredentials(
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
