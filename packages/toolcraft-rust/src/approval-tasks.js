import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { TaskAlreadyExistsError, TaskNotFoundError, openTaskList } from "@poe-code/task-list-rust";
import { UserError } from "./index.js";
import { approvalStateMachine } from "./approval-state-machine.js";
import { isApprovalPlanValue } from "./approval-plan.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const opened = new WeakMap();
const validated = new WeakMap();
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.approvalTasksPolicy, operation, args, host); }
  finally { depth--; }
}
const operations = {
  undefined: () => undefined,
  true: () => true,
  false: () => false,
  truthy: value => !!value,
  defaultName: () => "approvals",
  unknown: () => "unknown",
  defaultOpen: () => openTaskList,
  machine: () => approvalStateMachine,
  hasDir: list => "dir" in list,
  opened: runtime => opened.get(runtime),
  cacheOpen: (runtime, promise) => opened.set(runtime, promise),
  validated: (runtime, name) => !!(validated.get(runtime)?.has(name) ?? false),
  validatedNames: runtime => validated.get(runtime),
  nameSet: name => new Set([name]),
  cacheValidated: (runtime, names) => validated.set(runtime, names),
  addName: (names, name) => names.add(name),
  resolveList: async (...args) => invoke("resolve", args),
  open: (open, create, type, path) => open({ create, type, path, stateMachine: approvalStateMachine }),
  prepared: (listName, promise) => ({ listName, promise }),
  list: (list, name) => list.list(name),
  resolved: (taskList, listName, tasks) => ({ taskList, listName, tasks }),
  keys: Object.keys,
  property: (value, key) => value[key],
  zero: () => 0,
  lt: (left, right) => left < right,
  increment: value => value + 1,
  equalEvents(left, right, names) {
    for (const name of names) if (!invoke("equalEvent", [left, right, name])) return false;
    return true;
  },
  recordObject: () => ({}),
  id: time => `${time.slice(0, 19).replaceAll(":", "-")}-${randomBytes(3).toString("hex")}`,
  record(payload, enqueuedAt, approvalId) {
    const metadata = { schemaVersion: 1, approvalId, commandPath: payload.commandPath,
      params: payload.params, message: payload.message, declineInputPrompt: payload.declineInputPrompt ?? null,
      enqueuedAt, pid: null, result: null, error: null };
    const pending = { status: "pending-approval", approvalId, message: payload.message, enqueuedAt };
    return { approvalId, name: `${payload.commandPath} (${enqueuedAt})`, metadata, pending };
  },
  attachPlan(record, payload) {
    record.metadata.plan = payload.plan;
    record.metadata.planHash = payload.planHash;
    record.pending.planHash = payload.planHash;
  },
  object: value => typeof value === "object",
  string: value => typeof value === "string",
  number: value => typeof value === "number",
  null: value => value === null,
  version: value => value === 1,
  plan: value => !!isApprovalPlanValue(value),
  collision: error => error instanceof TaskAlreadyExistsError,
  missing: error => error instanceof TaskNotFoundError,
  throw(error) { throw error; },
  missingList() { throw new UserError("humanInLoop.taskList required for async-mode commands"); },
  differentMachine(dir) { throw new UserError(`Approvals task list was created with a different version of toolcraft. Delete the task list directory (${dir}) or pass a matching approvalStateMachine.`); },
  invalidOperation() { throw new TypeError("Invalid approval task operation"); }
};
const host = {
  operate: protect((name, args) => {
    if (name.startsWith("define:")) return Object.defineProperty(args[0], name.slice(7), { value: args[1], enumerable: true, configurable: true, writable: true });
    return operations[name](...args);
  }),
  get: protect((value, key) => value[key])
};

export async function ensureApprovalList(runtime, deps = {}) {
  const { listName, promise } = invoke("prepare", [runtime, deps]);
  const taskList = await promise;
  return invoke("finish", [runtime, listName, taskList]);
}

async function createApprovalTask(tasks, approval) {
  await tasks.create({ id: approval.approvalId, name: approval.name, metadata: approval.metadata });
}

export async function enqueueApproval(ctx) {
  const enqueuedAt = new Date().toISOString();
  const approval = invoke("record", [ctx.payload, enqueuedAt]);
  try { await createApprovalTask(ctx.tasks, approval); }
  catch (error) {
    invoke("enqueueError", [error]);
    const retry = invoke("record", [ctx.payload, enqueuedAt]);
    await createApprovalTask(ctx.tasks, retry);
    return retry;
  }
  return approval;
}

export async function loadApproval(ctx) {
  try {
    const task = await ctx.tasks.get(ctx.approvalId);
    return invoke("payload", [task]);
  } catch (error) { return invoke("loadError", [error]); }
}
