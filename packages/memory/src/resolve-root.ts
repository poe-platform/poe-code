import path from "node:path";
import type { FileSystem } from "@poe-code/config-mutations";
import { configuredMemoryRoot } from "@poe-code/poe-code-config";
import { resolveMemoryRoot } from "./paths.js";
import type { MemoryRoot } from "./types.js";

export const MEMORY_ROOT_ENV_VAR = "POE_CODE_MEMORY_ROOT";

export interface ResolveConfiguredMemoryRootOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  fs: FileSystem;
  configPath: string;
  projectConfigPath?: string;
}

export async function resolveConfiguredMemoryRoot(
  options: ResolveConfiguredMemoryRootOptions
): Promise<MemoryRoot> {
  const envOverride = options.env[MEMORY_ROOT_ENV_VAR]?.trim();
  if (envOverride && envOverride.length > 0) {
    return resolveAgainstCwd(options.cwd, envOverride);
  }

  const configOverride = (
    await configuredMemoryRoot({
      fs: options.fs,
      filePath: options.configPath,
      projectFilePath: options.projectConfigPath
    })
  )?.trim();
  if (configOverride && configOverride.length > 0) {
    return resolveAgainstCwd(options.cwd, configOverride);
  }

  return resolveMemoryRoot(options.cwd);
}

function resolveAgainstCwd(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}
