export type TaskState = "draft" | "planned" | "in-progress" | "done" | "archived";

export interface Task {
  list: string;
  id: string;
  qualifiedId: string;
  name: string;
  state: TaskState;
  description: string;
  metadata: Record<string, unknown>;
}

export interface TaskCreate {
  id: string;
  name: string;
  state?: TaskState;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdate {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFilter {
  state?: TaskState;
  includeArchived?: boolean;
}

export interface Tasks {
  readonly name: string;
  all(filter?: ListFilter): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: TaskCreate): Promise<Task>;
  update(id: string, patch: TaskUpdate): Promise<Task>;
  transition(id: string, to: TaskState): Promise<Task>;
  delete(id: string): Promise<void>;
}

export interface TaskList {
  list(name: string): Tasks;
  lists(): Promise<string[]>;
  allTasks(filter?: ListFilter): Promise<Task[]>;
  get(qualifiedId: string): Promise<Task>;
}

export interface TaskDefaults {
  state?: TaskState;
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
}

export interface BackendDeps {
  path: string;
  defaults: Required<TaskDefaults>;
  lockStaleMs: number;
  lockRetries: number;
  create: boolean;
  fs: TaskListFs;
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
  constructor(message = "Invalid task transition.") {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class MalformedTaskError extends Error {
  constructor(message = "Malformed task.") {
    super(message);
    this.name = "MalformedTaskError";
  }
}
