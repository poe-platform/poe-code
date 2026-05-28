import { isAbsolute, join, relative, resolve } from "node:path";
import os from "node:os";
import type { CachedData, CacheConfig } from "./types.js";

export interface DiskCacheFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
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

export async function loadFromDisk<T>(
  config: Pick<CacheConfig, "cacheDir" | "cacheName" | "staleTtl">,
  deps: DiskCacheDeps,
): Promise<CachedData<T> | null> {
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
  } catch {
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
    await deps.fs.writeFile(filePath, JSON.stringify(cached));
  } catch {
    // silently fail on write errors
  }
}

export async function removeFromDisk(
  config: Pick<CacheConfig, "cacheDir" | "cacheName">,
  deps: DiskCacheDeps,
): Promise<void> {
  try {
    const filePath = await resolveCachePath(config, deps.fs);
    await deps.fs.unlink(filePath);
  } catch {
    // silently ignore delete errors (file may not exist)
  }
}

export function resolveCacheDir(
  appName: string,
  deps?: ResolveCacheDirDeps,
): string {
  const xdgCacheHome = (deps?.env ?? process.env).XDG_CACHE_HOME;
  const home = deps?.homedir ? deps.homedir() : os.homedir();
  const cacheRoot = xdgCacheHome ?? join(home, ".cache");
  const cacheDir = join(cacheRoot, appName);

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
        throw new Error("Cache path must remain inside its configured directory.");
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

function assertContainedPath(basePath: string, targetPath: string): void {
  const relativePath = relative(resolve(basePath), resolve(targetPath));
  if (relativePath === ".." || relativePath.startsWith(`..${pathSeparator()}`) || isAbsolute(relativePath)) {
    throw new Error("Cache path must remain inside its configured directory.");
  }
}

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function isCachedData<T>(value: unknown): value is CachedData<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "data") &&
    "timestamp" in value &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp)
  );
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
