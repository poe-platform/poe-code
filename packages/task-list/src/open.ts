import * as fsPromises from "node:fs/promises";
import { markdownDirBackend } from "./backends/markdown-dir.js";
import { yamlFileBackend } from "./backends/yaml-file.js";
import type {
  BackendFactory,
  BackendDeps,
  OpenTaskListOptions,
  TaskList,
  TaskListFs
} from "./types.js";

const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_LOCK_RETRIES = 20;

export const backendFactories: Record<OpenTaskListOptions["type"], BackendFactory> = {
  "markdown-dir": markdownDirBackend,
  "yaml-file": yamlFileBackend
};

function createDefaultFs(): TaskListFs {
  return fsPromises as unknown as TaskListFs;
}

export async function openTaskList(options: OpenTaskListOptions): Promise<TaskList> {
  const factory = (backendFactories as Record<string, BackendFactory | undefined>)[options.type];

  if (factory === undefined) {
    throw new Error(`Unknown task list backend type "${options.type}".`);
  }

  const deps: BackendDeps = {
    path: options.path,
    defaults: {
      state: options.defaults?.state ?? "draft",
      metadata: { ...(options.defaults?.metadata ?? {}) }
    },
    lockStaleMs: options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
    lockRetries: options.lockRetries ?? DEFAULT_LOCK_RETRIES,
    create: options.create ?? false,
    fs: options.fs ?? createDefaultFs()
  };

  return factory(deps);
}
