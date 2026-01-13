import type { CliEnvironment } from "./environment.js";
import type { CommandContext } from "./context.js";
import type { ScopedLogger } from "./logger.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandCheck } from "../utils/command-checks.js";
import type {
  ModelPromptInput,
  ReasoningPromptInput
} from "./prompts.js";
import type {
  ServiceRunOptions,
  ServiceManifestPathMapper
} from "../services/service-manifest.js";

export interface ProviderColorSet {
  light?: string;
  dark?: string;
}

export interface ProviderBranding {
  colors?: ProviderColorSet;
}

export interface ProviderConfigurePrompts {
  model?: ModelPromptInput;
  reasoningEffort?: ReasoningPromptInput;
}

export interface ProviderContext {
  env: CliEnvironment;
  command: CommandContext;
  logger: ScopedLogger;
  runCheck(check: CommandCheck): Promise<void>;
}

export interface ServiceExecutionContext<Options> {
  fs: FileSystem;
  env: CliEnvironment;
  command: CommandContext;
  options: Options;
  pathMapper?: ServiceManifestPathMapper;
}

export interface ProviderService<
  TConfigure = any,
  TUnconfigure = TConfigure,
  TSpawn = any
> {
  id: string;
  summary: string;
  aliases?: string[];
  configure(
    context: ServiceExecutionContext<TConfigure>,
    runOptions?: ServiceRunOptions
  ): Promise<void>;
  unconfigure(
    context: ServiceExecutionContext<TUnconfigure>,
    runOptions?: ServiceRunOptions
  ): Promise<boolean>;
  name: string;
  label: string;
  branding?: ProviderBranding;
  disabled?: boolean;
  supportsStdinPrompt?: boolean;
  configurePrompts?: ProviderConfigurePrompts;
  isolatedEnv?: ProviderIsolatedEnv;
  install?(context: ProviderContext): Promise<void> | void;
  spawn?(context: ProviderContext, options: TSpawn): Promise<unknown>;
  test?(context: ProviderContext): Promise<void>;
}

export interface ProviderIsolatedEnv {
  agentBinary: string;
  configProbe?: IsolatedEnvPath;
  env: Record<string, IsolatedEnvValue>;
  repairs?: IsolatedEnvRepair[];
  requiresConfig?: boolean;
}

export type IsolatedEnvRepair =
  | {
      kind: "chmod";
      relativePath: string;
      mode: number;
    };

export type IsolatedEnvPath =
  | {
      kind: "isolatedDir";
      relativePath?: string;
    }
  | {
      kind: "isolatedFile";
      relativePath: string;
    };

export type IsolatedEnvValue =
  | string
  | IsolatedEnvPath
  | IsolatedEnvVariable
  | IsolatedEnvPoeApiKey;

export type IsolatedEnvVariable = {
  kind: "envVar";
  name: string;
};

export type IsolatedEnvPoeApiKey = {
  kind: "poeApiKey";
};

export type ProviderOperation =
  | "install"
  | "configure"
  | "unconfigure"
  | "spawn"
  | "test";

export interface ServiceRegistry {
  register(adapter: ProviderService): void;
  discover(adapters: ProviderService[]): void;
  get(name: string): ProviderService | undefined;
  require(name: string): ProviderService;
  list(): ProviderService[];
  invoke<T>(
    serviceName: string,
    operation: ProviderOperation,
    runner: (adapter: ProviderService) => Promise<T>
  ): Promise<T>;
}

export function createServiceRegistry(): ServiceRegistry {
  const canonicalAdapters = new Map<string, ProviderService>();
  const nameToCanonical = new Map<string, string>();

  const listProviderKeys = (adapter: ProviderService): string[] => {
    const keys: string[] = [adapter.name];
    for (const alias of adapter.aliases ?? []) {
      if (typeof alias !== "string") {
        continue;
      }
      const normalized = alias.trim();
      if (normalized.length === 0) {
        continue;
      }
      if (!keys.includes(normalized)) {
        keys.push(normalized);
      }
    }
    return keys;
  };

  const register = (adapter: ProviderService): void => {
    if (canonicalAdapters.has(adapter.name)) {
      throw new Error(`Provider "${adapter.name}" is already registered.`);
    }

    const keys = listProviderKeys(adapter);
    for (const key of keys) {
      if (nameToCanonical.has(key)) {
        throw new Error(`Provider "${key}" is already registered.`);
      }
    }

    canonicalAdapters.set(adapter.name, adapter);
    for (const key of keys) {
      nameToCanonical.set(key, adapter.name);
    }
  };

  const discover = (candidates: ProviderService[]): void => {
    for (const candidate of candidates) {
      if (canonicalAdapters.has(candidate.name)) {
        continue;
      }
      const keys = listProviderKeys(candidate);
      if (keys.some((key) => nameToCanonical.has(key))) {
        continue;
      }

      canonicalAdapters.set(candidate.name, candidate);
      for (const key of keys) {
        nameToCanonical.set(key, candidate.name);
      }
    }
  };

  const get = (name: string): ProviderService | undefined => {
    const canonicalName = nameToCanonical.get(name);
    if (!canonicalName) {
      return undefined;
    }
    return canonicalAdapters.get(canonicalName);
  };

  const require = (name: string): ProviderService => {
    const adapter = get(name);
    if (!adapter) {
      throw new Error(`Unknown provider "${name}".`);
    }
    return adapter;
  };

  const list = (): ProviderService[] => Array.from(canonicalAdapters.values());

  const invoke = async <T>(
    serviceName: string,
    operation: ProviderOperation,
    runner: (adapter: ProviderService) => Promise<T>
  ): Promise<T> => {
    const adapter = require(serviceName);
    return await runner(adapter);
  };

  return { register, discover, get, require, list, invoke };
}
