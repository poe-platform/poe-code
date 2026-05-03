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
  type ConfigDocument,
  type JobEntry,
  type JobListFilter,
  type ResolvedConfig,
  type StateManager
} from "@poe-code/poe-code-config";
import { selectExecutionEnv, type OpenSpec } from "./execution-env.js";

export type RuntimeOverrideOptions = {
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
};

export function resolvePoeCommandExecution(input: {
  cwd: string;
  env: Record<string, string>;
  argv: string[];
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
  const config = applyRuntimeOverrides(loadRuntimeConfig(input.cwd, homeDir), input.runtime, input.cwd);
  const resolved = resolveRuntime({ cwd: input.cwd, config });
  const factory = selectExecutionEnv(resolved.runtime);

  return {
    factory,
    detach: factory.supportsDetach === true && config.runner.detach,
    state: input.context?.state ?? loadState(homeDir),
    openSpec: {
      cwd: input.cwd,
      runtime: resolved.runtime,
      runner: config.runner,
      env: input.env,
      uploadIgnoreFiles: config.runner.workspace?.exclude ?? [],
      jobLabel: {
        tool: input.tool,
        argv: input.argv
      },
      ...input.openSpec
    }
  };
}

export function applyRuntimeOverrides(
  config: ResolvedConfig,
  overrides: RuntimeOverrideOptions | undefined,
  cwd = process.cwd()
): ResolvedConfig {
  if (!overrides) {
    return config;
  }

  const runtime = parseRuntime({
    ...config.runtime,
    ...(overrides.runtime !== undefined ? { type: overrides.runtime } : {}),
    ...(overrides.runtimeImage !== undefined ? { image: overrides.runtimeImage } : {}),
    ...(overrides.runtimeTemplate !== undefined
      ? { template_id: overrides.runtimeTemplate }
      : {}),
    ...(overrides.mountPoeCode === true
      ? { mounts: [...config.runtime.mounts, createPoeCodeMount(cwd)] }
      : {})
  });

  return {
    runtime,
    runner: {
      ...config.runner,
      ...(overrides.detach === true ? { detach: true } : {})
    }
  };
}

function createPoeCodeMount(cwd: string): { source: string; target: string; readonly: boolean } {
  return {
    source: cwd,
    target: "/usr/local/lib/poe-code",
    readonly: true
  };
}

function loadRuntimeConfig(cwd: string, homeDir: string): ResolvedConfig {
  const document = deepMergeDocuments(
    readConfigDocument(resolveConfigPath(homeDir)),
    readConfigDocument(resolveProjectConfigPath(cwd))
  );
  const runtimeScope = resolveScope(runtimeConfigScope.schema, document.runtime, process.env);

  return {
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
