import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type { CachedData, CacheConfig } from "./types.js";

export interface DiskCacheFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding; flag?: string },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  realpath(path: string): Promise<string>;
}

interface DiskCacheDeps {
  fs: DiskCacheFs;
}

interface ResolveCacheDirDeps {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
}

const TEMP_WRITE_MAX_ATTEMPTS = 3;
const CACHE_PATH_ERROR_MESSAGE = "Cache path must remain inside its configured directory.";

class DiskCacheConfigError extends Error {}

export async function loadFromDisk<T>(
  config: Pick<CacheConfig, "cacheDir" | "cacheName" | "staleTtl">,
  deps: DiskCacheDeps,
): Promise<CachedData<T> | null> {
  if (!Number.isFinite(config.staleTtl) || config.staleTtl < 0) {
    throw new Error("staleTtl must be a finite non-negative number");
  }

  try {
    const filePath = await resolveCachePath(config, deps.fs);
    const content = await deps.fs.readFile(filePath, "utf8");
    const cached = JSON.parse(content) as unknown;

    if (!isCachedData<T>(cached) || cached.timestamp > Date.now()) {
      return null;
    }

    if (Date.now() - cached.timestamp > config.staleTtl) {
      return null;
    }

    return cached;
  } catch (error) {
    if (error instanceof DiskCacheConfigError) {
      throw error;
    }
    return null;
  }
}

export async function persist<T>(
  data: T,
  config: Pick<CacheConfig, "cacheDir" | "cacheName">,
  deps: DiskCacheDeps,
): Promise<void> {
  try {
    await deps.fs.mkdir(config.cacheDir, { recursive: true });
    const filePath = await resolveCachePath(config, deps.fs);
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
    };
    await writeCacheFile(filePath, JSON.stringify(cached), deps.fs);
  } catch (error) {
    if (error instanceof DiskCacheConfigError) {
      throw error;
    }
    // Disk cache writes are best-effort; callers can still use memory or bundled data.
    return;
  }
}

export async function removeFromDisk(
  config: Pick<CacheConfig, "cacheDir" | "cacheName">,
  deps: DiskCacheDeps,
): Promise<void> {
  try {
    const filePath = await resolveCachePath(config, deps.fs);
    await deps.fs.unlink(filePath);
  } catch (error) {
    if (error instanceof Error && error.message === "Cache path must remain inside its configured directory.") {
      return;
    }
    if (!hasCode(error, "ENOENT")) {
      throw error;
    }
  }
}

export function resolveCacheDir(
  appName: string,
  deps?: ResolveCacheDirDeps,
): string {
  const xdgCacheHome = getOwnEnvValue(deps?.env ?? process.env, "XDG_CACHE_HOME");
  const home = deps?.homedir ? deps.homedir() : os.homedir();
  const cacheRoot = xdgCacheHome && xdgCacheHome.trim().length > 0
    ? xdgCacheHome
    : join(home, ".cache");
  if (!isAbsolute(cacheRoot)) {
    throw new Error("XDG_CACHE_HOME must be an absolute path");
  }

  const normalizedAppName = appName.trim();
  assertSafeAppName(normalizedAppName);
  const cacheDir = join(cacheRoot, normalizedAppName);

  assertContainedPath(cacheRoot, cacheDir);
  return cacheDir;
}

async function resolveCachePath(
  config: Pick<CacheConfig, "cacheDir" | "cacheName">,
  fs: DiskCacheFs,
): Promise<string> {
  const cachePath = join(config.cacheDir, `${config.cacheName}.json`);
  assertContainedPath(config.cacheDir, cachePath);

  let existingPath = cachePath;
  while (true) {
    try {
      const canonicalExistingPath = await fs.realpath(existingPath);
      const canonicalCacheDir = await fs.realpath(config.cacheDir);
      if (canonicalCacheDir !== resolve(config.cacheDir)) {
        throw new DiskCacheConfigError(CACHE_PATH_ERROR_MESSAGE);
      }
      assertContainedPath(canonicalCacheDir, canonicalExistingPath);
      return cachePath;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
      const parentPath = resolve(existingPath, "..");
      if (parentPath === existingPath) {
        throw error;
      }
      existingPath = parentPath;
    }
  }
}

async function writeCacheFile(
  filePath: string,
  content: string,
  fs: DiskCacheFs,
): Promise<void> {
  for (let attempt = 1; attempt <= TEMP_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await writeCacheFileOnce(`${filePath}.${randomUUID()}.tmp`, filePath, content, fs);
      return;
    } catch (error) {
      if (hasCode(error, "EEXIST") && attempt < TEMP_WRITE_MAX_ATTEMPTS) {
        continue;
      }

      throw error;
    }
  }
}

async function writeCacheFileOnce(
  temporaryPath: string,
  filePath: string,
  content: string,
  fs: DiskCacheFs,
): Promise<void> {
  let temporaryCreated = false;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (temporaryCreated || !hasCode(error, "EEXIST")) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function assertContainedPath(basePath: string, targetPath: string): void {
  const relativePath = relative(resolve(basePath), resolve(targetPath));
  if (relativePath === ".." || relativePath.startsWith(`..${pathSeparator()}`) || isAbsolute(relativePath)) {
    throw new DiskCacheConfigError(CACHE_PATH_ERROR_MESSAGE);
  }
}

function assertSafeAppName(appName: string): void {
  if (
    appName.length === 0 ||
    appName === "." ||
    appName === ".." ||
    appName.includes("/") ||
    appName.includes("\\")
  ) {
    throw new Error("appName must be a single non-empty directory name");
  }
}

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function isCachedData<T>(value: unknown): value is CachedData<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "data") &&
    Object.hasOwn(record, "timestamp") &&
    typeof record.timestamp === "number" &&
    Number.isFinite(record.timestamp)
  );
}

function getOwnEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
