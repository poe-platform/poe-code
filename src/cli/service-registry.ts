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
  TRemove = TConfigure,
  TSpawn = any
> {
  id: string;
  summary: string;
  configure(
    context: ServiceExecutionContext<TConfigure>,
    runOptions?: ServiceRunOptions
  ): Promise<void>;
  remove(
    context: ServiceExecutionContext<TRemove>,
    runOptions?: ServiceRunOptions
  ): Promise<boolean>;
  name: string;
  label: string;
  branding?: ProviderBranding;
  disabled?: boolean;
  supportsStdinPrompt?: boolean;
  requiresApiKey?: boolean;
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

export type IsolatedEnvValue = string | IsolatedEnvPath | IsolatedEnvVariable;

export type IsolatedEnvVariable = {
  kind: "envVar";
  name: string;
};

export type ProviderOperation =
  | "install"
  | "configure"
  | "remove"
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
  const adapters = new Map<string, ProviderService>();

  const register = (adapter: ProviderService): void => {
    if (adapters.has(adapter.name)) {
      throw new Error(`Provider "${adapter.name}" is already registered.`);
    }
    adapters.set(adapter.name, adapter);
  };

  const discover = (candidates: ProviderService[]): void => {
    for (const candidate of candidates) {
      if (adapters.has(candidate.name)) {
        continue;
      }
      adapters.set(candidate.name, candidate);
    }
  };

  const get = (name: string): ProviderService | undefined => adapters.get(name);

  const require = (name: string): ProviderService => {
    const adapter = adapters.get(name);
    if (!adapter) {
      throw new Error(`Unknown provider "${name}".`);
    }
    return adapter;
  };

  const list = (): ProviderService[] => Array.from(adapters.values());

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
