import path from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { CliEnvironment } from "./environment.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  IsolatedCliSettings,
  IsolatedEnvPath,
  IsolatedEnvProviderCredential,
  IsolatedEnvProviderBaseUrl,
  IsolatedEnvAgentBaseUrl,
  IsolatedEnvVariable,
  IsolatedEnvValue,
  ProviderIsolatedEnv
} from "./service-registry.js";
import type { ActiveProvider } from "./commands/shared.js";
import type { CliSettings } from "../utils/cli-settings-merge.js";

export interface IsolatedEnvDetails {
  agentBinary: string;
  env: Record<string, string>;
  configProbePath?: string;
}

function missingActiveProviderError(reference: string): Error {
  return new Error(
    `Cannot resolve "${reference}": no provider is configured for this agent. ` +
      "Run `poe-code configure <agent> --provider <provider>` first, " +
      "adding `--base-url <url>` when the provider requires a gateway base URL."
  );
}

export async function resolveIsolatedEnvDetails(
  env: CliEnvironment,
  isolated: ProviderIsolatedEnv,
  providerName?: string,
  activeProvider?: ActiveProvider
): Promise<IsolatedEnvDetails> {
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
    env: await resolveIsolatedEnvVars(env, baseDir, isolated.env, activeProvider),
    configProbePath: isolated.configProbe
      ? resolveIsolatedEnvPath(env, baseDir, isolated.configProbe)
      : undefined
  };
}

export async function resolveProviderRuntimeEnv(
  env: CliEnvironment,
  vars: Record<string, IsolatedEnvValue>,
  providerName: string,
  activeProvider?: ActiveProvider
): Promise<Record<string, string>> {
  return resolveIsolatedEnvVars(
    env,
    resolveIsolatedBaseDir(env, providerName),
    vars,
    activeProvider
  );
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

async function resolveIsolatedEnvVars(
  env: CliEnvironment,
  baseDir: string,
  vars: Record<string, IsolatedEnvValue>,
  activeProvider?: ActiveProvider
): Promise<Record<string, string>> {
  const out = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(vars)) {
    out[key] = await resolveIsolatedEnvValue(env, baseDir, value, activeProvider);
  }
  return out;
}

async function resolveIsolatedEnvValue(
  env: CliEnvironment,
  baseDir: string,
  value: IsolatedEnvValue,
  activeProvider?: ActiveProvider
): Promise<string> {
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
  if (isProviderCredentialReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("providerCredential");
    }
    return `${value.prefix ?? ""}${activeProvider.credential}`;
  }
  if (isProviderBaseUrlReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("providerBaseUrl");
    }
    return activeProvider.baseUrl;
  }
  if (isAgentBaseUrlReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("agentBaseUrl");
    }
    return activeProvider.agentBaseUrl;
  }
  if (value.kind === "isolatedDir" || value.kind === "isolatedFile") {
    return resolveIsolatedEnvPath(env, baseDir, value);
  }
  throw new Error("Unsupported isolated environment value.");
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

function isEnvVarReference(value: IsolatedEnvValue): value is IsolatedEnvVariable {
  return typeof value === "object" && value.kind === "envVar";
}

function isProviderCredentialReference(
  value: IsolatedEnvValue
): value is IsolatedEnvProviderCredential {
  return typeof value === "object" && value.kind === "providerCredential";
}

function isProviderBaseUrlReference(
  value: IsolatedEnvValue
): value is IsolatedEnvProviderBaseUrl {
  return typeof value === "object" && value.kind === "providerBaseUrl";
}

function isAgentBaseUrlReference(
  value: IsolatedEnvValue
): value is IsolatedEnvAgentBaseUrl {
  return typeof value === "object" && value.kind === "agentBaseUrl";
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

export async function resolveCliSettings(
  cliSettings: IsolatedCliSettings,
  env: CliEnvironment,
  activeProvider?: ActiveProvider
): Promise<CliSettings> {
  const result: CliSettings = { ...cliSettings.values };

  // Resolve top-level settings
  if (cliSettings.resolved) {
    for (const [key, value] of Object.entries(cliSettings.resolved)) {
      result[key] = await resolveCliSettingValue(value, env, activeProvider);
    }
  }

  // Resolve env settings (nested under settings.env)
  if (cliSettings.env) {
    const resolvedEnv: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(cliSettings.env)) {
      if (typeof value === "string") {
        resolvedEnv[key] = value;
      } else {
        resolvedEnv[key] = await resolveCliSettingValue(value, env, activeProvider);
      }
    }
    result.env = resolvedEnv;
  }

  return result;
}

async function resolveCliSettingValue(
  value: IsolatedEnvProviderCredential | IsolatedEnvProviderBaseUrl | IsolatedEnvAgentBaseUrl,
  env: CliEnvironment,
  activeProvider?: ActiveProvider
): Promise<string> {
  if (isProviderCredentialReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("providerCredential");
    }
    return `${value.prefix ?? ""}${activeProvider.credential}`;
  }
  if (isProviderBaseUrlReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("providerBaseUrl");
    }
    return activeProvider.baseUrl;
  }
  if (isAgentBaseUrlReference(value)) {
    if (!activeProvider) {
      throw missingActiveProviderError("agentBaseUrl");
    }
    return activeProvider.agentBaseUrl;
  }
  throw new Error("Unsupported CLI setting value type.");
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
