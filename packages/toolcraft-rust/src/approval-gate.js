import { createRequire } from "node:module";
import { enqueueApproval, ensureApprovalList } from "./approval-tasks.js";
import { spawnApprovalRunner } from "./approval-spawn.js";
import { ApprovalDeclinedError } from "./approval-error.js";
import { assertApprovalPlanHash, createApprovalPlan, formatApprovalMessage } from "./approval-plan.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.approvalGatePolicy, operation, args, host); }
  finally { depth--; }
}
const operations = {
  truthy: value => !!value,
  abort: ctx => ctx.signal?.throwIfAborted(),
  handler: (node, ctx) => node.handler(ctx),
  planContext: (ctx, commandPath) => ({ params: ctx.params, commandPath }),
  message: (config, ctx) => config.message(ctx),
  plan: (node, ctx) => node.humanInLoop.plan(ctx),
  createPlan: createApprovalPlan,
  format: formatApprovalMessage,
  assertHash: assertApprovalPlanHash,
  ensureList: ensureApprovalList,
  request: (runtime, node, message) => runtime.provider.requestApproval({ message, declineInputPrompt: node.humanInLoop.declineInputPrompt }),
  defaultEnqueue: () => enqueueApproval,
  enqueue: (enqueue, tasks, state) => enqueue({ tasks, payload: {
    commandPath: state.path, params: state.ctx.params, message: state.message,
    plan: state.approvalPlan?.value, planHash: state.approvalPlan?.hash,
    declineInputPrompt: state.node.humanInLoop.declineInputPrompt
  } }),
  spawnAllowed: value => value !== false,
  spawn: spawnApprovalRunner,
  declined(reason, commandPath) { throw new ApprovalDeclinedError({ reason, commandPath }); },
  invalidOperation() { throw new TypeError("Invalid approval gate operation"); }
};
const host = {
  operate: protect((name, args) => {
    if (name.startsWith("step:")) return { kind: name.slice(5), value: args[0] };
    if (name.startsWith("set:")) { args[0][name.slice(4)] = args[1]; return; }
    return operations[name](...args);
  }),
  get: protect((value, key) => value[key])
};

export async function invokeWithHumanInLoop(node, ctx, runtime, path, options = {}) {
  const state = { node, ctx, runtime, path, options, planContext: undefined, baseMessage: undefined, approvalPlan: undefined, message: undefined };
  let step = invoke("start", [state]);
  while (step.kind !== "return") step = invoke(step.kind, [state, await step.value]);
  return step.value;
}
