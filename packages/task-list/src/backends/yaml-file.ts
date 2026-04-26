import { acquireFileLock } from "@poe-code/file-lock";
import { parseDocument } from "yaml";
import storeSchema from "../schema/store.schema.json" with { type: "json" };
import taskSchema from "../schema/task.schema.json" with { type: "json" };
import { assertTransition } from "../state.js";
import {
  MalformedTaskError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type BackendDeps,
  type ListFilter,
  type Task,
  type TaskCreate,
  type TaskList,
  type TaskListFs,
  type TaskState,
  type Tasks,
  type TaskUpdate
} from "../types.js";
import {
  isRecord,
  sortStrings,
  sortTasks,
  statIfExists,
  validateTaskId,
  writeAtomically
} from "./utils.js";

const STORE_KIND = "task-store";
const STORE_SCHEMA_ID = storeSchema.$id;
const STORE_VERSION = 1;
const TASK_KIND = "task";
const TASK_SCHEMA_ID = taskSchema.$id;
const TASK_VERSION = 1;
const RESERVED_TASK_KEYS = new Set(["$schema", "description", "kind", "name", "state", "version"]);
const VALID_STATES = new Set<TaskState>(["draft", "planned", "in-progress", "done", "archived"]);

type StoreRecord = Record<string, unknown>;
type TaskRecord = Record<string, unknown>;

function malformedStore(filePath: string, field: string): MalformedTaskError {
  return new MalformedTaskError(`Malformed task store "${filePath}": invalid "${field}".`);
}

function malformedTask(list: string, id: string, field: string): MalformedTaskError {
  return new MalformedTaskError(`Malformed task "${list}/${id}": invalid "${field}".`);
}

function validateListName(name: string): string {
  if (
    name.length === 0 ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error(`Invalid task list name "${name}".`);
  }

  return name;
}

function parseQualifiedId(qualifiedId: string): {
  id: string;
  list: string;
} {
  const separatorIndex = qualifiedId.indexOf("/");

  if (
    separatorIndex <= 0 ||
    separatorIndex !== qualifiedId.lastIndexOf("/") ||
    separatorIndex === qualifiedId.length - 1
  ) {
    throw new Error(`Invalid qualified task id "${qualifiedId}".`);
  }

  return {
    list: validateListName(qualifiedId.slice(0, separatorIndex)),
    id: validateTaskId(qualifiedId.slice(separatorIndex + 1))
  };
}

function descriptionFromTaskRecord(taskRecord: TaskRecord): string {
  return typeof taskRecord.description === "string" ? taskRecord.description : "";
}

function metadataFromTaskRecord(taskRecord: TaskRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(taskRecord)) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      metadata[key] = value;
    }
  }

  return metadata;
}

function createTask(list: string, id: string, taskRecord: TaskRecord): Task {
  return {
    list,
    id,
    qualifiedId: `${list}/${id}`,
    name: taskRecord.name as string,
    state: taskRecord.state as TaskState,
    description: descriptionFromTaskRecord(taskRecord),
    metadata: metadataFromTaskRecord(taskRecord)
  };
}

function matchesFilter(task: Task, filter?: ListFilter): boolean {
  if (!filter?.includeArchived && task.state === "archived") {
    return false;
  }

  if (filter?.state !== undefined && task.state !== filter.state) {
    return false;
  }

  return true;
}

function createTaskRecord(defaults: BackendDeps["defaults"], input: TaskCreate): TaskRecord {
  const taskRecord: TaskRecord = {
    name: input.name,
    state: input.state ?? defaults.state,
    description: input.description ?? ""
  };

  for (const [key, value] of Object.entries(defaults.metadata)) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      taskRecord[key] = value;
    }
  }

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      taskRecord[key] = value;
    }
  }

  return taskRecord;
}

function buildUpdatedTaskRecord(existing: TaskRecord, patch: TaskUpdate): TaskRecord {
  const nextTaskRecord: TaskRecord = {
    ...existing,
    name: patch.name ?? existing.name,
    state: existing.state,
    description: patch.description ?? descriptionFromTaskRecord(existing)
  };

  for (const [key, value] of Object.entries(patch.metadata ?? {})) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      nextTaskRecord[key] = value;
    }
  }

  return nextTaskRecord;
}

function buildTransitionedTaskRecord(existing: TaskRecord, to: TaskState): TaskRecord {
  return {
    ...existing,
    state: to,
    description: descriptionFromTaskRecord(existing)
  };
}

function parseStoreDocument(filePath: string, content: string) {
  let document;

  try {
    document = parseDocument(content, { keepSourceTokens: true, prettyErrors: false });
  } catch {
    throw malformedStore(filePath, "yaml");
  }

  if (document.errors.length > 0) {
    throw malformedStore(filePath, "yaml");
  }

  return document;
}

function assertValidStoreRecord(store: unknown, filePath: string): asserts store is StoreRecord {
  if (!isRecord(store)) {
    throw malformedStore(filePath, "store");
  }

  if (store.$schema !== STORE_SCHEMA_ID) {
    throw malformedStore(filePath, "$schema");
  }

  if (store.kind !== STORE_KIND) {
    throw malformedStore(filePath, "kind");
  }

  if (typeof store.version !== "number" || !Number.isInteger(store.version) || store.version !== STORE_VERSION) {
    throw malformedStore(filePath, "version");
  }

  if (!isRecord(store.lists)) {
    throw malformedStore(filePath, "lists");
  }
}

function assertValidTaskRecord(taskRecord: unknown, list: string, id: string): asserts taskRecord is TaskRecord {
  if (!isRecord(taskRecord)) {
    throw malformedTask(list, id, "task");
  }

  if ("$schema" in taskRecord && taskRecord.$schema !== TASK_SCHEMA_ID) {
    throw malformedTask(list, id, "$schema");
  }

  if ("kind" in taskRecord && taskRecord.kind !== TASK_KIND) {
    throw malformedTask(list, id, "kind");
  }

  if ("version" in taskRecord) {
    if (
      typeof taskRecord.version !== "number" ||
      !Number.isInteger(taskRecord.version) ||
      taskRecord.version !== TASK_VERSION
    ) {
      throw malformedTask(list, id, "version");
    }
  }

  if (typeof taskRecord.name !== "string" || taskRecord.name.length === 0) {
    throw malformedTask(list, id, "name");
  }

  if (typeof taskRecord.state !== "string" || !VALID_STATES.has(taskRecord.state as TaskState)) {
    throw malformedTask(list, id, "state");
  }

  if ("description" in taskRecord && typeof taskRecord.description !== "string") {
    throw malformedTask(list, id, "description");
  }
}

function validateStoreEntries(store: StoreRecord, filePath: string): void {
  const lists = store.lists;

  if (!isRecord(lists)) {
    throw malformedStore(filePath, "lists");
  }

  for (const [list, listRecord] of Object.entries(lists)) {
    try {
      validateListName(list);
    } catch {
      throw malformedStore(filePath, `lists.${list}`);
    }

    if (!isRecord(listRecord)) {
      throw malformedStore(filePath, `lists.${list}`);
    }

    for (const [id, taskRecord] of Object.entries(listRecord)) {
      try {
        validateTaskId(id);
      } catch {
        throw malformedTask(list, id, "id");
      }

      assertValidTaskRecord(taskRecord, list, id);
    }
  }
}

function serializeDocument(document: { toString(): string }): string {
  const serialized = document.toString();
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

async function readStore(fs: TaskListFs, filePath: string): Promise<{
  document: ReturnType<typeof parseStoreDocument>;
  store: StoreRecord;
}> {
  const content = await fs.readFile(filePath, "utf8");
  const document = parseStoreDocument(filePath, content);
  const store = document.toJS();

  assertValidStoreRecord(store, filePath);
  validateStoreEntries(store, filePath);

  return {
    document,
    store
  };
}

function getListsRecord(store: StoreRecord): Record<string, unknown> {
  return store.lists as Record<string, unknown>;
}

function getListRecord(store: StoreRecord, list: string): Record<string, unknown> | undefined {
  const listRecord = getListsRecord(store)[list];
  return isRecord(listRecord) ? listRecord : undefined;
}

function getTaskRecord(store: StoreRecord, list: string, id: string): TaskRecord | undefined {
  const listRecord = getListRecord(store, list);
  const taskRecord = listRecord?.[id];

  return isRecord(taskRecord) ? taskRecord : undefined;
}

function getTaskOrThrow(store: StoreRecord, list: string, id: string): TaskRecord {
  const taskRecord = getTaskRecord(store, list, id);

  if (!taskRecord) {
    throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
  }

  return taskRecord;
}

async function ensureStorePath(deps: BackendDeps): Promise<void> {
  if (!deps.create) {
    await deps.fs.stat(deps.path);
    return;
  }

  const existing = await statIfExists(deps.fs, deps.path);
  if (existing !== undefined) {
    return;
  }

  await writeAtomically(
    deps.fs,
    deps.path,
    serializeDocument(
      parseDocument(
        [
          `$schema: ${STORE_SCHEMA_ID}`,
          `kind: ${STORE_KIND}`,
          `version: ${STORE_VERSION}`,
          "lists: {}",
          ""
        ].join("\n")
      )
    )
  );
}

async function withStoreLock<T>(deps: BackendDeps, action: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(deps.path, {
    fs: deps.fs,
    staleMs: deps.lockStaleMs,
    retries: deps.lockRetries
  });

  try {
    return await action();
  } finally {
    await release();
  }
}

function createTasksView(deps: BackendDeps, list: string): Tasks {
  async function readTasks(filter?: ListFilter): Promise<Task[]> {
    const { store } = await readStore(deps.fs, deps.path);
    const listRecord = getListRecord(store, list);

    if (!listRecord) {
      return [];
    }

    const tasks = Object.entries(listRecord).map(([id, taskRecord]) => createTask(list, id, taskRecord as TaskRecord));

    return sortTasks(tasks.filter((task) => matchesFilter(task, filter)));
  }

  return {
    name: list,
    async all(filter?: ListFilter): Promise<Task[]> {
      return readTasks(filter);
    },
    async get(id: string): Promise<Task> {
      validateTaskId(id);
      const { store } = await readStore(deps.fs, deps.path);
      return createTask(list, id, getTaskOrThrow(store, list, id));
    },
    async create(input: TaskCreate): Promise<Task> {
      validateTaskId(input.id);

      return withStoreLock(deps, async () => {
        const { document, store } = await readStore(deps.fs, deps.path);
        if (getTaskRecord(store, list, input.id)) {
          throw new TaskAlreadyExistsError(`Task "${list}/${input.id}" already exists.`);
        }

        const taskRecord = createTaskRecord(deps.defaults, input);
        document.setIn(["lists", list, input.id], taskRecord);
        await writeAtomically(deps.fs, deps.path, serializeDocument(document));

        return createTask(list, input.id, taskRecord);
      });
    },
    async update(id: string, patch: TaskUpdate): Promise<Task> {
      validateTaskId(id);

      return withStoreLock(deps, async () => {
        const { document, store } = await readStore(deps.fs, deps.path);
        const existing = getTaskOrThrow(store, list, id);
        const nextTaskRecord = buildUpdatedTaskRecord(existing, patch);

        if (patch.name !== undefined) {
          document.setIn(["lists", list, id, "name"], patch.name);
        }

        if (patch.description !== undefined) {
          document.setIn(["lists", list, id, "description"], patch.description);
        }

        for (const [key, value] of Object.entries(patch.metadata ?? {})) {
          if (!RESERVED_TASK_KEYS.has(key)) {
            document.setIn(["lists", list, id, key], value);
          }
        }

        await writeAtomically(deps.fs, deps.path, serializeDocument(document));

        return createTask(list, id, nextTaskRecord);
      });
    },
    async transition(id: string, to: TaskState): Promise<Task> {
      validateTaskId(id);

      return withStoreLock(deps, async () => {
        const { document, store } = await readStore(deps.fs, deps.path);
        const existing = getTaskOrThrow(store, list, id);

        assertTransition(existing.state as TaskState, to);

        document.setIn(["lists", list, id, "state"], to);
        await writeAtomically(deps.fs, deps.path, serializeDocument(document));

        return createTask(list, id, buildTransitionedTaskRecord(existing, to));
      });
    },
    async delete(id: string): Promise<void> {
      validateTaskId(id);

      await withStoreLock(deps, async () => {
        const { document, store } = await readStore(deps.fs, deps.path);
        getTaskOrThrow(store, list, id);
        document.deleteIn(["lists", list, id]);
        await writeAtomically(deps.fs, deps.path, serializeDocument(document));
      });
    }
  };
}

export async function yamlFileBackend(deps: BackendDeps): Promise<TaskList> {
  await ensureStorePath(deps);

  const list = (name: string): Tasks => {
    const listName = validateListName(name);
    return createTasksView(deps, listName);
  };

  const lists = async (): Promise<string[]> => {
    const { store } = await readStore(deps.fs, deps.path);
    return sortStrings(Object.keys(getListsRecord(store)));
  };

  const allTasks = async (filter?: ListFilter): Promise<Task[]> => {
    const { store } = await readStore(deps.fs, deps.path);
    const tasks: Task[] = [];

    for (const [listName, listRecord] of Object.entries(getListsRecord(store))) {
      for (const [id, taskRecord] of Object.entries(listRecord as Record<string, unknown>)) {
        const task = createTask(listName, id, taskRecord as TaskRecord);
        if (matchesFilter(task, filter)) {
          tasks.push(task);
        }
      }
    }

    return sortTasks(tasks);
  };

  const get = async (qualifiedId: string): Promise<Task> => {
    const { list: listName, id } = parseQualifiedId(qualifiedId);
    return list(listName).get(id);
  };

  return {
    list,
    lists,
    allTasks,
    get
  };
}
