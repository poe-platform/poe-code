import assert from "node:assert/strict";
import { test } from "node:test";
import { runApproval as native } from "../dist/approval-runner.js";
import { runApproval as reference } from "../../toolcraft/dist/human-in-loop/runner.js";
import { approvalStateMachine } from "../dist/approval-state-machine.js";
import { createApprovalPlan, formatApprovalMessage } from "../dist/approval-plan.js";
import { InvalidTransitionError as NativeTransition } from "@poe-code/task-list-rust";
import { InvalidTransitionError as ReferenceTransition } from "@poe-code/task-list";

async function run(invoke, options = {}) {
  const trace = [];
  const observe = (target, prefix) => !options.observe ? target : new Proxy(target, { get(target, key, receiver) {
    trace.push(`${prefix}.${String(key)}`); return Reflect.get(target, key, receiver);
  } });
  const events = [];
  const plan = createApprovalPlan({ revision: 1 });
  const metadata = observe({ schemaVersion: 1, commandPath: options.path ?? "group.run", params: { original: true },
    message: options.plan ? formatApprovalMessage("Run?", plan) : "Run?",
    ...(options.plan ? { plan: plan.value, planHash: plan.hash } : {}) }, "metadata");
  const command = observe({ kind: "command", name: "run", scope: ["cli"], secrets: {},
    humanInLoop: options.plan ? { plan: () => ({ revision: options.drift ? 2 : 1 }) } : undefined,
    handler(ctx) {
      trace.push("handler"); assert.equal(this, command); assert.equal(ctx.params, metadata.params);
      assert.equal(ctx.fetch, globalThis.fetch); assert.equal(typeof ctx.env.get, "function");
      if (options.handlerFailure) throw options.handlerFailure;
      return Object.hasOwn(options, "result") ? options.result : { ok: true };
    } }, "command");
  const root = { kind: "group", children: [{ kind: "group", name: "group", children: [command] }] };
  const task = observe({ state: options.state ?? "pending", qualifiedId: "approvals/id", metadata }, "task");
  const tasks = observe({ stateMachine: approvalStateMachine,
    async get(id) { assert.equal(this, tasks); assert.equal(id, "id"); return task; },
    async fire(id, event, options) {
      assert.equal(this, tasks); assert.equal(id, "id"); trace.push(`fire:${event}`);
      events.push([event, options]);
      if (event === "claim" && run.claimError) throw run.claimError;
    } }, "tasks");
  const provider = observe({ async requestApproval(input) {
    assert.equal(this, provider); trace.push("prompt");
    assert.equal(input.message, metadata.message);
    if (options.providerFailure) throw options.providerFailure;
    return options.decline ? { outcome: "declined", reason: "later" } : { outcome: "approved" };
  } }, "provider");
  const runtime = observe({ taskList: { list: () => tasks }, provider }, "runtime");
  const operation = invoke("id", runtime, root);
  const settled = operation.then(() => trace.push("finished"), error => { trace.push("rejected"); return error; });
  for (let i = 0; i < 14; i++) { trace.push(`tick${i}`); await Promise.resolve(); }
  const error = await settled;
  const projected = JSON.parse(JSON.stringify(events, (key, value) => key === "stack" ? "<stack>" : value));
  return { trace, events: projected, error: error && [error.name, error.message] };
}

test("approval runners preserve ordered transitions, getters and promise boundaries", async () => {
  for (const options of [{}, { observe: true }, { plan: true }, { plan: true, drift: true }, { decline: true },
    { state: "declined" }, { path: "missing" }, { path: "..group..run." }, { path: "group" }, { path: "" },
    { result: undefined }, { result: 4n }, { result: { toJSON: () => ({ converted: true }) } },
    { providerFailure: "offline" }, { handlerFailure: "failed" }]) {
    assert.deepEqual(await run(native, options), await run(reference, options));
  }
});

test("approval runners exit on claim contention and propagate unrelated claim errors", async () => {
  try {
    for (const [invoke, ErrorClass] of [[native, NativeTransition], [reference, ReferenceTransition]]) {
      run.claimError = new ErrorClass("claimed elsewhere");
      const outcome = await run(invoke);
      assert.deepEqual(outcome.events.map(event => event[0]), ["claim"]);
      assert.equal(outcome.error, undefined);
      const failure = new Error("write failed"); failure.stack = "fixed stack";
      run.claimError = failure;
      assert.deepEqual((await run(invoke)).error, ["Error", "write failed"]);
    }
  } finally { delete run.claimError; }
});

test("approval runner error-write failures preserve the reference catch boundaries", async () => {
  const scenario = async (invoke, firstFailure) => {
    const events = [];
    const failure = { failure: firstFailure };
    const tasks = { stateMachine: approvalStateMachine,
      async get() { return { state: "pending", metadata: { schemaVersion: 1, commandPath: "run", params: {}, message: "Run?" } }; },
      async fire(_id, event) { events.push(event); if (event === firstFailure) throw failure; }
    };
    const node = { kind: "command", name: "run", secrets: {}, handler: () => firstFailure === "fail" ? undefined : "ok" };
    const provider = { requestApproval: async () => ({ outcome: firstFailure === "decline" ? "declined" : "approved" }) };
    let rejected;
    try { await invoke("id", { taskList: { list: () => tasks }, provider }, { kind: "group", children: [node] }); }
    catch (error) { assert.equal(error, failure); rejected = true; }
    return { events, rejected };
  };
  for (const stage of ["start", "decline", "succeed", "fail"])
    assert.deepEqual(await scenario(native, stage), await scenario(reference, stage));
});
