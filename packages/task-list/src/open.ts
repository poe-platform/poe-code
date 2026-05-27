import * as fsPromises from "node:fs/promises";
import { ghIssuesBackend } from "./backends/gh-issues.js";
import { resolveAuth, resolveEndpoint } from "./backends/gh-issues-client.js";
import { markdownDirBackend } from "./backends/markdown-dir.js";
import { yamlFileBackend } from "./backends/yaml-file.js";
import { validateMachine } from "./state-machine.js";
import { resolveStateMachine } from "./state.js";
import type {
  BackendFactory,
  BackendDeps,
  OpenGhIssuesOptions,
  OpenMarkdownDirOptions,
  OpenTaskListOptions,
  OpenYamlFileOptions,
  TaskList,
  TaskListFs
} from "./types.js";

type FileBackendOptions = OpenMarkdownDirOptions | OpenYamlFileOptions;

export const backendFactories: Record<FileBackendOptions["type"], BackendFactory> = {
  "markdown-dir": markdownDirBackend,
  "yaml-file": yamlFileBackend
};

function createDefaultFs(): TaskListFs {
  return fsPromises as unknown as TaskListFs;
}

export async function openTaskList(options: OpenTaskListOptions): Promise<TaskList> {
  switch (options.type) {
    case "markdown-dir":
    case "yaml-file":
      return openFileBackend(options);
    case "gh-issues":
      return openGhIssuesBackend(options);
    default:
      throw new Error(`Unknown task list backend type "${(options as { type: string }).type}".`);
  }
}

async function openFileBackend(options: FileBackendOptions): Promise<TaskList> {
  const factory = backendFactories[options.type];
  const stateMachine = resolveStateMachine(options.stateMachine);
  validateMachine(stateMachine);
  const markdownOptions = options.type === "markdown-dir" ? options : undefined;

  const deps: BackendDeps = {
    path: options.path,
    defaults: {
      metadata: { ...(options.defaults?.metadata ?? {}) }
    },
    singleList: markdownOptions?.singleList,
    frontmatterMode: markdownOptions?.frontmatterMode ?? "strict",
    create: options.create ?? false,
    fs: options.fs ?? createDefaultFs(),
    stateMachine
  };

  return factory(deps);
}

async function openGhIssuesBackend(options: OpenGhIssuesOptions): Promise<TaskList> {
  const token = await resolveAuth({ explicitToken: options.auth?.token });
  const endpoint = resolveEndpoint();

  return ghIssuesBackend({
    repo: options.repo,
    project: options.project,
    filter: options.filter,
    state: options.state,
    stateMachine: options.stateMachine,
    defaults: {
      metadata: { ...(options.defaults?.metadata ?? {}) }
    },
    token,
    endpoint,
    fetch: options.fetch
  });
}
