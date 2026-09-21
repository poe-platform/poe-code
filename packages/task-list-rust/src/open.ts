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
  const type = getOwnProperty(options, "type");
  switch (type) {
    case "markdown-dir":
    case "yaml-file":
      return openFileBackend(options as FileBackendOptions);
    case "gh-issues":
      return openGhIssuesBackend(options as OpenGhIssuesOptions);
    default:
      throw new Error(`Unknown task list backend type "${String(type)}".`);
  }
}

async function openFileBackend(options: FileBackendOptions): Promise<TaskList> {
  const type = getOwnProperty(options, "type") as FileBackendOptions["type"];
  const factory = backendFactories[type];
  const stateMachine = resolveStateMachine(
    getOwnProperty(options, "stateMachine") as FileBackendOptions["stateMachine"]
  );
  validateMachine(stateMachine);
  const markdownOptions = type === "markdown-dir" ? (options as OpenMarkdownDirOptions) : undefined;
  const defaults = getOwnProperty(options, "defaults") as FileBackendOptions["defaults"];

  const deps: BackendDeps = {
    path: getOwnProperty(options, "path") as string,
    defaults: {
      metadata: readDefaultMetadata(defaults)
    },
    singleList:
      markdownOptions === undefined
        ? undefined
        : (getOwnProperty(markdownOptions, "singleList") as OpenMarkdownDirOptions["singleList"]),
    frontmatterMode:
      markdownOptions === undefined
        ? "strict"
        : ((getOwnProperty(
            markdownOptions,
            "frontmatterMode"
          ) as OpenMarkdownDirOptions["frontmatterMode"]) ?? "strict"),
    create: (getOwnProperty(options, "create") as boolean | undefined) ?? false,
    fs: (getOwnProperty(options, "fs") as TaskListFs | undefined) ?? createDefaultFs(),
    stateMachine
  };

  return factory(deps);
}

async function openGhIssuesBackend(options: OpenGhIssuesOptions): Promise<TaskList> {
  const auth = getOwnProperty(options, "auth") as OpenGhIssuesOptions["auth"];
  const explicitToken =
    auth && hasOwnProperty(auth, "token") ? (auth.token as string | undefined) : undefined;
  const endpoint = resolveEndpoint();
  const defaults = getOwnProperty(options, "defaults") as OpenGhIssuesOptions["defaults"];

  return ghIssuesBackend({
    repo: getOwnProperty(options, "repo") as OpenGhIssuesOptions["repo"],
    project: getOwnProperty(options, "project") as OpenGhIssuesOptions["project"],
    filter: getOwnProperty(options, "filter") as OpenGhIssuesOptions["filter"],
    state: getOwnProperty(options, "state") as OpenGhIssuesOptions["state"],
    stateMachine: getOwnProperty(options, "stateMachine") as OpenGhIssuesOptions["stateMachine"],
    defaults: {
      metadata: readDefaultMetadata(defaults)
    },
    token: await resolveAuth({ explicitToken }),
    endpoint,
    fetch: getOwnProperty(options, "fetch") as OpenGhIssuesOptions["fetch"]
  });
}

function readDefaultMetadata(defaults: { metadata?: Record<string, unknown> } | undefined) {
  const metadata = defaults === undefined ? undefined : getOwnProperty(defaults, "metadata");
  return isRecord(metadata) ? { ...metadata } : {};
}

function getOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): Record<Name, unknown>[Name] | undefined {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
