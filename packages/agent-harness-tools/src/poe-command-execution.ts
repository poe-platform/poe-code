import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem } from "#harness-tools-filesystem";
import { createStateManager } from "#harness-tools-state";
import { deepMergeDocuments } from "@poe-code/poe-code-config/merge";
import { parseRuntime, resolveRuntime, runtimeConfigScope } from "@poe-code/poe-code-config/runtime";
import { resolveScope } from "@poe-code/poe-code-config/resolve";
import type { RunnerScope, ConfigDocument, JobEntry, JobListFilter, ResolvedConfig, StateManager } from "@poe-code/poe-code-config/core";
import { path } from "./portable-path.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { selectExecutionEnv, type OpenSpec } from "./execution-env.js";

export type RuntimeOverrideOptions = {
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RunnerScope["sync"];
};

export async function resolvePoeCommandExecution(input: {
  cwd: string;
  runtimeConfigCwd?: string;
  env: Record<string, string>;
  argv: string[];
  displayArgv?: string[];
  tool: string;
  runtime?: RuntimeOverrideOptions;
  context?: {
    homeDir?: string;
    state?: StateManager;
    fs?: Pick<FileSystem, "readFile" | "stat" | "realpath">;
  };
  openSpec?: Partial<Pick<OpenSpec, "execution" | "shellSpec">>;
}): Promise<{
  factory: ReturnType<typeof selectExecutionEnv>;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
}> {
  const env = { ...globalThis.process?.env, ...input.env };
  const homeDir = input.context?.homeDir ?? env.HOME ?? env.USERPROFILE;
  if (!homeDir) throw new Error("Command execution requires an explicit home directory.");
  const fs = input.context?.fs ?? createDefaultFileSystem();
  const runtimeConfigCwd = input.runtimeConfigCwd ?? input.cwd;
  const loaded = await loadRuntimeConfig(runtimeConfigCwd, homeDir, fs, env);
  const config = applyRuntimeOverrides(loaded, input.runtime, runtimeConfigCwd);
  const resolved = await resolveRuntime({ cwd: runtimeConfigCwd, config, fs });
  const factory = selectExecutionEnv(resolved.runtime);

  if (config.runner.detach && factory.supportsDetach !== true) {
    throw new UnsupportedRuntimeCapabilityError(
      `Detach was requested (--detach or runner.detach) but the "${factory.type}" runtime ` +
        "cannot detach. Re-run with --runtime docker to detach, or drop --detach to run inline."
    );
  }
  if (input.runtime?.runnerSync !== undefined && factory.supportsWorkspaceTransfer !== true) {
    throw new UnsupportedRuntimeCapabilityError(
      `--runner-sync was requested but the "${factory.type}" runtime has no ` +
        "transferable workspace. Re-run with --runtime docker, or drop --runner-sync."
    );
  }

  const state = input.context?.state ?? loadState(homeDir);

  return {
    factory,
    detach: config.runner.detach,
    state,
    openSpec: {
      cwd: input.cwd,
      runtimeCwd: runtimeConfigCwd,
      runtime: resolved.runtime,
      runner: config.runner,
      state,
      env: input.env,
      uploadIgnoreFiles: config.runner.workspace?.exclude ?? [],
      jobLabel: {
        tool: input.tool,
        argv: input.argv,
        ...(input.displayArgv === undefined ? {} : { displayArgv: input.displayArgv })
      },
      ...input.openSpec
    }
  };
}

/** Raised when a requested runner capability is not offered by the resolved execution env. */
export class UnsupportedRuntimeCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRuntimeCapabilityError";
  }
}

export interface LoadedRuntimeConfig extends ResolvedConfig {
  /** Raw merged runtime scope preserved for re-parsing when overrides change the type. */
  rawScope: Record<string, unknown>;
}

export function applyRuntimeOverrides(
  config: ResolvedConfig | LoadedRuntimeConfig,
  overrides: RuntimeOverrideOptions | undefined,
  cwd = globalThis.process?.cwd?.() ?? "/"
): ResolvedConfig {
  if (!overrides) {
    return { runtime: config.runtime, runner: config.runner };
  }

  const base: Record<string, unknown> = isLoadedRuntimeConfig(config)
    ? { ...config.rawScope }
    : { ...(config.runtime as unknown as Record<string, unknown>) };

  const runtime = parseRuntime({
    ...base,
    ...(overrides.runtime !== undefined ? { type: overrides.runtime } : {}),
    ...(overrides.runtimeImage !== undefined ? { image: overrides.runtimeImage } : {}),
    ...(overrides.mountPoeCode === true
      ? { mounts: [...config.runtime.mounts, createPoeCodeMount(cwd)] }
      : {})
  });

  return {
    runtime,
    runner: {
      ...config.runner,
      ...(overrides.detach === true ? { detach: true } : {}),
      ...(overrides.runnerSync !== undefined ? { sync: overrides.runnerSync } : {})
    }
  };
}

function isLoadedRuntimeConfig(config: ResolvedConfig | LoadedRuntimeConfig): config is LoadedRuntimeConfig {
  return Object.hasOwn(config, "rawScope");
}

function createPoeCodeMount(cwd: string): { source: string; target: string; readonly: boolean } {
  return {
    source: cwd,
    target: "/usr/local/lib/poe-code",
    readonly: true
  };
}

async function loadRuntimeConfig(cwd: string, homeDir: string, fs: Pick<FileSystem, "readFile">, env: Record<string, string | undefined>): Promise<LoadedRuntimeConfig> {
  const documents = await Promise.all([homeDir, cwd].map(async root => {
    try {
      const bytes = await fs.readFile(path.join(root, ".poe-code", "config.json"));
      return JSON.parse(new TextDecoder().decode(bytes)) as ConfigDocument;
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) return {};
      throw error;
    }
  }));
  const document = deepMergeDocuments(documents[0]!, documents[1]!);
  const runtimeScope = resolveScope(runtimeConfigScope.schema, document.runtime, env);
  return {
    rawScope: { ...(runtimeScope as unknown as Record<string, unknown>) },
    runtime: parseRuntime(runtimeScope),
    runner: runtimeScope.runner
  };
}

function loadState(homeDir: string): StateManager {
  if (globalThis.process?.env?.VITEST === "true") {
    return createMemoryStateManager();
  }
  return createStateManager(homeDir);
}

function createMemoryStateManager(): StateManager {
  const jobs = new Map<string, JobEntry>();
  return {
    templates: {
      async get() {
        return null;
      },
      async put() {},
      async remove() {},
      async list() {
        return [];
      }
    },
    jobs: {
      async get(id) {
        return jobs.get(id) ?? null;
      },
      async put(entry) {
        jobs.set(entry.id, entry);
      },
      async update(id, patch) {
        const current = jobs.get(id);
        if (!current) {
          return null;
        }
        const updated = { ...current, ...patch, id };
        jobs.set(id, updated);
        return updated;
      },
      async list(filter?: JobListFilter) {
        const entries = Array.from(jobs.values());
        if (!filter) {
          return entries;
        }
        return entries.filter((entry) =>
          Object.entries(filter).every(([key, value]) => entry[key as keyof JobEntry] === value)
        );
      },
      async remove(id) {
        jobs.delete(id);
      }
    }
  };
}
