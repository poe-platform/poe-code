import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { UserError } from "toolcraft";
import { hasOwnErrorCode } from "./error-codes.js";
import {
  fetchOpenApiHttpSource,
  OpenApiTimeoutError,
  OpenApiTransportError,
  parseOpenApiDocument,
  type OpenApiSourceFileSystem
} from "./spec-source.js";
import type { OpenApiDocument } from "./generate.js";
import { redactSensitiveQueryValues } from "./redaction.js";

export const DEFAULT_OPENAPI_FETCH_TIMEOUT_MS = 3_000;
export const DEFAULT_OPENAPI_CACHE_MAX_AGE_MS = 5 * 60_000;

export interface OpenApiSpecCacheOptions {
  directory?: string;
  maxAgeMs?: number;
  onFallback?: (message: string) => void | Promise<void>;
}

export interface LoadCachedOpenApiSourceOptions {
  cache: false | OpenApiSpecCacheOptions;
  fetch: typeof globalThis.fetch;
  fs: OpenApiSpecCacheFileSystem;
  onTimeout?: (context: OpenApiTimeoutContext) => void | Promise<void>;
  timeoutMs?: number;
}

export interface OpenApiTimeoutContext {
  source: string;
  timeoutMs: number;
  usingCachedDocument: boolean;
}

export interface OpenApiSpecCacheFileSystem extends OpenApiSourceFileSystem {
  writeFile?(
    filePath: string,
    contents: string,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  rename?(fromPath: string, toPath: string): Promise<void>;
  mkdir?(directoryPath: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  unlink?(filePath: string): Promise<void>;
  realpath?(filePath: string): Promise<string>;
}

export interface LoadedOpenApiSource {
  sourceText: string;
  document: OpenApiDocument;
  commit?: () => Promise<void>;
}

interface OpenApiSpecCacheEntry {
  version: 1;
  sourceText: string;
  validatedAt: number;
  maxAgeMs: number;
  etag?: string;
}

interface ParsedOpenApiSpecCacheEntry {
  entry: OpenApiSpecCacheEntry;
  document: OpenApiDocument;
}

interface OpenApiCacheFileSystemWithRealpath extends OpenApiSpecCacheFileSystem {
  realpath(filePath: string): Promise<string>;
}

interface WritableOpenApiCacheFileSystem extends OpenApiCacheFileSystemWithRealpath {
  writeFile(
    filePath: string,
    contents: string,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  mkdir(directoryPath: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  unlink(filePath: string): Promise<void>;
}

export async function loadCachedOpenApiSource(
  inputUrl: URL,
  options: LoadCachedOpenApiSourceOptions
): Promise<LoadedOpenApiSource> {
  validateTimeout(options.timeoutMs);

  if (options.cache === false) {
    let result: Awaited<ReturnType<typeof fetchOpenApiHttpSource>>;
    try {
      result = await fetchOpenApiHttpSource(inputUrl, options.fetch, {
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      notifyTimeout(options, inputUrl, error, false);
      throw error;
    }
    if (result.status === "not-modified") {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: received 304 without a cached document.`
      );
    }
    return {
      sourceText: result.sourceText,
      document: parseOpenApiDocument(result.sourceText, inputUrl)
    };
  }

  validateMaxAge(options.cache.maxAgeMs);
  const directory = resolveCacheDirectory(options.cache.directory);
  const cachePath = resolveCachePath(inputUrl, directory);
  const cached = await readCacheEntry(cachePath, options.fs);
  const now = Date.now();
  const freshnessMs = cached?.entry.maxAgeMs;

  if (
    cached !== null &&
    cached.entry.validatedAt <= now &&
    freshnessMs !== undefined &&
    now - cached.entry.validatedAt < freshnessMs
  ) {
    return {
      sourceText: cached.entry.sourceText,
      document: cached.document
    };
  }

  let result: Awaited<ReturnType<typeof fetchOpenApiHttpSource>>;
  try {
    result = await fetchOpenApiHttpSource(inputUrl, options.fetch, {
      ...(cached?.entry.etag === undefined ? {} : { etag: cached.entry.etag }),
      timeoutMs: options.timeoutMs
    });
  } catch (error) {
    notifyTimeout(options, inputUrl, error, cached !== null);
    if (!(error instanceof OpenApiTransportError) || cached === null) {
      throw error;
    }

    notifyFallback(options.cache, inputUrl, error);
    return {
      sourceText: cached.entry.sourceText,
      document: cached.document
    };
  }

  const writableFs = getWritableFileSystem(options.fs);
  if (result.status === "not-modified") {
    if (cached === null) {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: received 304 without a cached document.`
      );
    }
    if (cached.entry.etag === undefined) {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: received 304 without a cached validator.`
      );
    }

    const policy =
      result.cacheControl === undefined
        ? {
            store: true,
            maxAgeMs: Math.max(
              0,
              cached.entry.maxAgeMs - (parseDeltaSeconds(result.age ?? "") ?? 0) * 1_000
            )
          }
        : resolveCachePolicy(
            result.cacheControl,
            result.age,
            options.cache.maxAgeMs,
            cached.entry.maxAgeMs
          );
    if (!policy.store) {
      return {
        sourceText: cached.entry.sourceText,
        document: cached.document,
        ...(writableFs === null ? {} : { commit: () => removeCacheEntry(cachePath, writableFs) })
      };
    }

    const entry: OpenApiSpecCacheEntry = {
      ...cached.entry,
      validatedAt: now,
      maxAgeMs: policy.maxAgeMs,
      ...(result.etag === undefined ? {} : { etag: result.etag })
    };
    return {
      sourceText: cached.entry.sourceText,
      document: cached.document,
      ...(writableFs === null
        ? {}
        : { commit: () => persistCacheEntry(cachePath, entry, writableFs) })
    };
  }

  const policy = resolveCachePolicy(
    result.cacheControl,
    result.age,
    options.cache.maxAgeMs,
    DEFAULT_OPENAPI_CACHE_MAX_AGE_MS
  );
  const document = parseOpenApiDocument(result.sourceText, inputUrl);
  if (!policy.store) {
    return {
      sourceText: result.sourceText,
      document,
      ...(writableFs === null ? {} : { commit: () => removeCacheEntry(cachePath, writableFs) })
    };
  }

  const entry: OpenApiSpecCacheEntry = {
    version: 1,
    sourceText: result.sourceText,
    validatedAt: now,
    maxAgeMs: policy.maxAgeMs,
    ...(result.etag === undefined ? {} : { etag: result.etag })
  };
  return {
    sourceText: result.sourceText,
    document,
    ...(writableFs === null
      ? {}
      : { commit: () => persistCacheEntry(cachePath, entry, writableFs) })
  };
}

function notifyTimeout(
  options: LoadCachedOpenApiSourceOptions,
  inputUrl: URL,
  error: unknown,
  usingCachedDocument: boolean
): void {
  if (!(error instanceof OpenApiTimeoutError) || options.onTimeout === undefined) {
    return;
  }

  try {
    void Promise.resolve(
      options.onTimeout({
        source: redactSensitiveQueryValues(inputUrl.toString()),
        timeoutMs: error.timeoutMs,
        usingCachedDocument
      })
    ).catch(() => undefined);
  } catch {
    // A presentation hook cannot change source-loading behavior.
  }
}

function resolveCachePolicy(
  cacheControl: string | undefined,
  age: string | undefined,
  configuredMaxAgeMs: number | undefined,
  fallbackMaxAgeMs: number
): { store: boolean; maxAgeMs: number } {
  const directives = (cacheControl ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());

  if (directives.includes("no-store")) {
    return { store: false, maxAgeMs: 0 };
  }
  if (directives.includes("no-cache")) {
    return { store: true, maxAgeMs: 0 };
  }

  for (const directive of directives) {
    if (!directive.startsWith("max-age=")) {
      continue;
    }
    const seconds = parseDeltaSeconds(directive.slice("max-age=".length));
    if (seconds !== null) {
      const responseAge = parseDeltaSeconds(age ?? "") ?? 0;
      return { store: true, maxAgeMs: Math.max(0, seconds - responseAge) * 1_000 };
    }
  }

  return {
    store: true,
    maxAgeMs: configuredMaxAgeMs ?? fallbackMaxAgeMs
  };
}

function parseDeltaSeconds(value: string): number | null {
  const trimmed = value.trim();
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  if (unquoted.length === 0) {
    return null;
  }

  const seconds = Number(unquoted);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function resolveCacheDirectory(configuredDirectory: string | undefined): string {
  const envDirectory = readOwnEnvValue(process.env, "TOOLCRAFT_OPENAPI_CACHE_DIR");
  const xdgCacheHome = readOwnEnvValue(process.env, "XDG_CACHE_HOME");
  const directory = configuredDirectory ?? envDirectory;

  if (directory !== undefined) {
    if (!path.isAbsolute(directory)) {
      throw new UserError("OpenAPI cache directory must be an absolute path.");
    }
    return directory;
  }

  const cacheRoot = xdgCacheHome ?? path.join(os.homedir(), ".cache");
  if (!path.isAbsolute(cacheRoot)) {
    throw new UserError("XDG_CACHE_HOME must be an absolute path.");
  }
  return path.join(cacheRoot, "toolcraft-openapi", "specs");
}

function resolveCachePath(inputUrl: URL, directory: string): string {
  const canonicalUrl = new URL(inputUrl);
  canonicalUrl.hash = "";
  const key = createHash("sha256").update(canonicalUrl.toString()).digest("hex");
  return path.join(directory, `${key}.json`);
}

async function readCacheEntry(
  cachePath: string,
  fs: OpenApiSpecCacheFileSystem
): Promise<ParsedOpenApiSpecCacheEntry | null> {
  if (!hasRealpath(fs)) {
    return null;
  }

  try {
    await assertSafeCachePath(cachePath, fs);
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as unknown;
    if (!isCacheEntry(parsed)) {
      return null;
    }
    return {
      entry: sanitizeCacheEntry(parsed),
      document: parseOpenApiDocument(parsed.sourceText, cachePath)
    };
  } catch {
    return null;
  }
}

function sanitizeCacheEntry(entry: OpenApiSpecCacheEntry): OpenApiSpecCacheEntry {
  if (entry.etag === undefined || isValidEtag(entry.etag)) {
    return entry;
  }

  const withoutEtag = { ...entry };
  delete withoutEtag.etag;
  return withoutEtag;
}

function isValidEtag(etag: string): boolean {
  try {
    new Headers({ "If-None-Match": etag });
    return true;
  } catch {
    return false;
  }
}

async function persistCacheEntry(
  cachePath: string,
  entry: OpenApiSpecCacheEntry,
  fs: WritableOpenApiCacheFileSystem
): Promise<void> {
  try {
    await assertSafeCachePath(cachePath, fs);
    await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    await assertSafeCachePath(cachePath, fs);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
      let temporaryCreated = false;
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(entry), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        temporaryCreated = true;
        await fs.rename(temporaryPath, cachePath);
        return;
      } catch (error) {
        if (temporaryCreated || !hasOwnErrorCode(error, "EEXIST")) {
          await fs.unlink(temporaryPath).catch(() => undefined);
        }
        if (!hasOwnErrorCode(error, "EEXIST")) {
          return;
        }
      }
    }
  } catch {
    // Cache writes are best-effort; the materialized live document remains usable.
  }
}

async function removeCacheEntry(
  cachePath: string,
  fs: WritableOpenApiCacheFileSystem
): Promise<void> {
  try {
    await assertSafeCachePath(cachePath, fs);
    await fs.unlink(cachePath);
  } catch {
    // Cache removal is best-effort; the materialized live document remains usable.
  }
}

function getWritableFileSystem(
  fs: OpenApiSpecCacheFileSystem
): WritableOpenApiCacheFileSystem | null {
  if (
    typeof fs.writeFile !== "function" ||
    typeof fs.rename !== "function" ||
    typeof fs.mkdir !== "function" ||
    typeof fs.unlink !== "function" ||
    typeof fs.realpath !== "function"
  ) {
    return null;
  }

  return fs as WritableOpenApiCacheFileSystem;
}

function hasRealpath(fs: OpenApiSpecCacheFileSystem): fs is OpenApiCacheFileSystemWithRealpath {
  return typeof fs.realpath === "function";
}

async function assertSafeCachePath(
  cachePath: string,
  fs: OpenApiCacheFileSystemWithRealpath
): Promise<void> {
  const directory = path.resolve(path.dirname(cachePath));
  let existingPath = directory;

  while (true) {
    try {
      if (path.resolve(await fs.realpath(existingPath)) !== existingPath) {
        throw new UserError("OpenAPI cache path must remain inside its configured directory.");
      }
      break;
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      existingPath = parentPath;
    }
  }

  try {
    if (path.resolve(await fs.realpath(directory)) !== directory) {
      throw new UserError("OpenAPI cache path must remain inside its configured directory.");
    }
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  try {
    const canonicalCachePath = path.resolve(await fs.realpath(cachePath));
    if (canonicalCachePath !== path.resolve(cachePath)) {
      throw new UserError("OpenAPI cache path must remain inside its configured directory.");
    }
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isCacheEntry(value: unknown): value is OpenApiSpecCacheEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    Object.hasOwn(entry, "version") &&
    entry.version === 1 &&
    Object.hasOwn(entry, "sourceText") &&
    typeof entry.sourceText === "string" &&
    Object.hasOwn(entry, "validatedAt") &&
    typeof entry.validatedAt === "number" &&
    Number.isFinite(entry.validatedAt) &&
    Object.hasOwn(entry, "maxAgeMs") &&
    typeof entry.maxAgeMs === "number" &&
    Number.isFinite(entry.maxAgeMs) &&
    entry.maxAgeMs >= 0 &&
    (!Object.hasOwn(entry, "etag") || typeof entry.etag === "string")
  );
}

function notifyFallback(cache: OpenApiSpecCacheOptions, inputUrl: URL, error: unknown): void {
  if (cache.onFallback === undefined) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  try {
    void Promise.resolve(
      cache.onFallback(
        `Using cached OpenAPI document for ${JSON.stringify(redactSensitiveQueryValues(inputUrl.toString()))} because refresh failed: ${message}`
      )
    ).catch(() => undefined);
  } catch {
    // Cache fallback remains usable even if a presentation callback fails.
  }
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new UserError("OpenAPI fetch timeout must be a finite non-negative number.");
  }
}

function validateMaxAge(maxAgeMs: number | undefined): void {
  if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
    throw new UserError("OpenAPI cache maxAgeMs must be a finite non-negative number.");
  }
}

function readOwnEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, key)) {
    return undefined;
  }
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}
