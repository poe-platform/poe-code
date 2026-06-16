import path from "node:path";
import { isMap, parseDocument, type Document, type YAMLMap } from "yaml";
import storeSchema from "../schema/store.schema.json" with { type: "json" };
import taskSchema from "../schema/task.schema.json" with { type: "json" };
import { eventsFromState, findEvent } from "../state-machine.js";
import { resolveStateMachine } from "../state.js";
import {
  AnchorNotFoundError,
  InvalidTransitionError,
  MalformedTaskError,
  OrderMismatchError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type BackendDeps,
  type ListFilter,
  type MoveAnchor,
  type Task,
  type TaskCreate,
  type TaskFireOptions,
  type TaskList,
  type TaskListFs,
  type Tasks,
  type TaskUpdate
} from "../types.js";
import {
  applyOrder,
  isTrimmedPrintableIdentifier,
  isRecord,
  rejectSymbolicLinkComponents,
  sortStrings,
  statIfExists,
  validateTaskId,
  validateTaskName,
  withFileLock,
  writeAtomically,
  type OrderedEntry
} from "./utils.js";

const STORE_KIND = "task-store";
const STORE_SCHEMA_ID = storeSchema.$id;
const STORE_VERSION = 1;
const TASK_KIND = "task";
const TASK_SCHEMA_ID = taskSchema.$id;
const TASK_VERSION = 1;
const RESERVED_TASK_KEYS = new Set([
  "$schema",
  "created",
  "description",
  "kind",
  "name",
  "state",
  "version"
]);

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
    !isTrimmedPrintableIdentifier(name) ||
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
  const description = getOwnEntry(taskRecord, "description");
  return typeof description === "string" ? description : "";
}

function metadataFromTaskRecord(taskRecord: TaskRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(taskRecord)) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      metadata[key] = value;
    }
  }

  return metadata;
}

function createTask(list: string, id: string, taskRecord: TaskRecord, sourcePath?: string): Task {
  return {
    list,
    id,
    qualifiedId: `${list}/${id}`,
    name: getOwnEntry(taskRecord, "name") as string,
    state: getOwnEntry(taskRecord, "state") as string,
    description: descriptionFromTaskRecord(taskRecord),
    metadata: metadataFromTaskRecord(taskRecord),
    ...(sourcePath !== undefined && { sourcePath: path.resolve(sourcePath) })
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

function createTaskRecord(
  defaults: BackendDeps["defaults"],
  input: TaskCreate,
  initialState: string
): TaskRecord {
  const taskRecord: TaskRecord = Object.assign(Object.create(null), {
    name: input.name,
    state: initialState,
    description: input.description ?? ""
  });

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

  taskRecord.created = new Date().toISOString();
  return taskRecord;
}

function assertCreateDoesNotSetState(input: TaskCreate): void {
  if (Object.prototype.hasOwnProperty.call(input, "state")) {
    throw new Error(
      'Tasks.create() does not accept "state"; new tasks always start at stateMachine.initial.'
    );
  }
}

function assertCreateHasId(input: TaskCreate): asserts input is TaskCreate & { id: string } {
  if (input.id === undefined) {
    throw new Error("id is required for yaml-file backend");
  }
}

function assertUpdateDoesNotSetState(patch: TaskUpdate): void {
  if (Object.prototype.hasOwnProperty.call(patch, "state")) {
    throw new Error('Tasks.update() does not accept "state"; use fire() to change task state.');
  }
}

function buildUpdatedTaskRecord(existing: TaskRecord, patch: TaskUpdate): TaskRecord {
  const nextTaskRecord: TaskRecord = Object.assign(Object.create(null), existing, {
    ...existing,
    name: patch.name ?? existing.name,
    state: existing.state,
    description: patch.description ?? descriptionFromTaskRecord(existing)
  });

  for (const [key, value] of Object.entries(patch.metadata ?? {})) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      nextTaskRecord[key] = value;
    }
  }

  return nextTaskRecord;
}

function buildTransitionedTaskRecord(existing: TaskRecord, to: string): TaskRecord {
  return Object.assign(Object.create(null), existing, {
    ...existing,
    state: to,
    description: descriptionFromTaskRecord(existing)
  });
}

function buildFiredTaskRecord(
  existing: TaskRecord,
  to: string,
  metadataPatch?: Record<string, unknown>
): TaskRecord {
  const nextTaskRecord = buildTransitionedTaskRecord(existing, to);

  for (const [key, value] of Object.entries(metadataPatch ?? {})) {
    if (!RESERVED_TASK_KEYS.has(key)) {
      nextTaskRecord[key] = value;
    }
  }

  return nextTaskRecord;
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

  if (getOwnEntry(store, "$schema") !== STORE_SCHEMA_ID) {
    throw malformedStore(filePath, "$schema");
  }

  if (getOwnEntry(store, "kind") !== STORE_KIND) {
    throw malformedStore(filePath, "kind");
  }

  const version = getOwnEntry(store, "version");
  if (typeof version !== "number" || !Number.isInteger(version) || version !== STORE_VERSION) {
    throw malformedStore(filePath, "version");
  }

  if (!isRecord(getOwnEntry(store, "lists"))) {
    throw malformedStore(filePath, "lists");
  }
}

function assertValidTaskRecord(
  taskRecord: unknown,
  list: string,
  id: string,
  validStates: ReadonlySet<string>
): asserts taskRecord is TaskRecord {
  if (!isRecord(taskRecord)) {
    throw malformedTask(list, id, "task");
  }

  if (
    hasOwnTaskField(taskRecord, "$schema") &&
    getOwnEntry(taskRecord, "$schema") !== TASK_SCHEMA_ID
  ) {
    throw malformedTask(list, id, "$schema");
  }

  if (hasOwnTaskField(taskRecord, "kind") && getOwnEntry(taskRecord, "kind") !== TASK_KIND) {
    throw malformedTask(list, id, "kind");
  }

  if (hasOwnTaskField(taskRecord, "version")) {
    const version = getOwnEntry(taskRecord, "version");
    if (typeof version !== "number" || !Number.isInteger(version) || version !== TASK_VERSION) {
      throw malformedTask(list, id, "version");
    }
  }

  const name = getOwnEntry(taskRecord, "name");
  if (!hasOwnTaskField(taskRecord, "name") || typeof name !== "string" || name.length === 0) {
    throw malformedTask(list, id, "name");
  }

  const state = getOwnEntry(taskRecord, "state");
  if (
    !hasOwnTaskField(taskRecord, "state") ||
    typeof state !== "string" ||
    !validStates.has(state)
  ) {
    throw malformedTask(list, id, "state");
  }

  if (
    hasOwnTaskField(taskRecord, "description") &&
    typeof getOwnEntry(taskRecord, "description") !== "string"
  ) {
    throw malformedTask(list, id, "description");
  }
}

function hasOwnTaskField(taskRecord: TaskRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(taskRecord, key);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function validateStoreEntries(
  store: StoreRecord,
  filePath: string,
  validStates: ReadonlySet<string>
): void {
  const lists = getOwnEntry(store, "lists");

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

      assertValidTaskRecord(taskRecord, list, id, validStates);
    }
  }
}

function serializeDocument(document: { toString(): string }): string {
  const serialized = document.toString();
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

async function readStore(
  fs: TaskListFs,
  filePath: string,
  validStates: ReadonlySet<string>
): Promise<{
  document: ReturnType<typeof parseStoreDocument>;
  store: StoreRecord;
}> {
  const content = await fs.readFile(filePath, "utf8");
  const document = parseStoreDocument(filePath, content);
  const store = document.toJS();

  assertValidStoreRecord(store, filePath);
  validateStoreEntries(store, filePath, validStates);

  return {
    document,
    store
  };
}

function getListsRecord(store: StoreRecord): Record<string, unknown> {
  const lists = getOwnEntry(store, "lists");
  return isRecord(lists) ? lists : {};
}

function getListRecord(store: StoreRecord, list: string): Record<string, unknown> | undefined {
  const listRecord = getOwnEntry(getListsRecord(store), list);
  return isRecord(listRecord) ? listRecord : undefined;
}

function getTaskRecord(store: StoreRecord, list: string, id: string): TaskRecord | undefined {
  const listRecord = getListRecord(store, list);
  const taskRecord =
    listRecord !== undefined && Object.prototype.hasOwnProperty.call(listRecord, id)
      ? listRecord[id]
      : undefined;

  return isRecord(taskRecord) ? taskRecord : undefined;
}

function getTaskOrThrow(store: StoreRecord, list: string, id: string): TaskRecord {
  const taskRecord = getTaskRecord(store, list, id);

  if (!taskRecord) {
    throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
  }

  return taskRecord;
}

function getListNode(document: Document, list: string): YAMLMap | undefined {
  const lists = document.get("lists");
  if (!isMap(lists)) {
    return undefined;
  }

  const listNode = lists.get(list);
  if (!isMap(listNode)) {
    return undefined;
  }

  return listNode;
}

function pairKey(pair: { key: unknown }): string | undefined {
  const key = pair.key;
  if (typeof key === "string") {
    return key;
  }
  if (
    key &&
    typeof key === "object" &&
    "value" in key &&
    typeof (key as { value: unknown }).value === "string"
  ) {
    return (key as { value: string }).value;
  }
  return undefined;
}

function findItemIndex(listNode: YAMLMap, id: string): number {
  return listNode.items.findIndex((pair) => pairKey(pair) === id);
}

function activeItemIds(listNode: YAMLMap, validStates: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const pair of listNode.items) {
    const id = pairKey(pair);
    if (id === undefined) continue;

    const value = pair.value;
    let state: unknown;
    if (
      value &&
      typeof value === "object" &&
      "get" in value &&
      typeof (value as { get: unknown }).get === "function"
    ) {
      state = (value as YAMLMap).get("state");
    } else if (isRecord(value)) {
      state = value.state;
    }

    if (typeof state === "string" && validStates.has(state) && state !== "archived") {
      ids.push(id);
    }
  }
  return ids;
}

async function ensureStorePath(deps: BackendDeps): Promise<void> {
  await rejectSymbolicLinkComponents(deps.fs, deps.path);

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

function createTasksView(deps: BackendDeps, list: string): Tasks {
  const stateMachine = resolveStateMachine(deps.stateMachine);
  const validStates = new Set(stateMachine.states);

  async function readTasks(filter?: ListFilter): Promise<Task[]> {
    const { store } = await readStore(deps.fs, deps.path, validStates);
    const listRecord = getListRecord(store, list);

    if (!listRecord) {
      return [];
    }

    const entries: OrderedEntry[] = Object.entries(listRecord)
      .map(([id, taskRecord]) => ({
        task: createTask(list, id, taskRecord as TaskRecord, deps.path),
        raw: taskRecord as TaskRecord
      }))
      .filter(({ task }) => matchesFilter(task, filter));

    return applyOrder(entries, filter?.order);
  }

  function assertFireableTaskEvent(task: Task, eventName: string) {
    const event = findEvent(stateMachine, task.state, eventName);

    if (event === undefined) {
      throw new InvalidTransitionError({
        task,
        event: eventName,
        to: stateMachine.events[eventName]?.to,
        reason: `Cannot fire event "${eventName}" from task state "${task.state}".`
      });
    }

    return event;
  }

  return {
    name: list,
    stateMachine,
    async all(filter?: ListFilter): Promise<Task[]> {
      return readTasks(filter);
    },
    async get(id: string): Promise<Task> {
      validateTaskId(id);
      const { store } = await readStore(deps.fs, deps.path, validStates);
      return createTask(list, id, getTaskOrThrow(store, list, id), deps.path);
    },
    async create(input: TaskCreate): Promise<Task> {
      assertCreateDoesNotSetState(input);
      assertCreateHasId(input);
      validateTaskId(input.id);
      validateTaskName(input.name);

      const { document, store } = await readStore(deps.fs, deps.path, validStates);
      if (getTaskRecord(store, list, input.id)) {
        throw new TaskAlreadyExistsError(`Task "${list}/${input.id}" already exists.`);
      }

      const taskRecord = createTaskRecord(deps.defaults, input, stateMachine.initial);
      document.setIn(["lists", list, input.id], taskRecord);
      await writeAtomically(deps.fs, deps.path, serializeDocument(document));

      return createTask(list, input.id, taskRecord, deps.path);
    },
    async update(id: string, patch: TaskUpdate): Promise<Task> {
      assertUpdateDoesNotSetState(patch);
      validateTaskId(id);
      if (patch.name !== undefined) {
        validateTaskName(patch.name);
      }

      const { document, store } = await readStore(deps.fs, deps.path, validStates);
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

      return createTask(list, id, nextTaskRecord, deps.path);
    },
    async fire(id: string, eventName: string, opts?: TaskFireOptions): Promise<Task> {
      validateTaskId(id);

      const { event, nextTask } = await withFileLock(deps.fs, `${deps.path}.lock`, async () => {
        const { document, store } = await readStore(deps.fs, deps.path, validStates);
        const existing = getTaskOrThrow(store, list, id);
        const task = createTask(list, id, existing, deps.path);
        const event = assertFireableTaskEvent(task, eventName);
        const guardResult = event.guard?.(task) ?? true;

        if (guardResult !== true) {
          throw new InvalidTransitionError({
            task,
            event: eventName,
            to: event.to,
            reason: guardResult
          });
        }

        await event.onExit?.(task);

        const nextTaskRecord = buildFiredTaskRecord(existing, event.to, opts?.metadataPatch);
        document.setIn(["lists", list, id, "state"], event.to);

        for (const [key, value] of Object.entries(opts?.metadataPatch ?? {})) {
          if (!RESERVED_TASK_KEYS.has(key)) {
            document.setIn(["lists", list, id, key], value);
          }
        }

        await writeAtomically(deps.fs, deps.path, serializeDocument(document));

        return {
          event,
          nextTask: createTask(list, id, nextTaskRecord, deps.path)
        };
      });

      await event.onEnter?.(nextTask);

      return nextTask;
    },
    async canFire(id: string, eventName: string): Promise<boolean> {
      validateTaskId(id);
      const { store } = await readStore(deps.fs, deps.path, validStates);
      const task = createTask(list, id, getTaskOrThrow(store, list, id), deps.path);
      const event = findEvent(stateMachine, task.state, eventName);

      if (event === undefined) {
        return false;
      }

      return (event.guard?.(task) ?? true) === true;
    },
    async events(id: string): Promise<readonly string[]> {
      validateTaskId(id);
      const { store } = await readStore(deps.fs, deps.path, validStates);
      const task = createTask(list, id, getTaskOrThrow(store, list, id), deps.path);

      return eventsFromState(stateMachine, task.state);
    },
    async delete(id: string): Promise<void> {
      validateTaskId(id);

      const { document, store } = await readStore(deps.fs, deps.path, validStates);
      getTaskOrThrow(store, list, id);
      document.deleteIn(["lists", list, id]);
      await writeAtomically(deps.fs, deps.path, serializeDocument(document));
    },
    async move(id: string, anchor: MoveAnchor): Promise<Task> {
      validateTaskId(id);

      const { document, store } = await readStore(deps.fs, deps.path, validStates);
      const taskRecord = getTaskOrThrow(store, list, id);
      const listNode = getListNode(document, list);
      if (!listNode) {
        throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
      }

      const fromIndex = findItemIndex(listNode, id);
      if (fromIndex < 0) {
        throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
      }

      const [movedPair] = listNode.items.splice(fromIndex, 1);

      let insertIndex: number;
      if ("position" in anchor) {
        insertIndex = anchor.position === "top" ? 0 : listNode.items.length;
      } else {
        const anchorId = "before" in anchor ? anchor.before : anchor.after;
        const activeIds = new Set(activeItemIds(listNode, validStates));
        if (!activeIds.has(anchorId)) {
          listNode.items.splice(fromIndex, 0, movedPair);
          throw new AnchorNotFoundError(anchorId);
        }
        const anchorIndex = findItemIndex(listNode, anchorId);
        if (anchorIndex < 0) {
          listNode.items.splice(fromIndex, 0, movedPair);
          throw new AnchorNotFoundError(anchorId);
        }
        insertIndex = "before" in anchor ? anchorIndex : anchorIndex + 1;
      }

      listNode.items.splice(insertIndex, 0, movedPair);
      await writeAtomically(deps.fs, deps.path, serializeDocument(document));

      return createTask(list, id, taskRecord, deps.path);
    },
    async reorder(ids: readonly string[]): Promise<readonly Task[]> {
      for (const id of ids) {
        validateTaskId(id);
      }

      const { document, store } = await readStore(deps.fs, deps.path, validStates);
      const listNode = getListNode(document, list);
      if (!listNode) {
        throw new OrderMismatchError({ missing: [...ids], extra: [] });
      }

      const currentActive = activeItemIds(listNode, validStates);
      const currentSet = new Set(currentActive);
      const inputSet = new Set(ids);
      const missing = currentActive.filter((id) => !inputSet.has(id));
      const extra = ids.filter((id) => !currentSet.has(id));

      if (inputSet.size !== ids.length || missing.length > 0 || extra.length > 0) {
        throw new OrderMismatchError({ missing, extra });
      }

      const archivedPairs = listNode.items.filter((pair) => {
        const id = pairKey(pair);
        return id !== undefined && !currentSet.has(id);
      });
      const orderedActive = ids.map((id) => {
        const pair = listNode.items.find((p) => pairKey(p) === id);
        if (!pair) {
          throw new OrderMismatchError({ missing: [id], extra: [] });
        }
        return pair;
      });

      listNode.items.splice(0, listNode.items.length, ...orderedActive, ...archivedPairs);
      await writeAtomically(deps.fs, deps.path, serializeDocument(document));

      const tasks = ids.map((id) =>
        createTask(list, id, getTaskOrThrow(store, list, id), deps.path)
      );
      return tasks;
    }
  };
}

export async function yamlFileBackend(deps: BackendDeps): Promise<TaskList> {
  await ensureStorePath(deps);
  const stateMachine = resolveStateMachine(deps.stateMachine);
  const validStates = new Set(stateMachine.states);

  const list = (name: string): Tasks => {
    const listName = validateListName(name);
    return createTasksView({ ...deps, stateMachine }, listName);
  };

  const lists = async (): Promise<string[]> => {
    const { store } = await readStore(deps.fs, deps.path, validStates);
    return sortStrings(Object.keys(getListsRecord(store)));
  };

  const allTasks = async (filter?: ListFilter): Promise<Task[]> => {
    const { store } = await readStore(deps.fs, deps.path, validStates);
    const result: Task[] = [];

    const listNames = sortStrings(Object.keys(getListsRecord(store)));
    for (const listName of listNames) {
      const listRecord = getOwnEntry(getListsRecord(store), listName);
      if (!isRecord(listRecord)) continue;

      const entries: OrderedEntry[] = Object.entries(listRecord)
        .map(([id, taskRecord]) => ({
          task: createTask(listName, id, taskRecord as TaskRecord, deps.path),
          raw: taskRecord as TaskRecord
        }))
        .filter(({ task }) => matchesFilter(task, filter));

      result.push(...applyOrder(entries, filter?.order));
    }

    return result;
  };

  const get = async (qualifiedId: string): Promise<Task> => {
    const { list: listName, id } = parseQualifiedId(qualifiedId);
    return list(listName).get(id);
  };

  const moveBetweenLists = async (qualifiedId: string, targetList: string): Promise<Task> => {
    const { list: sourceListName, id } = parseQualifiedId(qualifiedId);
    const targetListName = validateListName(targetList);

    const { document, store } = await readStore(deps.fs, deps.path, validStates);
    const taskRecord = getTaskOrThrow(store, sourceListName, id);

    if (sourceListName === targetListName) {
      return createTask(targetListName, id, taskRecord, deps.path);
    }

    if (getTaskRecord(store, targetListName, id)) {
      throw new TaskAlreadyExistsError(`Task "${targetListName}/${id}" already exists.`);
    }

    document.deleteIn(["lists", sourceListName, id]);
    document.setIn(["lists", targetListName, id], taskRecord);
    await writeAtomically(deps.fs, deps.path, serializeDocument(document));

    return createTask(targetListName, id, taskRecord, deps.path);
  };

  return {
    list,
    lists,
    allTasks,
    get,
    moveBetweenLists
  };
}
