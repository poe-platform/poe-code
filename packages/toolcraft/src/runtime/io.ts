import { access, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { HandlerEnv, HandlerFs } from "../index.js";

export const RESERVED_SERVICE_NAMES = new Set([
  "params",
  "secrets",
  "fetch",
  "fs",
  "env",
  "diagnostics",
  "progress",
  "runtimeOptions",
  "root"
]);

const RESERVED_SERVICE_NAMES_MESSAGE =
  "Available reserved names: params, secrets, fetch, fs, env, diagnostics, progress, runtimeOptions, root.";

export function createFs(fs?: HandlerFs): HandlerFs {
  if (fs !== undefined) {
    return fs;
  }

  return {
    readFile: async (path: string, encoding = "utf8") => readFile(path, { encoding }),
    writeFile: async (
      path: string,
      contents: string,
      options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
    ) => {
      await writeFile(path, contents, options);
    },
    exists: async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    lstat: async (path: string) => lstat(path),
    rename: async (fromPath: string, toPath: string) => rename(fromPath, toPath),
    unlink: async (path: string) => unlink(path)
  };
}

export function createEnv(values: Record<string, string | undefined> = process.env): HandlerEnv {
  return {
    get(key: string): string | undefined {
      return values[key];
    }
  };
}

export function validateServices(services: object): void {
  for (const name of Object.keys(services)) {
    if (RESERVED_SERVICE_NAMES.has(name)) {
      throw new Error(
        `Service name "${name}" is reserved. Choose a different name. ${RESERVED_SERVICE_NAMES_MESSAGE}`
      );
    }
  }
}
