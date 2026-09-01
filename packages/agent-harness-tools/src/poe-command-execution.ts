import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import {
  createStateManager,
  deepMergeDocuments,
  parseRuntime,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveRuntime,
  resolveScope,
  runtimeConfigScope,
  type RunnerScope,
  type ConfigDocument,
  type JobEntry,
  type JobListFilter,
  type ResolvedConfig,
  type StateManager
} from "@poe-code/poe-code-config/core";
import { selectExecutionEnv, type OpenSpec } from "./execution-env.js";

export type RuntimeOverrideOptions = {
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RunnerScope["sync"];
};

export function resolvePoeCommandExecution(input: {
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
  };
  openSpec?: Partial<Pick<OpenSpec, "execution" | "shellSpec">>;
}): {
  factory: ReturnType<typeof selectExecutionEnv>;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
} {
  const homeDir = input.context?.homeDir ?? os.homedir();
  const runtimeConfigCwd = input.runtimeConfigCwd ?? input.cwd;
  const loaded = loadRuntimeConfig(runtimeConfigCwd, homeDir);
  const config = applyRuntimeOverrides(loaded, input.runtime, runtimeConfigCwd);
  const resolved = resolveRuntime({ cwd: runtimeConfigCwd, config });
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
  cwd = process.cwd()
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

function loadRuntimeConfig(cwd: string, homeDir: string): LoadedRuntimeConfig {
  const document = deepMergeDocuments(
    readConfigDocument(resolveConfigPath(homeDir)),
    readConfigDocument(resolveProjectConfigPath(cwd))
  );
  const runtimeScope = resolveScope(runtimeConfigScope.schema, document.runtime, process.env);

  return {
    rawScope: { ...(runtimeScope as unknown as Record<string, unknown>) },
    runtime: parseRuntime(runtimeScope),
    runner: runtimeScope.runner
  };
}

function readConfigDocument(filePath: string): ConfigDocument {
  if (!existsSync(filePath)) {
    return {};
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as ConfigDocument;
}

function loadState(homeDir: string): StateManager {
  if (process.env.VITEST === "true") {
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
