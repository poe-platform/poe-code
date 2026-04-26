import { TaskAlreadyExistsError, TaskNotFoundError, openTaskList } from "@poe-code/task-list";
import type { OpenTaskListOptions, StateMachineDef, Task, TaskList, Tasks } from "@poe-code/task-list";
import { randomBytes } from "node:crypto";
import { UserError } from "../user-error.js";
import { approvalStateMachine } from "./state-machine.js";
import type { HumanInLoopPending, HumanInLoopRuntimeOptions } from "./types.js";

const DEFAULT_LIST_NAME = "approvals";

const openedTaskListsByRuntime = new WeakMap<HumanInLoopRuntimeOptions, Promise<TaskList>>();
const validatedListsByRuntime = new WeakMap<HumanInLoopRuntimeOptions, Set<string>>();

export interface ApprovalPayload {
  approvalId?: string;
  commandPath: string;
  params: Record<string, unknown>;
  message: string;
  declineInputPrompt?: string | null;
  enqueuedAt?: string;
  pid?: number | null;
  result?: unknown;
  error?: unknown;
}

export async function ensureApprovalList(
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  deps: {
    openTaskList?: (options: OpenTaskListOptions) => Promise<TaskList>;
  } = {},
): Promise<{ taskList: TaskList; listName: string; tasks: Tasks }> {
  if (runtimeOptions?.taskList === undefined) {
    throw new UserError("humanInLoop.taskList required for async-mode commands");
  }

  const listName = runtimeOptions.listName ?? DEFAULT_LIST_NAME;
  const taskList = await resolveTaskList(runtimeOptions, runtimeOptions.taskList, deps.openTaskList ?? openTaskList);
  const tasks = taskList.list(listName);

  if (!isListValidated(runtimeOptions, listName)) {
    if (!isApprovalStateMachine(tasks.stateMachine)) {
      throw new UserError(
        "approvals task-list configured with a different state machine; pass approvalStateMachine when opening the list"
      );
    }

    cacheValidatedList(runtimeOptions, listName);
  }

  return {
    taskList,
    listName,
    tasks,
  };
}

export async function enqueueApproval(ctx: {
  tasks: Tasks;
  payload: ApprovalPayload;
}): Promise<{ approvalId: string; pending: HumanInLoopPending }> {
  const enqueuedAt = new Date().toISOString();
  const approval = createApprovalRecord(ctx.payload, enqueuedAt);

  try {
    await createApprovalTask(ctx.tasks, approval);
  } catch (error) {
    if (!(error instanceof TaskAlreadyExistsError)) {
      throw error;
    }

    const retryApproval = createApprovalRecord(ctx.payload, enqueuedAt);
    await createApprovalTask(ctx.tasks, retryApproval);
    return retryApproval;
  }

  return approval;
}

export async function loadApproval(ctx: {
  tasks: Tasks;
  approvalId: string;
}): Promise<ApprovalPayload | undefined> {
  try {
    const task = await ctx.tasks.get(ctx.approvalId);
    return approvalPayloadFromTask(task);
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return undefined;
    }

    throw error;
  }
}

async function resolveTaskList(
  runtimeOptions: HumanInLoopRuntimeOptions,
  taskList: NonNullable<HumanInLoopRuntimeOptions["taskList"]>,
  openTaskListFn: (options: OpenTaskListOptions) => Promise<TaskList>,
): Promise<TaskList> {
  if (!isTaskListConfig(taskList)) {
    return taskList;
  }

  const cachedTaskList = openedTaskListsByRuntime.get(runtimeOptions);

  if (cachedTaskList !== undefined) {
    return cachedTaskList;
  }

  const openedTaskList = openTaskListFn({
    type: taskList.format,
    path: taskList.dir,
    stateMachine: approvalStateMachine,
  });
  openedTaskListsByRuntime.set(runtimeOptions, openedTaskList);
  return openedTaskList;
}

function cacheValidatedList(runtimeOptions: HumanInLoopRuntimeOptions, listName: string): void {
  const validatedLists = validatedListsByRuntime.get(runtimeOptions);

  if (validatedLists === undefined) {
    validatedListsByRuntime.set(runtimeOptions, new Set([listName]));
    return;
  }

  validatedLists.add(listName);
}

function isListValidated(runtimeOptions: HumanInLoopRuntimeOptions, listName: string): boolean {
  return validatedListsByRuntime.get(runtimeOptions)?.has(listName) ?? false;
}

function createApprovalRecord(
  payload: ApprovalPayload,
  enqueuedAt: string,
): { approvalId: string; pending: HumanInLoopPending; metadata: Record<string, unknown>; name: string } {
  const approvalId = `${enqueuedAt.slice(0, 19).replaceAll(":", "-")}-${randomBytes(3).toString("hex")}`;

  return {
    approvalId,
    name: `${payload.commandPath} (${enqueuedAt})`,
    metadata: {
      schemaVersion: 1,
      approvalId,
      commandPath: payload.commandPath,
      params: payload.params,
      message: payload.message,
      declineInputPrompt: payload.declineInputPrompt ?? null,
      enqueuedAt,
      pid: null,
      result: null,
      error: null,
    },
    pending: {
      status: "pending-approval",
      approvalId,
      message: payload.message,
      enqueuedAt,
    },
  };
}

async function createApprovalTask(
  tasks: Tasks,
  approval: { approvalId: string; metadata: Record<string, unknown>; name: string }
): Promise<void> {
  await tasks.create({
    id: approval.approvalId,
    name: approval.name,
    metadata: approval.metadata,
  });
}

function isApprovalStateMachine(stateMachine: StateMachineDef): boolean {
  if (stateMachine === approvalStateMachine) {
    return true;
  }

  return isDeepEqualStateMachine(stateMachine, approvalStateMachine);
}

function isTaskListConfig(
  taskList: HumanInLoopRuntimeOptions["taskList"],
): taskList is NonNullable<Exclude<HumanInLoopRuntimeOptions["taskList"], TaskList>> {
  return taskList !== undefined && "dir" in taskList;
}

function isDeepEqualStateMachine(left: StateMachineDef, right: StateMachineDef): boolean {
  if (!areEqualStrings(left.states, right.states)) {
    return false;
  }

  const leftEventNames = Object.keys(left.events);
  const rightEventNames = Object.keys(right.events);

  if (!areEqualStrings(leftEventNames, rightEventNames)) {
    return false;
  }

  for (const eventName of leftEventNames) {
    const leftEvent = left.events[eventName];
    const rightEvent = right.events[eventName];

    if (leftEvent === undefined || rightEvent === undefined) {
      return false;
    }

    if (leftEvent.to !== rightEvent.to) {
      return false;
    }

    if (!areEqualEventFrom(leftEvent.from, rightEvent.from)) {
      return false;
    }
  }

  return true;
}

function areEqualEventFrom(left: readonly string[] | "*", right: readonly string[] | "*"): boolean {
  if (left === "*" || right === "*") {
    return left === right;
  }

  return areEqualStrings(left, right);
}

function areEqualStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function approvalPayloadFromTask(task: Task): ApprovalPayload | undefined {
  const metadata = task.metadata;

  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }

  if (metadata.schemaVersion !== 1) {
    return undefined;
  }

  if (typeof metadata.approvalId !== "string") {
    return undefined;
  }

  if (typeof metadata.commandPath !== "string") {
    return undefined;
  }

  if (typeof metadata.message !== "string") {
    return undefined;
  }

  if (typeof metadata.enqueuedAt !== "string") {
    return undefined;
  }

  if (typeof metadata.params !== "object" || metadata.params === null) {
    return undefined;
  }

  return {
    approvalId: metadata.approvalId,
    commandPath: metadata.commandPath,
    params: metadata.params as Record<string, unknown>,
    message: metadata.message,
    declineInputPrompt:
      typeof metadata.declineInputPrompt === "string" || metadata.declineInputPrompt === null
        ? metadata.declineInputPrompt
        : undefined,
    enqueuedAt: metadata.enqueuedAt,
    pid: typeof metadata.pid === "number" || metadata.pid === null ? metadata.pid : undefined,
    result: metadata.result,
    error: metadata.error,
  };
}
