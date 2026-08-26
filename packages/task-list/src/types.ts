import type { StateMachineDef } from "./state-machine.js";

export type TaskState = "draft" | "planned" | "in-progress" | "done" | "archived";

export interface Task {
  list: string;
  id: string;
  qualifiedId: string;
  name: string;
  state: string;
  description: string;
  metadata: Record<string, unknown>;
  // Backend-specific absolute path, set by file-based backends.
  sourcePath?: string;
}

export interface TaskCreate {
  id?: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdate {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  state?: never;
}

export interface TaskFireOptions {
  metadataPatch?: Record<string, unknown>;
}

export type TaskOrder = "priority" | "alphabetical" | "created";

export interface ListFilter {
  state?: string;
  includeArchived?: boolean;
  order?: TaskOrder;
}

export type MoveAnchor = { before: string } | { after: string } | { position: "top" | "bottom" };

export interface Tasks {
  readonly name: string;
  readonly stateMachine: StateMachineDef;
  all(filter?: ListFilter): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: TaskCreate): Promise<Task>;
  update(id: string, patch: TaskUpdate): Promise<Task>;
  fire(id: string, event: string, opts?: TaskFireOptions): Promise<Task>;
  comment?(id: string, body: string): Promise<void>;
  canFire(id: string, event: string): Promise<boolean>;
  events(id: string): Promise<readonly string[]>;
  delete(id: string): Promise<void>;
  move(id: string, anchor: MoveAnchor): Promise<Task>;
  reorder(ids: readonly string[]): Promise<readonly Task[]>;
}

export interface TaskList {
  list(name: string): Tasks;
  lists(): Promise<string[]>;
  allTasks(filter?: ListFilter): Promise<Task[]>;
  get(qualifiedId: string): Promise<Task>;
  moveBetweenLists(qualifiedId: string, targetList: string): Promise<Task>;
}

export interface TaskDefaults {
  metadata?: Record<string, unknown>;
}

export interface TaskListFs {
  lstat(path: string): Promise<{
    isSymbolicLink(): boolean;
  }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(fromPath: string, toPath: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: BufferEncoding | { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
}

export type OpenTaskListOptions =
  | OpenMarkdownDirOptions
  | OpenYamlFileOptions
  | OpenGhIssuesOptions;

export type TaskListOptions = OpenTaskListOptions;

export interface MoveTasksOptions {
  source: TaskListOptions;
  target: TaskListOptions;
  deleteSource?: boolean;
  limit?: number;
  rate?: number;
  dryRun?: boolean;
  stateMap?: Record<string, string>;
  onProgress?: (event: MoveProgressEvent) => void;
}

export interface MoveResult {
  created: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

export type MoveProgressEvent =
  | {
      type: "created";
      id: string;
      source: Task;
      target: Task;
      targetList: string;
      targetState: string;
    }
  | {
      type: "skipped";
      id: string;
      source: Task;
      targetList: string;
      targetState: string;
      reason: "dry-run";
    }
  | {
      type: "error";
      id: string;
      source: Task;
      error: string;
    };

export interface OpenMarkdownDirOptions {
  type: "markdown-dir";
  path: string;
  defaults?: TaskDefaults;
  create?: boolean;
  singleList?: string;
  frontmatterMode?: "strict" | "passthrough";
  fs?: TaskListFs;
  stateMachine?: StateMachineDef;
}

export interface OpenYamlFileOptions {
  type: "yaml-file";
  path: string;
  defaults?: TaskDefaults;
  create?: boolean;
  fs?: TaskListFs;
  stateMachine?: StateMachineDef;
}

export interface OpenGhIssuesOptions {
  type: "gh-issues";
  repo: string;
  project?: { owner: string; number: number };
  filter?: string;
  state?: { labelPrefix?: string };
  stateMachine?: StateMachineDef;
  defaults?: TaskDefaults;
  auth?: { token: string };
  fetch?: typeof fetch;
}

export interface BackendDeps {
  path: string;
  defaults: Required<TaskDefaults>;
  singleList?: string;
  frontmatterMode: "strict" | "passthrough";
  create: boolean;
  fs: TaskListFs;
  stateMachine?: StateMachineDef;
}

export type BackendFactory = (deps: BackendDeps) => Promise<TaskList>;

export class TaskNotFoundError extends Error {
  constructor(message = "Task not found.") {
    super(message);
    this.name = "TaskNotFoundError";
  }
}

export class TaskAlreadyExistsError extends Error {
  constructor(message = "Task already exists.") {
    super(message);
    this.name = "TaskAlreadyExistsError";
  }
}

export class InvalidTransitionError extends Error {
  readonly task?: Task;
  readonly event?: string;
  readonly to?: string;
  readonly reason: string;

  constructor(
    messageOrOptions:
      | string
      | {
          task?: Task;
          event?: string;
          to?: string;
          reason: string;
        } = "Invalid task transition."
  ) {
    const options =
      typeof messageOrOptions === "string"
        ? {
            reason: messageOrOptions
          }
        : messageOrOptions;

    super(options.reason);
    this.name = "InvalidTransitionError";
    this.task = options.task;
    this.event = options.event;
    this.to = options.to;
    this.reason = options.reason;
  }
}

export class MalformedTaskError extends Error {
  constructor(message = "Malformed task.") {
    super(message);
    this.name = "MalformedTaskError";
  }
}

export class OrderMismatchError extends Error {
  readonly missing: readonly string[];
  readonly extra: readonly string[];

  constructor(options: { missing: readonly string[]; extra: readonly string[] }) {
    const parts: string[] = [];
    if (options.missing.length > 0) {
      parts.push(`missing ${options.missing.map((id) => `"${id}"`).join(", ")}`);
    }
    if (options.extra.length > 0) {
      parts.push(`extra ${options.extra.map((id) => `"${id}"`).join(", ")}`);
    }
    super(`reorder requires the exact set of active task ids: ${parts.join("; ")}.`);
    this.name = "OrderMismatchError";
    this.missing = options.missing;
    this.extra = options.extra;
  }
}

export class AnchorNotFoundError extends Error {
  readonly anchor: string;

  constructor(anchor: string) {
    super(`Anchor task "${anchor}" not found.`);
    this.name = "AnchorNotFoundError";
    this.anchor = anchor;
  }
}
