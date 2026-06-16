import type { Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEvent, defaultStateMachine, type TaskEvent } from "../state.js";
import {
  AnchorNotFoundError,
  InvalidTransitionError,
  OrderMismatchError,
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
import { createFs } from "./test-helpers.js";

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
    frontmatterMode: "strict",
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
        },
        sourcePath: persistedPaths.taskPath
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
      const persistedPaths = pathsForTask(rootPath, "planning", "defaulted");

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
        },
        sourcePath: persistedPaths.taskPath
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
      const persistedPaths = pathsForTask(rootPath, "planning", "crud");

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
        },
        sourcePath: persistedPaths.taskPath
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
      const createInput: TaskCreate = {
        id: "typed-create",
        name: "Typed create",
        state: "planned"
      };

      expect(createInput.id).toBe("typed-create");
    });

    it("requires id at the backend boundary", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await expect(
        tasks.create({
          name: "Missing id"
        })
      ).rejects.toThrow(`id is required for ${name.replace(" backend", "")} backend`);
    });

    it("rejects invisible or unsafe list names", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });

      for (const listName of [" ", "  planning  ", "line\nbreak"]) {
        expect(() => taskList.list(listName)).toThrow(`Invalid task list name "${listName}".`);
      }
    });

    it("rejects invisible or unsafe task ids", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      for (const id of [" ", "  padded  ", "line\nbreak"]) {
        await expect(tasks.create({ id, name: "Task" })).rejects.toThrow(
          `Invalid task id "${id}".`
        );
      }
    });

    it("rejects empty task names before writing", async () => {
      const { taskList } = await openBackend(factory, { path: rootPath });
      const tasks = taskList.list("planning");

      await expect(tasks.create({ id: "blank", name: "" })).rejects.toThrow(
        "Task name must not be empty."
      );
      await expect(tasks.create({ id: "spaces", name: "   " })).rejects.toThrow(
        "Task name must not be empty."
      );

      await tasks.create({ id: "ship", name: "Ship" });
      await expect(tasks.update("ship", { name: "" })).rejects.toThrow(
        "Task name must not be empty."
      );
      await expect(tasks.all().then((tasks) => tasks.map((task) => task.id))).resolves.toEqual([
        "ship"
      ]);
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
      ).rejects.toThrow(
        'Tasks.create() does not accept "state"; new tasks always start at stateMachine.initial.'
      );
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

          await createTaskInState(
            tasks,
            {
              id: `${from}-${eventName}`,
              name: `${from} ${eventName}`
            },
            from
          );

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

          await createTaskInState(
            tasks,
            {
              id: `${from}-illegal-${eventName}`,
              name: `${from} illegal ${eventName}`
            },
            from
          );

          await expect(
            tasks.fire(`${from}-illegal-${eventName}`, eventName)
          ).rejects.toBeInstanceOf(InvalidTransitionError);
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
        expect.objectContaining({ qualifiedId: "beta/two" }),
        expect.objectContaining({ qualifiedId: "beta/three", state: "archived" })
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

    describe("ordering", () => {
      async function seedThree(tasks: Tasks): Promise<void> {
        await tasks.create({ id: "alpha", name: "Alpha" });
        await tasks.create({ id: "bravo", name: "Bravo" });
        await tasks.create({ id: "charlie", name: "Charlie" });
      }

      function ids(tasks: readonly { id: string }[]): string[] {
        return tasks.map((task) => task.id);
      }

      it("creates tasks at the tail of priority order", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await expect(tasks.all().then(ids)).resolves.toEqual(["alpha", "bravo", "charlie"]);
      });

      it("move({ before }) places the task before the anchor", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.move("charlie", { before: "alpha" });

        await expect(tasks.all().then(ids)).resolves.toEqual(["charlie", "alpha", "bravo"]);
      });

      it("move({ after }) places the task after the anchor", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.move("alpha", { after: "bravo" });

        await expect(tasks.all().then(ids)).resolves.toEqual(["bravo", "alpha", "charlie"]);
      });

      it("move({ position: 'top' }) sends the task to the head", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.move("charlie", { position: "top" });

        await expect(tasks.all().then(ids)).resolves.toEqual(["charlie", "alpha", "bravo"]);
      });

      it("move({ position: 'bottom' }) sends the task to the tail", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.move("alpha", { position: "bottom" });

        await expect(tasks.all().then(ids)).resolves.toEqual(["bravo", "charlie", "alpha"]);
      });

      it("move() rejects unknown anchors", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await expect(tasks.move("alpha", { before: "missing" })).rejects.toBeInstanceOf(
          AnchorNotFoundError
        );
      });

      it("move() rejects archived anchors", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);
        await tasks.create({ id: "old", name: "Old" });
        await tasks.fire("old", "archive");

        await expect(tasks.move("alpha", { after: "old" })).rejects.toBeInstanceOf(
          AnchorNotFoundError
        );
        await expect(tasks.all().then(ids)).resolves.toEqual(["alpha", "bravo", "charlie"]);
      });

      it("reorder replaces the entire order", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.reorder(["charlie", "alpha", "bravo"]);

        await expect(tasks.all().then(ids)).resolves.toEqual(["charlie", "alpha", "bravo"]);
      });

      it("reorder rejects missing or extra ids with OrderMismatchError", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await expect(tasks.reorder(["alpha", "bravo"])).rejects.toBeInstanceOf(OrderMismatchError);
        await expect(tasks.reorder(["alpha", "bravo", "charlie", "delta"])).rejects.toBeInstanceOf(
          OrderMismatchError
        );
      });

      it("reorder rejects duplicate ids without corrupting state", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");

        await tasks.create({ id: "alpha", name: "Alpha" });
        await tasks.create({ id: "bravo", name: "Bravo" });

        await expect(tasks.reorder(["alpha", "bravo", "bravo"])).rejects.toBeInstanceOf(
          OrderMismatchError
        );
        await expect(tasks.all()).resolves.toHaveLength(2);
      });

      it("archive removes the task from priority order", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.fire("bravo", "archive");

        await expect(tasks.all().then(ids)).resolves.toEqual(["alpha", "charlie"]);
      });

      it("delete removes the task from priority order", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);

        await tasks.delete("bravo");

        await expect(tasks.all().then(ids)).resolves.toEqual(["alpha", "charlie"]);
      });

      it("all({ order: 'alphabetical' }) sorts by id", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await seedThree(tasks);
        await tasks.move("charlie", { position: "top" });

        await expect(tasks.all({ order: "alphabetical" }).then(ids)).resolves.toEqual([
          "alpha",
          "bravo",
          "charlie"
        ]);
      });

      it("all({ includeArchived, order: 'alphabetical' }) sorts active and archived together", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");
        await tasks.create({ id: "zeta", name: "Zeta" });
        await tasks.create({ id: "alpha", name: "Alpha" });
        await tasks.fire("alpha", "archive");

        await expect(
          tasks.all({ includeArchived: true, order: "alphabetical" }).then(ids)
        ).resolves.toEqual(["alpha", "zeta"]);
      });

      it("all({ order: 'created' }) sorts by creation time", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

        const { taskList } = await openBackend(factory, { path: rootPath });
        const tasks = taskList.list("planning");

        await tasks.create({ id: "first", name: "First" });
        vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
        await tasks.create({ id: "second", name: "Second" });
        vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
        await tasks.create({ id: "third", name: "Third" });

        await tasks.move("third", { position: "top" });

        await expect(tasks.all({ order: "created" }).then(ids)).resolves.toEqual([
          "first",
          "second",
          "third"
        ]);
      });

      it("moveBetweenLists transfers a task to another list at the tail", async () => {
        const { taskList } = await openBackend(factory, { path: rootPath });
        const planning = taskList.list("planning");
        const doing = taskList.list("doing");

        await planning.create({ id: "shared", name: "Shared" });
        await doing.create({ id: "existing", name: "Existing" });

        const moved = await taskList.moveBetweenLists("planning/shared", "doing");

        expect(moved).toMatchObject({
          list: "doing",
          id: "shared",
          qualifiedId: "doing/shared"
        });
        await expect(planning.all().then(ids)).resolves.toEqual([]);
        await expect(doing.all().then(ids)).resolves.toEqual(["existing", "shared"]);
      });
    });
  });
}

describeBackendConformance(
  "markdown-dir backend",
  markdownDirBackend,
  "/repo/tasks",
  (rootPath, list, id) => ({
    taskPath: `${rootPath}/${list}/01-${id}.md`
  })
);

describeBackendConformance(
  "yaml-file backend",
  yamlFileBackend,
  "/repo/tasks.yaml",
  (rootPath) => ({
    taskPath: rootPath
  })
);
