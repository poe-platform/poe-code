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
}

export interface TaskCreate {
  id: string;
  name: string;
  state?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdate {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskFireOptions {
  metadataPatch?: Record<string, unknown>;
}

export interface ListFilter {
  state?: string;
  includeArchived?: boolean;
}

export interface Tasks {
  readonly name: string;
  readonly stateMachine: StateMachineDef;
  all(filter?: ListFilter): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: TaskCreate): Promise<Task>;
  update(id: string, patch: TaskUpdate): Promise<Task>;
  fire(id: string, event: string, opts?: TaskFireOptions): Promise<Task>;
  canFire(id: string, event: string): Promise<boolean>;
  events(id: string): Promise<readonly string[]>;
  transition(id: string, to: string): Promise<Task>;
  delete(id: string): Promise<void>;
}

export interface TaskList {
  list(name: string): Tasks;
  lists(): Promise<string[]>;
  allTasks(filter?: ListFilter): Promise<Task[]>;
  get(qualifiedId: string): Promise<Task>;
}

export interface TaskDefaults {
  state?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskListFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  open(path: string, flags: string): Promise<{
    close(): Promise<void>;
    writeFile(
      data: string | NodeJS.ArrayBufferView,
      options?: BufferEncoding | { encoding?: BufferEncoding }
    ): Promise<void>;
  }>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(fromPath: string, toPath: string): Promise<void>;
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

export interface OpenTaskListOptions {
  type: "markdown-dir" | "yaml-file";
  path: string;
  defaults?: TaskDefaults;
  create?: boolean;
  lockStaleMs?: number;
  lockRetries?: number;
  fs?: TaskListFs;
  stateMachine?: StateMachineDef;
}

export interface BackendDeps {
  path: string;
  defaults: Required<TaskDefaults>;
  lockStaleMs: number;
  lockRetries: number;
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
