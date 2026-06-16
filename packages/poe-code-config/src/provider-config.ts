import type { FileSystem } from "@poe-code/config-mutations";
import type { ApiShapeId } from "@poe-code/providers";
import { readDocument, readDocumentReadonly, writeScope } from "./store.js";

export interface ProviderConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
}

export interface LoadProviderShapeBaseUrlsOptions extends ProviderConfigStoreOptions {
  providerId: string;
  readOnly?: boolean;
}

export interface SaveProviderShapeBaseUrlsOptions extends ProviderConfigStoreOptions {
  providerId: string;
  shapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}

export async function loadProviderShapeBaseUrls(
  options: LoadProviderShapeBaseUrlsOptions
): Promise<Partial<Record<ApiShapeId, string>>> {
  const readConfig = options.readOnly ? readDocumentReadonly : readDocument;
  const document = await readConfig(options.fs, options.filePath);
  const providers = getOwnRecordEntry(document, providersScope);
  const providerConfig = getOwnRecordEntry(providers, options.providerId);
  if (Object.keys(providerConfig).length === 0) {
    return {};
  }

  return normalizeShapeBaseUrls(getOwnEntry(providerConfig, "shapeBaseUrls"));
}

export async function saveProviderShapeBaseUrls(
  options: SaveProviderShapeBaseUrlsOptions
): Promise<void> {
  const shapeBaseUrls = normalizeShapeBaseUrls(options.shapeBaseUrls);
  if (Object.keys(shapeBaseUrls).length === 0) {
    return;
  }

  const document = await readDocument(options.fs, options.filePath);
  const providers = getOwnRecordEntry(document, providersScope);
  const providerConfig = getOwnRecordEntry(providers, options.providerId);
  const existingShapeBaseUrls = normalizeShapeBaseUrls(
    getOwnEntry(providerConfig, "shapeBaseUrls")
  );

  await writeScope(options.fs, options.filePath, providersScope, {
    ...providers,
    [options.providerId]: {
      ...providerConfig,
      shapeBaseUrls: {
        ...existingShapeBaseUrls,
        ...shapeBaseUrls
      }
    }
  });
}

function normalizeShapeBaseUrls(value: unknown): Partial<Record<ApiShapeId, string>> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Partial<Record<ApiShapeId, string>> = {};
  for (const [shapeId, baseUrl] of Object.entries(value)) {
    if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
      entries[shapeId as ApiShapeId] = baseUrl.trim();
    }
  }
  return entries;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnRecordEntry(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = getOwnEntry(record, key);
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const providersScope = "providers";
