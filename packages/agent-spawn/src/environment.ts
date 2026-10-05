import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SpawnEnvironment = Record<string, string | undefined>;

export interface SafeBashEnvOptions {
  safeBash?: boolean;
  cwd?: string;
  safeBashBin?: string;
}

export function resolveSafeBashBinaryPath(overrideBin?: string): string {
  if (overrideBin && overrideBin.trim().length > 0) {
    return overrideBin.trim();
  }
  if (process.env.SAFE_BASH_BIN && process.env.SAFE_BASH_BIN.trim().length > 0) {
    return process.env.SAFE_BASH_BIN.trim();
  }
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(currentDir, "../../..");
    const shimBin = path.join(repoRoot, "scripts", "safe-bash-shim.mjs");
    if (fs.existsSync(shimBin)) {
      return shimBin;
    }
    const distBin = path.join(repoRoot, "dist", "bin", "safe-bash.js");
    if (fs.existsSync(distBin)) {
      return distBin;
    }
  } catch {
    // Fall through to ~/.local/bin/safe-bash
  }
  const homeLocalBin = path.join(os.homedir(), ".local", "bin", "safe-bash");
  if (fs.existsSync(homeLocalBin)) {
    return homeLocalBin;
  }
  return "safe-bash";
}

export function resolveSafeBashEnvOverrides(
  options: SafeBashEnvOptions
): Record<string, string> {
  if (options.safeBash !== true) {
    return {};
  }
  const cwd = options.cwd ?? process.cwd();
  return {
    SHELL: resolveSafeBashBinaryPath(options.safeBashBin),
    SAFE_BASH_WORKSPACE_ROOT: cwd,
    POE_CODE_SAFE_BASH: "1"
  };
}

export function mergeSpawnEnvironment(
  ...sources: Array<SpawnEnvironment | NodeJS.ProcessEnv | undefined>
): Record<string, string> {
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}
