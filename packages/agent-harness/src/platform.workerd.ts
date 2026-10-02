import type { FileSystem } from "@poe-code/safe-fs/contracts";
export function createDefaultFileSystem(): FileSystem { throw new Error("Harness requires an injected filesystem in Workers."); }
export function homedir(): string { throw new Error("Harness requires an explicit homeDir or snapshotPath in Workers."); }
export const cwd = (): string => "/";
export const tmpdir = (): string => "/tmp";
export function fileURLToPath(url: URL | string): string {
  const value = new URL(url);
  if (value.protocol !== "file:" || value.hostname) throw new Error("Supply an explicit template directory in Workers.");
  return decodeURIComponent(value.pathname);
}

export const hostEnvironment = { homedir, tmpdir };
