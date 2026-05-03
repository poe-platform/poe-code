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
import {
  selectExecutionEnv,
  type OpenSpec as HarnessOpenSpec
} from "@poe-code/agent-harness-tools";
import type { SpawnContext } from "./types.js";

type OpenSpec = HarnessOpenSpec & {
  execution?: {
    wrapForLogTee?: boolean;
    stdin?: "pipe" | "inherit" | "ignore";
    stdout?: "pipe" | "inherit";
    stderr?: "pipe" | "inherit";
    env?: Record<string, string>;
    tty?: boolean;
    input?: string | Buffer;
    captureOutput?: boolean;
    activityTimeoutMs?: number;
    onStdout?(chunk: string): void;
    onStderr?(chunk: string): void;
  };
  shellSpec?: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: "pipe" | "inherit" | "ignore";
    stdout?: "pipe" | "inherit";
    stderr?: "pipe" | "inherit";
    tty?: boolean;
    signal?: AbortSignal;
  };
};

export function resolveSpawnExecution(input: {
  cwd: string;
  env: Record<string, string>;
  argv: string[];
  tool: string;
  context?: SpawnContext;
  openSpec?: Partial<Pick<OpenSpec, "execution" | "shellSpec">>;
}): {
  factory: ReturnType<typeof selectExecutionEnv>;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
} {
  const homeDir = input.context?.homeDir ?? os.homedir();
  const config = loadRuntimeConfig(input.cwd, homeDir);
  const resolved = resolveRuntime({ cwd: input.cwd, config });
  const factory = selectExecutionEnv(resolved.runtime);

  return {
    factory,
    detach: resolved.runtime.type === "host" ? false : config.runner.detach,
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
