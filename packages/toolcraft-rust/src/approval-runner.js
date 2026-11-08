import { createRequire } from "node:module";
import { InvalidTransitionError } from "@poe-code/task-list-rust";
import { UserError, resolveCommandSecrets, createRuntimeLogger } from "./index.js";
import { createEnv, createFs } from "./runtime-io.js";
import { ensureApprovalList } from "./approval-tasks.js";
import { assertApprovalPlanHash, createApprovalPlan, formatApprovalMessage, isApprovalPlanValue } from "./approval-plan.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.approvalRunnerPolicy, operation, args, host); }
  finally { depth--; }
}
function errorMetadata(error) {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "Error", message: String(error) };
}
const operations = {
  undefined: () => undefined,
  true: () => true,
  truthy: value => !!value,
  done: () => ({ kind: "done" }),
  record: () => ({}),
  list: () => [],
  object: value => typeof value === "object",
  string: value => typeof value === "string",
  number: value => typeof value === "number",
  null: value => value === null,
  version: value => value === 1,
  empty: value => value.length === 0,
  nonempty: value => value.length > 0,
  ensureList: ensureApprovalList,
  getTask: (tasks, id) => tasks.get(id),
  claim: state => state.tasks.fire(state.id, "claim", { metadataPatch: { pid: process.pid } }),
  start: state => state.tasks.fire(state.id, "start"),
  request: (provider, approval) => provider.requestApproval({ message: approval.message, declineInputPrompt: approval.declineInputPrompt ?? undefined }),
  decline: (state, result) => state.tasks.fire(state.id, "decline", { metadataPatch: { error: { reason: result.reason } } }),
  fail: (state, error) => state.tasks.fire(state.id, "fail", { metadataPatch: { error: errorMetadata(error) } }),
  notJson: state => state.tasks.fire(state.id, "fail", { metadataPatch: { error: { message: "result not JSON-serializable" } } }),
  succeed: (state, serialized) => state.tasks.fire(state.id, "succeed", { metadataPatch: { result: serialized.value } }),
  conflict: error => error instanceof InvalidTransitionError,
  throw(error) { throw error; },
  createPlan: createApprovalPlan,
  assertHash: assertApprovalPlanHash,
  planValue: value => !!isApprovalPlanValue(value),
  promptMatches: (approval, plan) => !!approval.message.endsWith(formatApprovalMessage("", plan)),
  executionPlan: (command, approval) => command.humanInLoop.plan({ params: approval.params, commandPath: approval.commandPath }),
  handler: (command, ctx) => command.handler(ctx),
  context(command, params) {
    const diagnostics = createRuntimeLogger();
    return { params, secrets: resolveCommandSecrets(command), fetch: globalThis.fetch, fs: createFs(), env: createEnv(), diagnostics,
      progress(message) { diagnostics.emit({ level: "info", message, category: "progress" }); } };
  },
  serialize(value) {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? { ok: false } : { ok: true, value: JSON.parse(serialized) };
    } catch { return { ok: false }; }
  },
  segments: path => path.split(".").filter(segment => segment.length > 0),
  walk(root, path, segments) {
    let current = root;
    for (const segment of segments) current = invoke("segment", [current, segment, root, path]);
    return current;
  },
  findChild: (node, segment) => node.children.find(child => child.name === segment),
  singleton: value => [value],
  pushPath: (paths, path) => paths.push(path.join(".")),
  visitRoots(children, paths) { for (const child of children) invoke("visit", [child, [child.name], paths]); },
  visitChildren(children, path, paths) { for (const child of children) invoke("visit", [child, [...path, child.name], paths]); },
  filterChildren: node => node.children.filter(child => invoke("visible", [child])),
  includesCli: scope => !!scope.includes("cli"),
  formatPaths(paths) {
    paths = paths.sort();
    const visible = paths.slice(0, 20);
    const remaining = paths.length - visible.length;
    return `Available: ${visible.join(", ")}${remaining > 0 ? `, … and ${remaining} more` : ""}.`;
  },
  unknown(root, path) { throw new UserError(`Unknown approval command path "${path}". ${invoke("available", [root])}`); },
  malformed(task) { throw new UserError(`Malformed approval metadata for "${task.qualifiedId}".`); },
  malformedPlan() { throw new UserError("Malformed approval plan metadata."); },
  mismatchedPrompt() { throw new UserError("Approval prompt does not match its stored plan hash."); },
  unverifiable() { throw new UserError("Approval plan can no longer be verified by this command."); },
  invalidOperation() { throw new TypeError("Invalid approval runner operation"); }
};
const host = {
  operate: protect((name, args) => {
    if (name.startsWith("step:")) return { kind: name.slice(5), value: args[0] };
    if (name.startsWith("set:")) { args[0][name.slice(4)] = args[1]; return; }
    if (name.startsWith("phase:")) { args[0].phase = name.slice(6); return; }
    if (name.startsWith("define:")) return Object.defineProperty(args[0], name.slice(7), { value: args[1], enumerable: true, configurable: true, writable: true });
    return operations[name](...args);
  }),
  get: protect((value, key) => value[key])
};

export async function runApproval(id, runtime, root) {
  const state = { id, runtime, root, phase: "propagate", tasks: undefined, approval: undefined, provider: undefined, command: undefined, context: undefined };
  let step = invoke("begin", [state]);
  while (step.kind !== "done") {
    try { step = invoke(step.kind, [state, await step.value]); }
    catch (error) { step = invoke("failed", [state, error]); }
  }
}
