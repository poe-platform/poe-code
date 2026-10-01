import { createRequire } from "node:module";
import { TaskNotFoundError } from "@poe-code/task-list-rust";
import { S } from "toolcraft-schema-rust";
import { UserError, defineCommand, defineGroup } from "./index.js";
import { ensureApprovalList } from "./approval-tasks.js";
import { approvalStateMachine } from "./approval-state-machine.js";
import { runApproval } from "./approval-runner.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const approvalsGroupSymbol = Symbol("toolcraft.humanInLoop.approvalsBuiltIn");
let depth = 0;
export function approvalCommandsPolicy(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.approvalCommandsPolicy, operation, args, host); }
  finally { depth--; }
}
const invoke = approvalCommandsPolicy;
const operations = {
  undefined: () => undefined,
  true: () => true,
  false: () => false,
  truthy: value => !!value,
  record: () => ({}),
  array: () => [],
  copy: value => ({ ...value }),
  empty: value => value.length === 0,
  string: value => typeof value === "string",
  emptyString: () => "",
  has: (set, value) => set.has(value),
  add: (set, value) => set.add(value),
  push: (array, value) => array.push(value),
  findExisting: root => root.children.find(child => child.name === approvalsGroup.name),
  marked: node => node[approvalsGroupSymbol] === true,
  merged: root => ({ ...root, children: [...root.children, approvalsGroup] }),
  reserved() { throw new UserError("'approvals' is reserved for human-in-loop built-ins"); },
  missingProvider() { throw new UserError('createHumanInLoop requires a provider — import one from "toolcraft/human-in-loop" (e.g. osascriptProvider) or pass your own'); },
  missingTask: error => error instanceof TaskNotFoundError,
  missingState: error => typeof error === "object" && error !== null && Object.prototype.hasOwnProperty.call(error, "code") && error.code === "ENOENT",
  notFound(id) { throw new UserError(`Approval "${id}" not found. Run approvals list to see queued approvals.`); },
  throw(error) { throw error; },
  emptyText: () => "No approvals found.",
  emptyMessage: (_result, logger) => { logger.message("No approvals found."); },
  listTable(result, logger, renderTable, getTheme) {
    logger.message(renderTable({ theme: getTheme(), columns: [
      { name: "id", title: "ID", alignment: "left", maxLen: 24 },
      { name: "state", title: "State", alignment: "left", maxLen: 18 },
      { name: "name", title: "Name", alignment: "left", maxLen: 60 }
    ], rows: result.map(task => invoke("listRow", [task])) }));
  },
  listMarkdown(result) {
    const lines = ["| ID | State | Name |", "| :--- | :--- | :--- |"];
    for (const task of result) lines.push(`| ${task.id.replaceAll("|", "\\|")} | ${task.state.replaceAll("|", "\\|")} | ${task.name.replaceAll("|", "\\|")} |`);
    return lines.join("\n");
  },
  detailsRich: renderApprovalDetails,
  detailsMarkdown: renderApprovalDetailsMarkdown,
  serialize(value) {
    try { return JSON.stringify(value) ?? String(value); }
    catch { return String(value); }
  },
  invalidOperation() { throw new TypeError("Invalid approval command operation"); }
};
const host = {
  operate: protect((name, args) => {
    if (name.startsWith("define:")) return Object.defineProperty(args[0], name.slice(7), { value: args[1], enumerable: true, configurable: true, writable: true });
    return operations[name](...args);
  }),
  get: protect((value, key) => value[key])
};

const listScope = ["cli", "mcp", "sdk"];
const runScope = ["cli"];
const listParams = S.Object({ state: S.Optional(S.Array(S.Enum(approvalStateMachine.states))) });
const showParams = S.Object({ approvalId: S.String() });
const runParams = S.Object({ approvalId: S.String() });

export const approvalsGroup = defineGroup({
  name: "approvals",
  description: "Inspect and execute queued approvals.",
  children: [
    defineCommand({
      name: "list", description: "List queued approvals.", scope: listScope, params: listParams,
      handler: async ({ params, humanInLoop }) => {
        try {
          const { tasks } = await ensureApprovalList(humanInLoop.runtimeOptions, { create: false });
          return loadApprovals(tasks, params.state);
        } catch (error) { return invoke("listError", [error]); }
      },
      render: {
        rich: (result, primitives) => renderApprovalList(result, primitives),
        markdown: result => invoke("listMarkdown", [result]),
        json: result => result
      }
    }),
    defineCommand({
      name: "show", description: "Show one approval.", scope: listScope, params: showParams,
      handler: async ({ params, humanInLoop }) => withMissingApprovalError(params.approvalId, async () => {
        const { tasks } = await ensureApprovalList(humanInLoop.runtimeOptions, { create: false });
        return tasks.get(params.approvalId);
      }),
      render: {
        rich: (result, primitives) => renderApprovalDetails(result, primitives),
        markdown: result => renderApprovalDetailsMarkdown(result),
        json: result => result
      }
    }),
    defineCommand({
      name: "run", description: "Run one queued approval.", scope: runScope, params: runParams,
      handler: async ({ params, humanInLoop, root }) => withMissingApprovalError(params.approvalId, async () =>
        runApproval(params.approvalId, humanInLoop.runtimeOptions, root)),
      render: {
        rich: (result, primitives) => invoke("runRich", [result, primitives]),
        markdown: result => invoke("runMarkdown", [result]),
        json: result => result
      }
    })
  ]
});
Object.defineProperty(approvalsGroup, approvalsGroupSymbol, {
  configurable: false, enumerable: false, value: true, writable: false
});

export function mergeApprovalsGroup(root) { return invoke("merge", [root]); }

async function loadApprovals(tasks, states = []) {
  if (!invoke("filter", [states])) return tasks.all();
  const seen = new Set();
  const approvals = [];
  for (const state of states) {
    const matching = await tasks.all({ state });
    for (const task of matching) invoke("collect", [task, seen, approvals]);
  }
  return approvals;
}

function renderApprovalList(result, { logger, renderTable, getTheme }) {
  invoke("listRich", [result, logger, renderTable, getTheme]);
}

function renderApprovalDetails(result, { logger, renderTable, getTheme }) {
  logger.message(renderTable({ theme: getTheme(), columns: [
    { name: "key", title: "Key", alignment: "left", maxLen: 18 },
    { name: "value", title: "Value", alignment: "left", maxLen: 80 }
  ], rows: Object.entries(invoke("taskRecord", [result])).map(([key, value]) => ({
    key, value: invoke("stringify", [value])
  })) }));
}

function renderApprovalDetailsMarkdown(result) {
  return Object.entries(invoke("taskRecord", [result])).map(([key, value]) => `- ${key}: ${invoke("stringify", [value])}`).join("\n");
}

async function withMissingApprovalError(id, run) {
  try { return await run(); }
  catch (error) { return invoke("taskError", [id, error]); }
}
