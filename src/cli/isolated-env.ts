import path from "node:path";
import type { CliEnvironment } from "./environment.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  IsolatedEnvPath,
  IsolatedEnvVariable,
  IsolatedEnvValue,
  ProviderIsolatedEnv
} from "./service-registry.js";

export interface IsolatedEnvDetails {
  agentBinary: string;
  env: Record<string, string>;
  configProbePath?: string;
}

export function resolveIsolatedEnvDetails(
  env: CliEnvironment,
  isolated: ProviderIsolatedEnv,
  providerName?: string
): IsolatedEnvDetails {
  if (!providerName) {
    throw new Error("resolveIsolatedEnvDetails requires providerName.");
  }
  const baseDir = resolveIsolatedBaseDir(env, providerName);
  const requiresConfig = isolated.requiresConfig !== false;
  if (requiresConfig && !isolated.configProbe) {
    throw new Error(
      `resolveIsolatedEnvDetails requires configProbe when requiresConfig is true (provider "${providerName}").`
    );
  }
  return {
    agentBinary: isolated.agentBinary,
    env: resolveIsolatedEnvVars(env, baseDir, isolated.env),
    configProbePath: isolated.configProbe
      ? resolveIsolatedEnvPath(env, baseDir, isolated.configProbe)
      : undefined
  };
}

export function resolveIsolatedTargetDirectory(input: {
  targetDirectory: string;
  isolated: ProviderIsolatedEnv;
  env: CliEnvironment;
  providerName: string;
}): string {
  const expanded = expandHomeShortcut(input.env, input.targetDirectory);
  const baseDir = resolveIsolatedBaseDir(input.env, input.providerName);

  const homeDir = input.env.homeDir;
  const homeDirWithSep = `${homeDir}${path.sep}`;
  if (expanded !== homeDir && !expanded.startsWith(homeDirWithSep)) {
    throw new Error(
      `Isolated config targets must live under the user's home directory (received "${input.targetDirectory}").`
    );
  }

  if (expanded === baseDir) {
    return baseDir;
  }
  if (expanded === homeDir) {
    return baseDir;
  }
  if (!expanded.startsWith(homeDirWithSep)) {
    return expanded;
  }

  const mapped = path.join(baseDir, expanded.slice(homeDirWithSep.length));
  return stripAgentHome(mapped, baseDir, input.isolated.agentBinary);
}

function resolveIsolatedBaseDir(env: CliEnvironment, providerName: string): string {
  return env.resolveHomePath(".poe-code", providerName);
}

function resolveIsolatedEnvVars(
  env: CliEnvironment,
  baseDir: string,
  vars: Record<string, IsolatedEnvValue>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] = resolveIsolatedEnvValue(env, baseDir, value);
  }
  return out;
}

function resolveIsolatedEnvValue(
  env: CliEnvironment,
  baseDir: string,
  value: IsolatedEnvValue
): string {
  if (typeof value === "string") {
    return expandHomeShortcut(env, value);
  }
  if (isEnvVarReference(value)) {
    const resolved = env.getVariable(value.name);
    if (typeof resolved !== "string" || resolved.trim().length === 0) {
      throw new Error(
        `Missing required environment variable "${value.name}" for isolated wrapper.`
      );
    }
    return resolved;
  }
  return resolveIsolatedEnvPath(env, baseDir, value);
}

function resolveIsolatedEnvPath(
  env: CliEnvironment,
  baseDir: string,
  value: IsolatedEnvPath
): string {
  switch (value.kind) {
    case "isolatedDir":
      return value.relativePath
        ? path.join(baseDir, value.relativePath)
        : baseDir;
    case "isolatedFile":
      return path.join(baseDir, value.relativePath);
  }
}

function isEnvVarReference(value: IsolatedEnvPath | IsolatedEnvVariable): value is IsolatedEnvVariable {
  return value.kind === "envVar";
}

export async function isolatedConfigExists(
  fs: FileSystem,
  configProbePath: string
): Promise<boolean> {
  try {
    await fs.stat(configProbePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export async function applyIsolatedEnvRepairs(input: {
  fs: FileSystem;
  env: CliEnvironment;
  providerName: string;
  isolated: ProviderIsolatedEnv;
}): Promise<void> {
  const repairs = input.isolated.repairs ?? [];
  if (repairs.length === 0 || typeof input.fs.chmod !== "function") {
    return;
  }

  const baseDir = input.env.resolveHomePath(".poe-code", input.providerName);

  for (const repair of repairs) {
    if (repair.kind !== "chmod") {
      continue;
    }
    if (path.isAbsolute(repair.relativePath)) {
      continue;
    }
    const repairPath = path.join(baseDir, repair.relativePath);
    try {
      await input.fs.chmod(repairPath, repair.mode);
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }
      throw error;
    }
  }
}

function stripAgentHome(
  mapped: string,
  baseDir: string,
  agentBinary: string
): string {
  const agentDir = `.${agentBinary}`;
  const prefix = path.join(baseDir, agentDir);
  if (mapped === prefix) {
    return baseDir;
  }
  const withSep = `${prefix}${path.sep}`;
  if (mapped.startsWith(withSep)) {
    return path.join(baseDir, mapped.slice(withSep.length));
  }
  return mapped;
}

function expandHomeShortcut(env: CliEnvironment, input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }
  if (input === "~") {
    return env.homeDir;
  }
  if (input.startsWith("~/") || input.startsWith(`~${path.sep}`)) {
    return path.join(env.homeDir, input.slice(2));
  }
  if (input.startsWith("~./") || input.startsWith(`~.${path.sep}`)) {
    return path.join(env.homeDir, `.${input.slice(3)}`);
  }
  return input;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
