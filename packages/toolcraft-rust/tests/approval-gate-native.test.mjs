import assert from "node:assert/strict";
import { test } from "node:test";
import { invokeWithHumanInLoop as native } from "../dist/approval-gate.js";
import { invokeWithHumanInLoop as reference } from "../../toolcraft/dist/human-in-loop/gate.js";
import { approvalStateMachine } from "../dist/approval-state-machine.js";

test("approval gate preserves callback receivers, getter order and async settlement", async () => {
  const run = async (invoke, withPlan, gated) => {
    const trace = [];
    const observe = (object, label) => new Proxy(object, { get(target, key, receiver) {
      trace.push(`${label}.${String(key)}`); return Reflect.get(target, key, receiver);
    } });
    const config = observe({ mode: "sync", message(ctx) { assert.equal(this, config); return `Approve ${ctx.commandPath}`; },
      plan: withPlan ? async function(ctx) { assert.equal(this, config); assert.equal(ctx.params.value, 1); return { v: 1 }; } : undefined }, "config");
    const node = observe({ humanInLoop: gated ? config : undefined, handler(ctx) { assert.equal(this, node); return ctx.params; } }, "node");
    const provider = observe({ requestApproval(input) { assert.equal(this, provider); trace.push(input.message); return { outcome: "approved" }; } }, "provider");
    const promise = invoke(node, observe({ params: { value: 1 } }, "ctx"), observe({ provider }, "runtime"), "root.run");
    promise.then(() => trace.push("fulfilled"));
    for (let i = 0; i < 12; i++) { trace.push(`tick${i}`); await Promise.resolve(); }
    return { result: await promise, trace };
  };
  for (const withPlan of [false, true]) for (const gated of [false, true])
    assert.deepEqual(await run(native, withPlan, gated), await run(reference, withPlan, gated));
});

test("approval gate rejects decline and plan changes, and respects cancellation at each callback", async () => {
  for (const invoke of [native, reference]) {
    for (const at of ["before", "plan", "approval", "verify"]) {
      const controller = new AbortController(); const reason = { at };
      let plans = 0; let handled = false;
      const node = { humanInLoop: { mode: "sync", message: () => "Approve?", async plan() {
        plans++; if (at === "plan" || (at === "verify" && plans === 2)) controller.abort(reason); return {};
      } }, handler() { handled = true; } };
      const provider = { async requestApproval() { if (at === "approval") controller.abort(reason); return { outcome: "approved" }; } };
      if (at === "before") controller.abort(reason);
      await assert.rejects(invoke(node, { signal: controller.signal, params: {} }, { provider }, "run"), error => error === reason);
      assert.equal(handled, false);
    }
    const node = { humanInLoop: { mode: "sync", message: () => "Approve?" }, handler() { throw new Error("must not run"); } };
    await assert.rejects(invoke(node, { params: {} }, { provider: { async requestApproval() { return { outcome: "declined", reason: "later" }; } } }, "run"), error => error.name === "ApprovalDeclinedError" && error.reason === "later" && error.commandPath === "run");
    let revision = 0;
    node.humanInLoop.plan = () => ({ revision: revision++ });
    await assert.rejects(invoke(node, { params: {} }, { provider: { async requestApproval() { return { outcome: "approved" }; } } }, "run"), /Approval plan changed after approval/);
  }
});

test("approval gate async enqueue preserves callbacks, pending identity and cancellation", async () => {
  for (const invoke of [native, reference]) {
    for (const cancel of [false, true]) {
      const controller = new AbortController(); const reason = {};
      const node = { humanInLoop: { mode: "async", message: () => "Approve?", plan: () => ({ value: 1 }) }, handler() { throw new Error("must not run"); } };
      const tasks = { stateMachine: approvalStateMachine };
      const pending = { status: "pending-approval" };
      const options = { spawnRunner: false, async enqueueApproval(input) {
        assert.equal(this, undefined); assert.equal(input.tasks, tasks); assert.deepEqual(input.payload.plan, { value: 1 });
        assert.ok(input.payload.planHash.startsWith("sha256:"));
        if (cancel) controller.abort(reason); return { approvalId: "fixture", pending };
      } };
      const result = invoke(node, { params: {}, signal: controller.signal }, { taskList: { list: () => tasks } }, "run", options);
      if (cancel) await assert.rejects(result, error => error === reason);
      else assert.equal(await result, pending);
    }
  }
});
