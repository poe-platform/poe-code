import type { FileSystem } from "@poe-code/config-mutations";
import type { ApiShapeId } from "@poe-code/providers";
import { readDocument, writeScope } from "./store.js";

export interface ProviderConfigStoreOptions {
  fs: FileSystem;
  filePath: string;
}

export interface LoadProviderShapeBaseUrlsOptions extends ProviderConfigStoreOptions {
  providerId: string;
}

export interface SaveProviderShapeBaseUrlsOptions extends ProviderConfigStoreOptions {
  providerId: string;
  shapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}

export async function loadProviderShapeBaseUrls(
  options: LoadProviderShapeBaseUrlsOptions
): Promise<Partial<Record<ApiShapeId, string>>> {
  const document = await readDocument(options.fs, options.filePath);
  const providers = document[providersScope];
  if (!isRecord(providers)) {
    return {};
  }

  const providerConfig = providers[options.providerId];
  if (!isRecord(providerConfig)) {
    return {};
  }

  return normalizeShapeBaseUrls(providerConfig.shapeBaseUrls);
}

export async function saveProviderShapeBaseUrls(
  options: SaveProviderShapeBaseUrlsOptions
): Promise<void> {
  const shapeBaseUrls = normalizeShapeBaseUrls(options.shapeBaseUrls);
  if (Object.keys(shapeBaseUrls).length === 0) {
    return;
  }

  const document = await readDocument(options.fs, options.filePath);
  const providers = isRecord(document[providersScope]) ? document[providersScope] : {};
  const rawProviderConfig = providers[options.providerId];
  const providerConfig: Record<string, unknown> = isRecord(rawProviderConfig)
    ? rawProviderConfig
    : {};
  const existingShapeBaseUrls = normalizeShapeBaseUrls(providerConfig.shapeBaseUrls);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const providersScope = "providers";
