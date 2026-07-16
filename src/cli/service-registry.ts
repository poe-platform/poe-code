import type { CliEnvironment } from "./environment.js";
import type { CommandContext } from "./context.js";
import type { ScopedLogger } from "./logger.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandCheck } from "../utils/command-checks.js";
import type { HttpClient } from "./http.js";
import type { PromptLibrary, ModelPromptInput, ReasoningEffortInput } from "./prompts.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import { resolveAgentId, parseAgentSpecifier } from "@poe-code/agent-defs";
import type { PromptFn } from "./types.js";
import type { ActiveProvider } from "./commands/shared.js";
import type { HookBridgeOptions } from "@poe-code/agent-spawn";

export interface ServiceManifestPathMapper {
  mapTargetDirectory: (input: { targetDirectory: string; env: CliEnvironment }) => string;
}

export interface ServiceRunOptions {
  observers?: MutationObservers;
  sideEffects?: boolean;
}

export interface ProviderColorSet {
  light?: string;
  dark?: string;
}

export interface ProviderBranding {
  colors?: ProviderColorSet;
}

export interface ProviderConfigurePrompts {
  model?: ModelPromptInput;
  reasoningEffort?: ReasoningEffortInput;
}

export interface ProviderContext {
  env: CliEnvironment;
  command: CommandContext;
  logger: ScopedLogger;
  model?: string;
  hooks?: HookBridgeOptions;
  activeProvider?: ActiveProvider;
  runCheck(check: CommandCheck): Promise<void>;
}

export interface ServiceExecutionContext<Options> {
  fs: FileSystem;
  env: CliEnvironment;
  command: CommandContext;
  options: Options;
  pathMapper?: ServiceManifestPathMapper;
}

export interface ProviderConfigurePayloadContext {
  fs: FileSystem;
  env: CliEnvironment;
  httpClient: HttpClient;
  logger: ScopedLogger;
  payload: Record<string, unknown>;
  prompts: PromptFn;
  promptLibrary: PromptLibrary;
  assumeYes: boolean;
  commandOptions: Record<string, unknown>;
}

export interface ProviderService<TConfigure = any, TUnconfigure = TConfigure, TSpawn = any> {
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
  configurationLabel?: string;
  branding?: ProviderBranding;
  disabled?: boolean;
  supportsConfigure?: boolean;
  supportsStdinPrompt?: boolean;
  supportsMcpSpawn?: boolean;
  requiresProvider?: boolean;
  configurePrompts?: ProviderConfigurePrompts;
  postConfigureMessages?: string[];
  extendConfigurePayload?(
    context: ProviderConfigurePayloadContext
  ): Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  runtimeEnv?: Record<string, IsolatedEnvValue>;
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
  /** CLI settings to inject via --settings flag (for agents that support it) */
  cliSettings?: IsolatedCliSettings;
}

export interface IsolatedCliSettings {
  /** Static settings values */
  values: Record<string, unknown>;
  /** Top-level settings that need runtime resolution */
  resolved?: Record<
    string,
    IsolatedEnvProviderCredential | IsolatedEnvProviderBaseUrl | IsolatedEnvAgentBaseUrl
  >;
  /** Environment variables to inject into settings.env (resolved at runtime) */
  env?: Record<
    string,
    string | IsolatedEnvProviderCredential | IsolatedEnvProviderBaseUrl | IsolatedEnvAgentBaseUrl
  >;
}

export type IsolatedEnvRepair = {
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
  | IsolatedEnvProviderCredential
  | IsolatedEnvProviderBaseUrl
  | IsolatedEnvAgentBaseUrl;

export type IsolatedEnvVariable = {
  kind: "envVar";
  name: string;
};

export type IsolatedEnvProviderCredential = {
  kind: "providerCredential";
  prefix?: string;
};

export type IsolatedEnvProviderBaseUrl = {
  kind: "providerBaseUrl";
};

export type IsolatedEnvAgentBaseUrl = {
  kind: "agentBaseUrl";
};

export type ProviderOperation = "install" | "configure" | "unconfigure" | "spawn" | "test";

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

  const resolveCanonicalName = (name: string): string | undefined => {
    const direct = nameToCanonical.get(name);
    if (direct) {
      return direct;
    }
    const { agent } = parseAgentSpecifier(name);
    const resolvedAgent = resolveAgentId(agent);
    if (!resolvedAgent) {
      return undefined;
    }
    return nameToCanonical.get(resolvedAgent);
  };

  const get = (name: string): ProviderService | undefined => {
    const canonicalName = resolveCanonicalName(name);
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
