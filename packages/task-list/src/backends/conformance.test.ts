import type { Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEvent, defaultStateMachine, type TaskEvent } from "../state.js";
import {
  InvalidTransitionError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type BackendDeps,
  type TaskCreate,
  type TaskList,
  type TaskListFs,
  type Tasks,
  type TaskState
} from "../types.js";
import { markdownDirBackend } from "./markdown-dir.js";
import { yamlFileBackend } from "./yaml-file.js";
import { createDeferred, createFs, flushMicrotasks, waitForCondition } from "./test-helpers.js";

type BackendFactoryUnderTest = (deps: BackendDeps) => Promise<TaskList>;
type BackendPaths = {
  taskPath: string;
};
const TASK_EVENTS: TaskEvent[] = ["plan", "start", "complete", "archive"];

type TestFs = ReturnType<typeof createFs>["rawFs"];

const EVENTS_TO_REACH_STATE: Record<TaskState, readonly TaskEvent[]> = {
  draft: [],
  planned: ["plan"],
  "in-progress": ["plan", "start"],
  done: ["plan", "start", "complete"],
  archived: ["archive"]
};

function allowedEvents(from: TaskState): readonly TaskEvent[] {
  const events: TaskEvent[] = [];

  for (const eventName of TASK_EVENTS) {
    try {
      assertEvent(defaultStateMachine, from, eventName);
      events.push(eventName);
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
    }
  }

  return events;
}

async function createTaskInState(tasks: Tasks, input: TaskCreate, state: TaskState): Promise<void> {
  await tasks.create(input);

  for (const eventName of EVENTS_TO_REACH_STATE[state]) {
    await tasks.fire(input.id, eventName);
  }
}

async function openBackend(
  factory: BackendFactoryUnderTest,
  options: {
    create?: boolean;
    defaults?: BackendDeps["defaults"];
    files?: Record<string, string>;
    fs?: TaskListFs;
    lockRetries?: number;
    path?: string;
  } = {}
): Promise<{
  fs: TaskListFs;
  rawFs: TestFs;
  taskList: TaskList;
  volume: Volume;
}> {
  const baseFs = createFs(options.files);
  const fs = options.fs ?? baseFs.fs;
  const taskList = await factory({
    path: options.path ?? "/repo/tasks",
    defaults: {
      metadata: { ...(options.defaults?.metadata ?? {}) }
    },
    lockStaleMs: 30_000,
    lockRetries: options.lockRetries ?? 20,
    create: options.create ?? true,
    fs
  });

  return {
    fs,
    rawFs: baseFs.rawFs,
    taskList,
    volume: baseFs.volume
  };
}

function describeBackendConformance(
  name: string,
  factory: BackendFactoryUnderTest,
  rootPath: string,
  pathsForTask: (rootPath: string, list: string, id: string) => BackendPaths
): void {
  describe(name, () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("round-trips created tasks", async () => {
      const { rawFs, taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");
      const persistedPaths = pathsForTask(rootPath, "planning", "ship-it");

      const created = await tasks.create({
        id: "ship-it",
        name: "Ship it",
        description: "Document the release flow.",
        metadata: {
          owner: "kj",
          priority: "high"
        }
      });

      expect(created).toEqual({
        list: "planning",
        id: "ship-it",
        qualifiedId: "planning/ship-it",
        name: "Ship it",
        state: "draft",
        description: "Document the release flow.",
        metadata: {
          owner: "kj",
          priority: "high"
        }
      });
      await expect(rawFs.readFile(persistedPaths.taskPath, "utf8")).resolves.toContain("Ship it");
      await expect(tasks.get("ship-it")).resolves.toEqual(created);
      await expect(taskList.get("planning/ship-it")).resolves.toEqual(created);
    });

    it("applies defaults to omitted fields on create", async () => {
      const { taskList } = await openBackend(factory, {
        path: rootPath,
        defaults: {
          metadata: {
            owner: "default-owner",
            priority: "medium"
          }
        }
      });

      const task = await taskList.list("planning").create({
        id: "defaulted",
        name: "Defaulted task",
        metadata: {
          priority: "high"
        }
      });

      expect(task).toEqual({
        list: "planning",
        id: "defaulted",
        qualifiedId: "planning/defaulted",
        name: "Defaulted task",
        state: "draft",
        description: "",
        metadata: {
          owner: "default-owner",
          priority: "high"
        }
      });
    });

    it("never overwrites an existing task on create", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "duplicate",
        name: "First"
      });
      await tasks.fire("duplicate", "archive");

      await expect(
        tasks.create({
          id: "duplicate",
          name: "Second"
        })
      ).rejects.toBeInstanceOf(TaskAlreadyExistsError);
      await expect(tasks.get("duplicate")).resolves.toMatchObject({
        name: "First",
        state: "archived"
      });
    });

    it("supports create, update, get, and delete", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "crud",
        name: "Original",
        description: "Before",
        metadata: {
          owner: "kj",
          priority: "low"
        }
      });

      await expect(
        tasks.update("crud", {
          name: "Updated",
          description: "After",
          metadata: {
            priority: "high",
            reviewer: "pm"
          }
        })
      ).resolves.toEqual({
        list: "planning",
        id: "crud",
        qualifiedId: "planning/crud",
        name: "Updated",
        state: "draft",
        description: "After",
        metadata: {
          owner: "kj",
          priority: "high",
          reviewer: "pm"
        }
      });

      await expect(tasks.get("crud")).resolves.toMatchObject({
        name: "Updated",
        metadata: {
          owner: "kj",
          priority: "high",
          reviewer: "pm"
        }
      });

      await expect(tasks.delete("crud")).resolves.toBeUndefined();
      await expect(tasks.get("crud")).rejects.toBeInstanceOf(TaskNotFoundError);
    });

    it("rejects state at the type boundary", () => {
      // @ts-expect-error create does not accept state
      const createInput: TaskCreate = { id: "typed-create", name: "Typed create", state: "planned" };

      expect(createInput.id).toBe("typed-create");
    });

    it("rejects state mutations outside fire()", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "state-guard",
        name: "State guard"
      });

      await expect(
        tasks.create({
          id: "illegal-create",
          name: "Illegal create",
          state: "planned"
        } as TaskCreate)
      ).rejects.toThrow('Tasks.create() does not accept "state"; new tasks always start at stateMachine.initial.');
      await expect(
        tasks.update("state-guard", {
          state: "planned"
        } as never)
      ).rejects.toThrow('Tasks.update() does not accept "state"; use fire() to change task state.');
    });

    it("allows every legal event from every reachable state", async () => {
      for (const from of defaultStateMachine.states) {
        for (const eventName of allowedEvents(from)) {
          const { taskList } = await openBackend(factory, { path: rootPath });
          const tasks = taskList.list("planning");
          const expectedState = assertEvent(defaultStateMachine, from, eventName).to;

          await createTaskInState(tasks, {
            id: `${from}-${eventName}`,
            name: `${from} ${eventName}`
          }, from);

          await expect(tasks.fire(`${from}-${eventName}`, eventName)).resolves.toMatchObject({
            state: expectedState
          });
        }
      }
    });

    it("rejects every illegal event from every reachable state", async () => {
      for (const from of defaultStateMachine.states) {
        const legalEvents = new Set(allowedEvents(from));

        for (const eventName of TASK_EVENTS) {
          if (legalEvents.has(eventName)) {
            continue;
          }

          const { taskList } = await openBackend(factory, { path: rootPath });
          const tasks = taskList.list("planning");

          await createTaskInState(tasks, {
            id: `${from}-illegal-${eventName}`,
            name: `${from} illegal ${eventName}`
          }, from);

          await expect(tasks.fire(`${from}-illegal-${eventName}`, eventName)).rejects.toBeInstanceOf(
            InvalidTransitionError
          );
        }
      }
    });

    it("persists the archived state", async () => {
      const { fs, taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "archive-me",
        name: "Archive me"
      });

      await expect(tasks.fire("archive-me", "archive")).resolves.toMatchObject({
        state: "archived"
      });

      const reopened = await factory({
        path: rootPath,
        defaults: {
          metadata: {}
        },
        lockStaleMs: 30_000,
        lockRetries: 20,
        create: false,
        fs
      });

      await expect(reopened.get("planning/archive-me")).resolves.toMatchObject({
        state: "archived"
      });
    });

    it("supports multi-list queries, qualified lookups, and list discovery", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });

      await taskList.list("alpha").create({
        id: "one",
        name: "Alpha one"
      });
      await taskList.list("beta").create({
        id: "two",
        name: "Beta two"
      });
      await taskList.list("beta").create({
        id: "three",
        name: "Beta three"
      });
      await taskList.list("alpha").fire("one", "plan");
      await taskList.list("beta").fire("two", "plan");
      await taskList.list("beta").fire("two", "start");
      await taskList.list("beta").fire("two", "complete");
      await taskList.list("beta").fire("three", "plan");
      await taskList.list("beta").fire("three", "start");
      await taskList.list("beta").fire("three", "complete");
      await taskList.list("beta").fire("three", "archive");

      await expect(taskList.lists()).resolves.toEqual(["alpha", "beta"]);
      await expect(taskList.allTasks()).resolves.toEqual([
        expect.objectContaining({ qualifiedId: "alpha/one" }),
        expect.objectContaining({ qualifiedId: "beta/two" })
      ]);
      await expect(
        taskList.allTasks({
          includeArchived: true
        })
      ).resolves.toEqual([
        expect.objectContaining({ qualifiedId: "alpha/one" }),
        expect.objectContaining({ qualifiedId: "beta/three", state: "archived" }),
        expect.objectContaining({ qualifiedId: "beta/two" })
      ]);
      await expect(taskList.get("beta/three")).resolves.toMatchObject({
        state: "archived"
      });
    });

    it("filters by state and opt-in archived tasks", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "draft-task",
        name: "Draft task"
      });
      await tasks.create({
        id: "planned-task",
        name: "Planned task"
      });
      await tasks.create({
        id: "done-task",
        name: "Done task"
      });
      await tasks.fire("planned-task", "plan");
      await tasks.fire("done-task", "plan");
      await tasks.fire("done-task", "start");
      await tasks.fire("done-task", "complete");
      await tasks.fire("done-task", "archive");

      await expect(tasks.all()).resolves.toEqual([
        expect.objectContaining({ id: "draft-task", state: "draft" }),
        expect.objectContaining({ id: "planned-task", state: "planned" })
      ]);
      await expect(
        tasks.all({
          state: "planned"
        })
      ).resolves.toEqual([expect.objectContaining({ id: "planned-task" })]);
      await expect(
        tasks.all({
          includeArchived: true,
          state: "archived"
        })
      ).resolves.toEqual([expect.objectContaining({ id: "done-task", state: "archived" })]);
    });

    it("serializes concurrent updates to the same task", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);
      const baseFs = createFs();
      const taskPath = pathsForTask(rootPath, "planning", "serial").taskPath;
      const reads = [createDeferred(), createDeferred()];
      let armReadBlockers = false;
      let readCount = 0;
      const fs: TaskListFs = {
        ...baseFs.fs,
        readFile: async (path, encoding) => {
          if (armReadBlockers && path === taskPath && readCount < reads.length) {
            const currentRead = readCount;
            readCount += 1;
            await reads[currentRead].promise;
          }

          return baseFs.rawFs.readFile(path, encoding);
        }
      };
      const { taskList } = await openBackend(factory, {
        fs,
        lockRetries: 5,
        path: rootPath
      });
      const tasks = taskList.list("planning");

      await tasks.create({
        id: "serial",
        name: "Serial task"
      });
      armReadBlockers = true;

      const firstUpdate = tasks.update("serial", {
        metadata: {
          owner: "kj"
        }
      });
      const secondUpdate = tasks.update("serial", {
        metadata: {
          reviewer: "pm"
        }
      });

      await waitForCondition(() => readCount === 1);
      expect(readCount).toBe(1);

      reads[0].resolve();
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(25);
      await flushMicrotasks();

      expect(readCount).toBe(2);

      reads[1].resolve();

      await Promise.all([firstUpdate, secondUpdate]);

      await expect(tasks.get("serial")).resolves.toMatchObject({
        metadata: {
          owner: "kj",
          reviewer: "pm"
        }
      });
    });

    it("rejects unsafe list names and ids", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });

      expect(() => taskList.list(".hidden")).toThrow('Invalid task list name ".hidden".');
      await expect(
        taskList.list("planning").create({
          id: "../escape",
          name: "Escape"
        })
      ).rejects.toThrow('Invalid task id "../escape".');
      await expect(taskList.list("planning").get("nested/id")).rejects.toThrow(
        'Invalid task id "nested/id".'
      );
    });
  });
}

describeBackendConformance("markdown-dir backend", markdownDirBackend, "/repo/tasks", (rootPath, list, id) => ({
  taskPath: `${rootPath}/${list}/${id}.md`
}));

describeBackendConformance("yaml-file backend", yamlFileBackend, "/repo/tasks.yaml", (rootPath) => ({
  taskPath: rootPath
}));
