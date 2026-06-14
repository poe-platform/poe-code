import {
  AnchorNotFoundError,
  InvalidTransitionError,
  OrderMismatchError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  eventsFromState,
  findEvent,
  validateMachine,
  type ListFilter,
  type MoveAnchor,
  type StateMachineDef,
  type Task,
  type TaskCreate,
  type TaskFireOptions,
  type TaskList,
  type TaskOrder,
  type Tasks,
  type TaskUpdate
} from "@poe-code/task-list";

import { maestroTaskStateMachine } from "../state-machine.js";

type MockTaskListMethod =
  | "allTasks"
  | "get"
  | "list"
  | "lists"
  | "create"
  | "update"
  | "setState"
  | "fire"
  | "comment"
  | "refresh"
  | "all"
  | "canFire"
  | "events"
  | "delete"
  | "move"
  | "reorder"
  | "moveBetweenLists";

export interface MockTaskListEvent {
  method: MockTaskListMethod;
  args: readonly unknown[];
  result: unknown;
}

export interface MockTaskListClock {
  now(): Date | number | string;
}

export interface MockTaskListFailures {
  getError?: (taskId: string) => Error | undefined;
  setStateError?: (taskId: string, from: string, to: string) => Error | undefined;
  refreshError?: (taskId: string) => Error | undefined;
  allTasksError?: (state: string | undefined) => Error | undefined;
  transient?: MockTaskListTransientFailures;
}

export type MockTaskListTransientFailures = Partial<
  Record<
    MockTaskListMethod,
    | number
    | Error
    | {
        times?: number;
        error?: Error | (() => Error);
      }
  >
>;

export interface CreateMockTaskListOptions {
  tasks?: readonly Task[];
  lists?: readonly string[];
  stateMachine?: StateMachineDef;
  failures?: MockTaskListFailures;
  clock?: MockTaskListClock;
  readers?: MockTaskListReaders;
}

export interface MockTaskListReaders {
  allTasks?: (
    filter: ListFilter | undefined,
    store: MockTaskListReadStore
  ) => readonly Task[] | Promise<readonly Task[]>;
  get?: (qualifiedId: string, store: MockTaskListReadStore) => Task | Promise<Task>;
}

export interface MockTaskListReadStore {
  get(qualifiedId: string): Task;
  listNames(): string[];
}

export interface MockTaskListMutationStore {
  get(qualifiedId: string): Task;
  set(task: Task): void;
  delete(qualifiedId: string): void;
  listNames(): string[];
}

export type MockTasks = Tasks & {
  setState(id: string, state: string, opts?: TaskFireOptions): Promise<Task>;
  refresh(id: string): Promise<Task>;
  comment(id: string, body: string): Promise<void>;
};

export type MockTaskList = TaskList & {
  readonly taskList: TaskList;
  readonly stateMachine: StateMachineDef;
  readonly events: MockTaskListEvent[];
  setState(qualifiedId: string, state: string, opts?: TaskFireOptions): Promise<Task>;
  refresh(qualifiedId: string): Promise<Task>;
  mutate(mutator: (store: MockTaskListMutationStore) => void): void;
};

interface Store {
  tasks: Map<string, Task>;
  listNames: Set<string>;
  listOrder: Map<string, string[]>;
}

const archivedState = "archived";

export function createMockTaskList(options: CreateMockTaskListOptions = {}): MockTaskList {
  const stateMachine = options.stateMachine ?? createDefaultMaestroStateMachine();
  validateMachine(stateMachine);

  const store = seedStore(options.tasks ?? [], options.lists ?? []);
  const events: MockTaskListEvent[] = [];
  const transientFailures = createTransientFailures(options.failures?.transient);

  const record = async <T>(
    method: MockTaskListMethod,
    args: readonly unknown[],
    action: () => Promise<T> | T
  ): Promise<T> => {
    try {
      const transient = transientFailures(method);
      if (transient !== undefined) {
        throw transient;
      }

      const result = await action();
      events.push({ method, args, result: cloneResult(result) });
      return result;
    } catch (error) {
      events.push({ method, args, result: error });
      throw error;
    }
  };
  const recordSync = <T>(
    method: MockTaskListMethod,
    args: readonly unknown[],
    action: () => T
  ): T => {
    try {
      const transient = transientFailures(method);
      if (transient !== undefined) {
        throw transient;
      }

      const result = action();
      events.push({ method, args, result: cloneResult(result) });
      return result;
    } catch (error) {
      events.push({ method, args, result: error });
      throw error;
    }
  };

  const getStored = (qualifiedId: string): Task => {
    const task = store.tasks.get(qualifiedId);
    if (task === undefined) {
      const parsed = parseQualifiedId(qualifiedId);
      throw new TaskNotFoundError(`Task "${parsed.list}/${parsed.id}" not found.`);
    }

    return task;
  };

  const setStored = (task: Task): void => {
    const next = normalizeTask(task);
    const existing = store.tasks.get(next.qualifiedId);
    const previousActive = existing !== undefined && isActive(existing);
    const nextActive = isActive(next);

    store.tasks.set(next.qualifiedId, next);
    store.listNames.add(next.list);

    const order = ensureListOrder(store, next.list);
    const orderHasTask = order.includes(next.id);
    if (nextActive && !orderHasTask) {
      order.push(next.id);
    }
    if (!nextActive && orderHasTask) {
      order.splice(order.indexOf(next.id), 1);
    }
    if (!previousActive && nextActive && !order.includes(next.id)) {
      order.push(next.id);
    }
  };

  const createReadStore = (): MockTaskListReadStore => ({
    get: (qualifiedId) => cloneTask(getStored(qualifiedId)),
    listNames: () => sortStrings([...store.listNames])
  });

  const taskList: TaskList = {
    list(name: string): Tasks {
      return recordSync("list", [name], () => createTasksView(name));
    },
    lists(): Promise<string[]> {
      return record("lists", [], () => sortStrings([...store.listNames]));
    },
    allTasks(filter?: ListFilter): Promise<Task[]> {
      return record("allTasks", [filter], async () => {
        const injected = options.failures?.allTasksError?.(filter?.state);
        if (injected !== undefined) {
          throw injected;
        }

        if (options.readers?.allTasks !== undefined) {
          return cloneTasks(await options.readers.allTasks(filter, createReadStore()));
        }

        const result: Task[] = [];
        for (const listName of sortStrings([...store.listNames])) {
          result.push(...allForList(listName, filter));
        }
        return result;
      });
    },
    get(qualifiedId: string): Promise<Task> {
      return record("get", [qualifiedId], async () => {
        const injected = options.failures?.getError?.(qualifiedId);
        if (injected !== undefined) {
          throw injected;
        }

        if (options.readers?.get !== undefined) {
          return cloneTask(await options.readers.get(qualifiedId, createReadStore()));
        }

        return cloneTask(getStored(qualifiedId));
      });
    },
    moveBetweenLists(qualifiedId: string, targetList: string): Promise<Task> {
      return record("moveBetweenLists", [qualifiedId, targetList], () => {
        const source = getStored(qualifiedId);
        const targetQualifiedId = qualify(targetList, source.id);

        if (targetQualifiedId === source.qualifiedId) {
          return cloneTask(source);
        }
        if (store.tasks.has(targetQualifiedId)) {
          throw new TaskAlreadyExistsError(`Task "${targetList}/${source.id}" already exists.`);
        }

        removeFromOrder(store, source);
        store.tasks.delete(source.qualifiedId);
        const moved = normalizeTask({
          ...source,
          list: targetList,
          qualifiedId: targetQualifiedId
        });
        setStored(moved);
        return cloneTask(moved);
      });
    }
  };

  const createTasksView = (name: string): MockTasks => {
    const listName = validateName(name, "task list");

    return {
      name: listName,
      stateMachine,
      all(filter?: ListFilter): Promise<Task[]> {
        return record("all", [listName, filter], () => allForList(listName, filter));
      },
      get(id: string): Promise<Task> {
        return record("get", [qualify(listName, id)], async () => {
          const qualifiedId = qualify(listName, id);
          const injected = options.failures?.getError?.(qualifiedId);
          if (injected !== undefined) {
            throw injected;
          }

          if (options.readers?.get !== undefined) {
            return cloneTask(await options.readers.get(qualifiedId, createReadStore()));
          }

          return cloneTask(getStored(qualifiedId));
        });
      },
      create(input: TaskCreate): Promise<Task> {
        return record("create", [listName, input], () => {
          assertCreateDoesNotSetState(input);
          assertCreateHasId(input);
          const id = validateName(input.id, "task id");
          const qualifiedId = qualify(listName, id);

          if (store.tasks.has(qualifiedId)) {
            throw new TaskAlreadyExistsError(`Task "${listName}/${id}" already exists.`);
          }

          const task = normalizeTask({
            list: listName,
            id,
            qualifiedId,
            name: input.name,
            state: stateMachine.initial,
            description: input.description ?? "",
            metadata: {
              ...createdMetadata(options.clock),
              ...(input.metadata ?? {})
            }
          });
          setStored(task);
          return cloneTask(task);
        });
      },
      update(id: string, patch: TaskUpdate): Promise<Task> {
        return record("update", [qualify(listName, id), patch], () => {
          assertUpdateDoesNotSetState(patch);
          const existing = getStored(qualify(listName, id));
          const next = normalizeTask({
            ...existing,
            name: patch.name ?? existing.name,
            description: patch.description ?? existing.description,
            metadata: {
              ...existing.metadata,
              ...(patch.metadata ?? {})
            }
          });
          setStored(next);
          return cloneTask(next);
        });
      },
      fire(id: string, eventName: string, fireOptions?: TaskFireOptions): Promise<Task> {
        return record("fire", [qualify(listName, id), eventName, fireOptions], () =>
          fireStoredTask(qualify(listName, id), eventName, fireOptions)
        );
      },
      setState(id: string, targetState: string, fireOptions?: TaskFireOptions): Promise<Task> {
        return record("setState", [qualify(listName, id), targetState, fireOptions], () =>
          setStoredTaskState(qualify(listName, id), targetState, fireOptions)
        );
      },
      refresh(id: string): Promise<Task> {
        return record("refresh", [qualify(listName, id)], () =>
          refreshStoredTask(qualify(listName, id))
        );
      },
      comment(id: string, body: string): Promise<void> {
        return record("comment", [qualify(listName, id), body], () => undefined);
      },
      canFire(id: string, eventName: string): Promise<boolean> {
        return record("canFire", [qualify(listName, id), eventName], () => {
          const task = getStored(qualify(listName, id));
          const event = findEvent(stateMachine, task.state, eventName);
          return event !== undefined && (event.guard?.(cloneTask(task)) ?? true) === true;
        });
      },
      events(id: string): Promise<readonly string[]> {
        return record("events", [qualify(listName, id)], () => {
          const task = getStored(qualify(listName, id));
          return eventsFromState(stateMachine, task.state);
        });
      },
      delete(id: string): Promise<void> {
        return record("delete", [qualify(listName, id)], () => {
          const existing = getStored(qualify(listName, id));
          removeFromOrder(store, existing);
          store.tasks.delete(existing.qualifiedId);
        });
      },
      move(id: string, anchor: MoveAnchor): Promise<Task> {
        return record("move", [qualify(listName, id), anchor], () => {
          const existing = getStored(qualify(listName, id));
          const order = ensureListOrder(store, listName);
          const fromIndex = order.indexOf(existing.id);
          if (fromIndex < 0) {
            throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
          }

          order.splice(fromIndex, 1);
          const insertIndex = resolveMoveIndex(order, anchor);
          order.splice(insertIndex, 0, existing.id);
          return cloneTask(existing);
        });
      },
      reorder(ids: readonly string[]): Promise<readonly Task[]> {
        return record("reorder", [listName, ids], () => {
          const current = ensureListOrder(store, listName);
          const missing = current.filter((id) => !ids.includes(id));
          const seen = new Set<string>();
          const currentSet = new Set(current);
          const extra = ids.filter((id) => {
            if (!currentSet.has(id) || seen.has(id)) {
              return true;
            }
            seen.add(id);
            return false;
          });

          if (missing.length > 0 || extra.length > 0) {
            throw new OrderMismatchError({ missing, extra });
          }

          store.listOrder.set(listName, [...ids]);
          return allForList(listName);
        });
      }
    };
  };

  const refreshStoredTask = (qualifiedId: string): Task => {
    const injected = options.failures?.refreshError?.(qualifiedId);
    if (injected !== undefined) {
      throw injected;
    }

    return cloneTask(getStored(qualifiedId));
  };

  const setStoredTaskState = async (
    qualifiedId: string,
    targetState: string,
    fireOptions?: TaskFireOptions
  ): Promise<Task> => {
    const existing = getStored(qualifiedId);
    const injected = options.failures?.setStateError?.(qualifiedId, existing.state, targetState);
    if (injected !== undefined) {
      throw injected;
    }

    if (!stateMachine.states.includes(targetState)) {
      throw new InvalidTransitionError({
        task: cloneTask(existing),
        to: targetState,
        reason: `Cannot transition task from "${existing.state}" to "${targetState}".`
      });
    }

    const eventName = Object.keys(stateMachine.events).find(
      (name) => findEvent(stateMachine, existing.state, name)?.to === targetState
    );
    if (eventName === undefined) {
      throw new InvalidTransitionError({
        task: cloneTask(existing),
        to: targetState,
        reason: `Cannot transition task from "${existing.state}" to "${targetState}".`
      });
    }

    return fireStoredTask(qualifiedId, eventName, fireOptions);
  };

  const fireStoredTask = async (
    qualifiedId: string,
    eventName: string,
    fireOptions?: TaskFireOptions
  ): Promise<Task> => {
    const existing = getStored(qualifiedId);
    const event = findEvent(stateMachine, existing.state, eventName);

    if (event === undefined) {
      throw new InvalidTransitionError({
        task: cloneTask(existing),
        event: eventName,
        to: stateMachine.events[eventName]?.to,
        reason: `Cannot fire event "${eventName}" from task state "${existing.state}".`
      });
    }

    const guard = event.guard?.(cloneTask(existing)) ?? true;
    if (guard !== true) {
      throw new InvalidTransitionError({
        task: cloneTask(existing),
        event: eventName,
        to: event.to,
        reason: guard
      });
    }

    const next = normalizeTask({
      ...existing,
      state: event.to,
      metadata: {
        ...existing.metadata,
        ...(fireOptions?.metadataPatch ?? {})
      }
    });
    await event.onExit?.(cloneTask(existing));
    setStored(next);
    await event.onEnter?.(cloneTask(next));
    return cloneTask(next);
  };

  const mock = {
    ...taskList,
    taskList,
    stateMachine,
    events,
    setState(
      qualifiedId: string,
      targetState: string,
      fireOptions?: TaskFireOptions
    ): Promise<Task> {
      return record("setState", [qualifiedId, targetState, fireOptions], () =>
        setStoredTaskState(qualifiedId, targetState, fireOptions)
      );
    },
    refresh(qualifiedId: string): Promise<Task> {
      return record("refresh", [qualifiedId], () => refreshStoredTask(qualifiedId));
    },
    mutate(mutator: (store: MockTaskListMutationStore) => void): void {
      mutator({
        get: (qualifiedId) => cloneTask(getStored(qualifiedId)),
        set: setStored,
        delete: (qualifiedId) => {
          const existing = getStored(qualifiedId);
          removeFromOrder(store, existing);
          store.tasks.delete(existing.qualifiedId);
        },
        listNames: () => sortStrings([...store.listNames])
      });
    }
  } satisfies MockTaskList;

  return mock;

  function allForList(listName: string, filter?: ListFilter): Task[] {
    const tasks = [...store.tasks.values()].filter(
      (task) => task.list === listName && matchesFilter(task, filter)
    );

    return applyOrder(tasks, ensureListOrder(store, listName), filter?.order).map(cloneTask);
  }
}

function createDefaultMaestroStateMachine(): StateMachineDef {
  const states = [...maestroTaskStateMachine.states];
  return {
    initial: states[0] ?? "queued",
    states,
    events: Object.fromEntries(states.map((state) => [state, { from: "*", to: state }]))
  };
}

function seedStore(tasks: readonly Task[], lists: readonly string[]): Store {
  const store: Store = {
    tasks: new Map(),
    listNames: new Set(lists.map((list) => validateName(list, "task list"))),
    listOrder: new Map()
  };

  for (const task of tasks) {
    const normalized = normalizeTask(task);
    store.tasks.set(normalized.qualifiedId, normalized);
    store.listNames.add(normalized.list);

    if (isActive(normalized)) {
      ensureListOrder(store, normalized.list).push(normalized.id);
    }
  }

  return store;
}

function normalizeTask(task: Task): Task {
  const list = validateName(task.list, "task list");
  const id = validateName(task.id, "task id");
  const qualifiedId = task.qualifiedId === qualify(list, id) ? task.qualifiedId : qualify(list, id);

  return {
    ...task,
    list,
    id,
    qualifiedId,
    description: task.description ?? "",
    metadata: { ...task.metadata }
  };
}

function parseQualifiedId(qualifiedId: string): { list: string; id: string } {
  const separatorIndex = qualifiedId.indexOf("/");

  if (
    separatorIndex <= 0 ||
    separatorIndex !== qualifiedId.lastIndexOf("/") ||
    separatorIndex === qualifiedId.length - 1
  ) {
    throw new Error(`Invalid qualified task id "${qualifiedId}".`);
  }

  return {
    list: validateName(qualifiedId.slice(0, separatorIndex), "task list"),
    id: validateName(qualifiedId.slice(separatorIndex + 1), "task id")
  };
}

function validateName(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    throw new Error(`Invalid ${label} name "${String(value)}".`);
  }

  return value;
}

function qualify(list: string, id: string): string {
  return `${validateName(list, "task list")}/${validateName(id, "task id")}`;
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
    throw new Error("id is required for mock task-list backend");
  }
}

function assertUpdateDoesNotSetState(patch: TaskUpdate): void {
  if (Object.prototype.hasOwnProperty.call(patch, "state")) {
    throw new Error('Tasks.update() does not accept "state"; use fire() to change task state.');
  }
}

function createdMetadata(clock: MockTaskListClock | undefined): Record<string, unknown> {
  if (clock === undefined) {
    return {};
  }

  const value = clock.now();
  const created =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "number"
        ? new Date(value).toISOString()
        : value;

  return { created };
}

function matchesFilter(task: Task, filter?: ListFilter): boolean {
  if (!filter?.includeArchived && task.state === archivedState) {
    return false;
  }
  if (filter?.state !== undefined && task.state !== filter.state) {
    return false;
  }

  return true;
}

function applyOrder(
  tasks: readonly Task[],
  activeOrder: readonly string[],
  order?: TaskOrder
): Task[] {
  const result = [...tasks];

  if (order === "alphabetical") {
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  if (order === "created") {
    return result.sort((left, right) =>
      String(left.metadata.created ?? "").localeCompare(String(right.metadata.created ?? ""))
    );
  }

  return result.sort((left, right) => {
    const leftIndex = activeOrder.indexOf(left.id);
    const rightIndex = activeOrder.indexOf(right.id);
    const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;

    return normalizedLeft - normalizedRight || left.qualifiedId.localeCompare(right.qualifiedId);
  });
}

function ensureListOrder(store: Store, listName: string): string[] {
  let order = store.listOrder.get(listName);
  if (order === undefined) {
    order = [];
    store.listOrder.set(listName, order);
  }

  return order;
}

function removeFromOrder(store: Store, task: Task): void {
  const order = ensureListOrder(store, task.list);
  const index = order.indexOf(task.id);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

function resolveMoveIndex(order: readonly string[], anchor: MoveAnchor): number {
  if ("position" in anchor) {
    return anchor.position === "top" ? 0 : order.length;
  }

  const anchorId = "before" in anchor ? anchor.before : anchor.after;
  const anchorIndex = order.indexOf(anchorId);
  if (anchorIndex < 0) {
    throw new AnchorNotFoundError(anchorId);
  }

  return "before" in anchor ? anchorIndex : anchorIndex + 1;
}

function isActive(task: Task): boolean {
  return task.state !== archivedState;
}

function createTransientFailures(
  transient: MockTaskListTransientFailures | undefined
): (method: MockTaskListMethod) => Error | undefined {
  const remaining = new Map<MockTaskListMethod, { times: number; error: Error | (() => Error) }>();

  for (const [method, value] of Object.entries(transient ?? {}) as Array<
    [MockTaskListMethod, NonNullable<MockTaskListTransientFailures[MockTaskListMethod]>]
  >) {
    if (typeof value === "number") {
      remaining.set(method, {
        times: value,
        error: () => new Error(`${method} transient failure`)
      });
    } else if (value instanceof Error) {
      remaining.set(method, { times: 1, error: value });
    } else {
      remaining.set(method, {
        times: value.times ?? 1,
        error: value.error ?? (() => new Error(`${method} transient failure`))
      });
    }
  }

  return (method) => {
    const entry = remaining.get(method);
    if (entry === undefined || entry.times <= 0) {
      return undefined;
    }

    entry.times -= 1;
    return typeof entry.error === "function" ? entry.error() : entry.error;
  };
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    metadata: { ...task.metadata }
  };
}

function cloneTasks(tasks: readonly Task[]): Task[] {
  return tasks.map(cloneTask);
}

function cloneResult(result: unknown): unknown {
  if (Array.isArray(result)) {
    return result.map(cloneResult);
  }
  if (isTask(result)) {
    return cloneTask(result);
  }

  return result;
}

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Task>;
  return (
    typeof candidate.list === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.qualifiedId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.state === "string"
  );
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
