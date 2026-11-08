import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateMachineDef } from "./state-machine.js";
import { openTaskList } from "./open.js";
import {
  createDeferred,
  createFs,
  waitForCondition
} from "./backends/test-helpers.js";
import { InvalidTransitionError, type OpenTaskListOptions, type TaskListFs, type TaskState } from "./types.js";

const BACKENDS = [
  {
    name: "markdown-dir",
    type: "markdown-dir",
    path: "/repo/tasks"
  },
  {
    name: "yaml-file",
    type: "yaml-file",
    path: "/repo/tasks.yaml"
  }
] as const satisfies ReadonlyArray<{
  name: string;
  type: OpenTaskListOptions["type"];
  path: string;
}>;

type WorkflowEvent = "plan" | "complete" | "archive";
type ApprovalState = "pending" | "approved-done" | "declined";
type ApprovalEvent = "approve" | "decline";

function createWorkflowMachine(
  overrides: Partial<StateMachineDef<TaskState, WorkflowEvent>> = {}
): StateMachineDef<TaskState, WorkflowEvent> {
  return {
    initial: "draft",
    states: ["draft", "planned", "done", "archived"],
    events: {
      plan: { from: ["draft"], to: "planned" },
      complete: { from: ["planned"], to: "done" },
      archive: { from: "*", to: "archived" }
    },
    ...overrides
  };
}

function createApprovalMachine(
  overrides: Partial<StateMachineDef<ApprovalState, ApprovalEvent>> = {}
): StateMachineDef<ApprovalState, ApprovalEvent> {
  return {
    initial: "pending",
    states: ["pending", "approved-done", "declined"],
    events: {
      approve: { from: ["pending"], to: "approved-done" },
      decline: { from: ["pending"], to: "declined" }
    },
    ...overrides
  };
}

async function openTasks(
  backend: (typeof BACKENDS)[number],
  stateMachine: StateMachineDef
) {
  const { fs } = createFs();
  const taskList = await openTaskList({
    type: backend.type,
    path: backend.path,
    create: true,
    fs,
    stateMachine
  });

  return taskList.list("planning");
}

async function createTaskAndFire(
  tasks: Awaited<ReturnType<typeof openTasks>>,
  id: string,
  name: string,
  events: readonly WorkflowEvent[],
  metadata?: Record<string, unknown>
): Promise<void> {
  await tasks.create({
    id,
    name,
    metadata
  });

  for (const eventName of events) {
    await tasks.fire(id, eventName);
  }
}

describe("Tasks.fire", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const backend of BACKENDS) {
    describe(backend.name, () => {
      it("transitions when legal and throws when illegal", async () => {
        const tasks = await openTasks(backend, createWorkflowMachine());

        await tasks.create({
          id: "ship",
          name: "Ship"
        });

        await expect(tasks.fire("ship", "plan")).resolves.toMatchObject({
          state: "planned"
        });
        await expect(tasks.get("ship")).resolves.toMatchObject({
          state: "planned"
        });

        await expect(tasks.fire("ship", "plan")).rejects.toMatchObject({
          name: "InvalidTransitionError",
          event: "plan",
          to: "planned",
          reason: 'Cannot fire event "plan" from task state "planned".',
          task: expect.objectContaining({
            id: "ship",
            state: "planned"
          })
        });
      });

      it("rejects inherited event names as invalid transitions", async () => {
        const tasks = await openTasks(backend, createWorkflowMachine());

        await tasks.create({
          id: "ship",
          name: "Ship"
        });

        await expect(tasks.fire("ship", "constructor")).rejects.toBeInstanceOf(
          InvalidTransitionError
        );
      });

      it("allows only one simultaneous transition from the same state", async () => {
        const tasks = await openTasks(backend, createApprovalMachine());

        await tasks.create({
          id: "approval",
          name: "Approval"
        });

        const results = await Promise.allSettled([
          tasks.fire("approval", "approve"),
          tasks.fire("approval", "decline")
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      });

      it("fails closed on a transition lock left by a stopped process", async () => {
        vi.useFakeTimers();
        const kill = vi.spyOn(process, "kill").mockImplementation(() => {
          throw Object.assign(new Error("not running"), { code: "ESRCH" });
        });
        const { fs, rawFs } = createFs();
        const taskList = await openTaskList({
          type: backend.type,
          path: backend.path,
          create: true,
          fs,
          stateMachine: createApprovalMachine()
        });
        const tasks = taskList.list("planning");
        const lockPath = backend.type === "yaml-file"
          ? `${backend.path}.lock`
          : `${backend.path}/planning/.transition.lock`;
        await tasks.create({ id: "approval", name: "Approval" });
        await rawFs.writeFile(lockPath, "2147483647", { encoding: "utf8" });

        const result = tasks.fire("approval", "approve").catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await result).toEqual(expect.objectContaining({
          message: expect.stringContaining(`Timed out waiting for task-list lock: ${lockPath}`)
        }));
        expect(kill).not.toHaveBeenCalled();
        await expect(tasks.get("approval")).resolves.toMatchObject({ state: "pending" });
        await expect(rawFs.readFile(lockPath, "utf8")).resolves.toBe("2147483647");
      });

      it("serializes two public transitions across distinct wrappers during empty lock initialization", async () => {
        vi.useFakeTimers();
        vi.spyOn(process, "kill").mockImplementation(() => {
          throw Object.assign(new Error("not running"), { code: "ESRCH" });
        });
        const { fs, rawFs } = createFs();
        const initialized = createDeferred();
        const initialize = createDeferred();
        const exit = createDeferred();
        const states: string[] = [];
        const metadata: Record<string, unknown>[] = [];
        const lockPath = backend.type === "yaml-file"
          ? `${backend.path}.lock`
          : `${backend.path}/planning/.transition.lock`;
        let pauseInitialization = false;
        const firstFs: TaskListFs = {
          ...fs,
          async mkdir(target, options) {
            await fs.mkdir(target, options);
            if (pauseInitialization && target === lockPath) {
              initialized.resolve();
              await initialize.promise;
            }
          },
          async writeFile(target, data, options) {
            if (pauseInitialization && target === lockPath) {
              await fs.writeFile(target, "", options);
              initialized.resolve();
              await initialize.promise;
              return fs.writeFile(target, data);
            }
            return fs.writeFile(target, data, options);
          }
        };
        const onExit = async (task: { state: string; metadata: Record<string, unknown> }) => {
          states.push(task.state);
          metadata.push({ ...task.metadata });
          await exit.promise;
        };
        const stateMachine = createWorkflowMachine({
          events: {
            plan: { from: ["draft"], to: "planned", onExit },
            complete: { from: "*", to: "done", onExit },
            archive: { from: "*", to: "archived" }
          }
        });
        const options = { type: backend.type, path: backend.path, create: true, stateMachine };
        const firstTasks = (await openTaskList({ ...options, fs: firstFs })).list("planning");
        await firstTasks.create({ id: "ship", name: "Ship", metadata: { original: true } });
        const secondTasks = (await openTaskList({ ...options, fs: { ...fs } })).list("planning");
        pauseInitialization = true;
        const first = firstTasks.fire("ship", "plan", { metadataPatch: { first: true } });
        await initialized.promise;
        const second = secondTasks.fire("ship", "complete", { metadataPatch: { second: true } });
        const results = Promise.allSettled([first, second]);
        await vi.advanceTimersByTimeAsync(10);
        const exitsDuringInitialization = states.length;
        initialize.resolve();
        await vi.advanceTimersByTimeAsync(10);
        const exitsBeforeCommit = states.length;
        exit.resolve();
        await vi.advanceTimersByTimeAsync(20);

        expect(await results).toEqual([
          { status: "fulfilled", value: expect.objectContaining({ metadata: { original: true, first: true } }) },
          { status: "fulfilled", value: expect.objectContaining({ metadata: { original: true, first: true, second: true } }) }
        ]);
        expect(exitsDuringInitialization).toBe(0);
        expect(exitsBeforeCommit).toBe(1);
        expect(states).toEqual(["draft", "planned"]);
        expect(metadata).toEqual([{ original: true }, { original: true, first: true }]);
        await expect(firstTasks.get("ship")).resolves.toMatchObject({
          state: "done",
          metadata: { original: true, first: true, second: true }
        });
        await expect(rawFs.lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
      });

      it("turns guard decline reasons into InvalidTransitionError", async () => {
        const tasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                guard: (task) => (task.metadata.approved === true ? true : "Needs approval")
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await createTaskAndFire(tasks, "guarded", "Guarded", ["plan"]);

        await expect(tasks.fire("guarded", "complete")).rejects.toEqual(
          expect.objectContaining({
            name: "InvalidTransitionError",
            event: "complete",
            to: "done",
            reason: "Needs approval",
            task: expect.objectContaining({
              id: "guarded",
              state: "planned"
            })
          })
        );
        await expect(tasks.get("guarded")).resolves.toMatchObject({
          state: "planned"
        });
      });

      it("shallow-merges metadataPatch into metadata", async () => {
        const tasks = await openTasks(backend, createWorkflowMachine());

        await createTaskAndFire(tasks, "metadata", "Metadata", ["plan"], {
          owner: "kj",
          nested: {
            before: true
          }
        });

        await expect(
          tasks.fire("metadata", "complete", {
            metadataPatch: {
              reviewer: "pm",
              nested: {
                after: true
              }
            }
          })
        ).resolves.toMatchObject({
          state: "done",
          metadata: {
            owner: "kj",
            reviewer: "pm",
            nested: {
              after: true
            }
          }
        });
        await expect(tasks.get("metadata")).resolves.toMatchObject({
          metadata: {
            owner: "kj",
            reviewer: "pm",
            nested: {
              after: true
            }
          }
        });
      });

      it("awaits onExit before persisting and onEnter after persisting", async () => {
        const onExitGate = createDeferred();
        const onEnterGate = createDeferred();
        const steps: string[] = [];
        const tasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                onExit: async (task) => {
                  steps.push(`exit:${task.state}`);
                  await onExitGate.promise;
                  steps.push("exit:released");
                },
                onEnter: async (task) => {
                  steps.push(`enter:${task.state}`);
                  await onEnterGate.promise;
                  steps.push("enter:released");
                }
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await createTaskAndFire(tasks, "callbacks", "Callbacks", ["plan"]);

        const firePromise = tasks.fire("callbacks", "complete");
        await waitForCondition(() => steps.includes("exit:planned"));

        expect(steps).toEqual(["exit:planned"]);
        await expect(tasks.get("callbacks")).resolves.toMatchObject({
          state: "planned"
        });

        onExitGate.resolve();
        await waitForCondition(() => steps.includes("enter:done"));

        expect(steps).toEqual(["exit:planned", "exit:released", "enter:done"]);
        await expect(tasks.get("callbacks")).resolves.toMatchObject({
          state: "done"
        });

        onEnterGate.resolve();

        await expect(firePromise).resolves.toMatchObject({
          state: "done"
        });
        expect(steps).toEqual(["exit:planned", "exit:released", "enter:done", "enter:released"]);
      });

      it("propagates callback failures", async () => {
        const failingExitTasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                onExit: async () => {
                  throw new Error("Exit failed");
                }
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await createTaskAndFire(failingExitTasks, "exit-failure", "Exit failure", ["plan"]);

        await expect(failingExitTasks.fire("exit-failure", "complete")).rejects.toThrow(
          "Exit failed"
        );
        await expect(failingExitTasks.get("exit-failure")).resolves.toMatchObject({
          state: "planned"
        });

        const failingEnterTasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                onEnter: async () => {
                  throw new Error("Enter failed");
                }
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await createTaskAndFire(failingEnterTasks, "enter-failure", "Enter failure", ["plan"]);

        await expect(failingEnterTasks.fire("enter-failure", "complete")).rejects.toThrow(
          "Enter failed"
        );
        await expect(failingEnterTasks.get("enter-failure")).resolves.toMatchObject({
          state: "done"
        });
      });

      it("reports canFire without mutating state", async () => {
        const tasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                guard: (task) => (task.metadata.approved === true ? true : "Needs approval")
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await createTaskAndFire(tasks, "allowed", "Allowed", ["plan"], {
          approved: true
        });
        await createTaskAndFire(tasks, "blocked", "Blocked", ["plan"]);
        await tasks.create({
          id: "drafted",
          name: "Drafted",
        });

        await expect(tasks.canFire("allowed", "complete")).resolves.toBe(true);
        await expect(tasks.canFire("blocked", "complete")).resolves.toBe(false);
        await expect(tasks.canFire("drafted", "complete")).resolves.toBe(false);
        await expect(tasks.get("allowed")).resolves.toMatchObject({
          state: "planned"
        });
        await expect(tasks.get("blocked")).resolves.toMatchObject({
          state: "planned"
        });
        await expect(tasks.get("drafted")).resolves.toMatchObject({
          state: "draft"
        });
      });

      it("lists events legal from the current state", async () => {
        const tasks = await openTasks(
          backend,
          createWorkflowMachine({
            events: {
              plan: { from: ["draft"], to: "planned" },
              complete: {
                from: ["planned"],
                to: "done",
                guard: () => "Needs approval"
              },
              archive: { from: "*", to: "archived" }
            }
          })
        );

        await tasks.create({
          id: "drafted",
          name: "Drafted",
        });
        await createTaskAndFire(tasks, "planned", "Planned", ["plan"]);
        await createTaskAndFire(tasks, "archived", "Archived", ["archive"]);

        await expect(tasks.events("drafted")).resolves.toEqual(["plan", "archive"]);
        await expect(tasks.events("planned")).resolves.toEqual(["complete", "archive"]);
        await expect(tasks.events("archived")).resolves.toEqual([]);
      });

      it("supports custom state names declared by the configured machine", async () => {
        const approvalMachine = createApprovalMachine() as unknown as StateMachineDef<
          TaskState,
          ApprovalEvent
        >;
        const tasks = await openTasks(backend, approvalMachine);

        await expect(
          tasks.create({
            id: "approval",
            name: "Approval"
          })
        ).resolves.toMatchObject({
          state: "pending"
        });

        await expect(tasks.events("approval")).resolves.toEqual(["approve", "decline"]);
        await expect(tasks.canFire("approval", "approve")).resolves.toBe(true);
        await expect(tasks.fire("approval", "approve")).resolves.toMatchObject({
          state: "approved-done"
        });
        await expect(tasks.get("approval")).resolves.toMatchObject({
          state: "approved-done"
        });
      });
    });
  }

  it("keeps InvalidTransitionError instances for fire rejections", async () => {
    const tasks = await openTasks(BACKENDS[0], createWorkflowMachine());

    await tasks.create({
      id: "ship",
      name: "Ship"
    });

    const error = await tasks.fire("ship", "complete").catch((caught) => caught);

    expect(error).toBeInstanceOf(InvalidTransitionError);
  });
});
