import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/approval-tasks.js";
import * as reference from "../../toolcraft/dist/human-in-loop/approval-tasks.js";
import { approvalStateMachine as nativeMachine } from "../dist/approval-state-machine.js";
import { approvalStateMachine as referenceMachine } from "../../toolcraft/dist/human-in-loop/state-machine.js";
import * as nativeTasks from "@poe-code/task-list-rust";
import * as referenceTasks from "@poe-code/task-list";

test("approval state definition exactly matches and is deeply frozen", () => {
  assert.deepEqual(nativeMachine, referenceMachine);
  for (const value of [nativeMachine, nativeMachine.states, nativeMachine.events,
    ...Object.values(nativeMachine.events), ...Object.values(nativeMachine.events).map(event => event.from)]) assert.ok(Object.isFrozen(value));
});

test("approval storage shares opening promises and retains rejected opens until runtime changes", async () => {
  for (const [lib, machine] of [[native, nativeMachine], [reference, referenceMachine]]) {
    let opens = 0;
    const tasks = { stateMachine: machine };
    const list = { list(name) { assert.equal(this, list); assert.equal(name, "approvals"); return tasks; } };
    const runtime = { taskList: { dir: "/virtual", format: "yaml-file" } };
    const deps = { openTaskList: async options => { opens++; assert.equal(options.stateMachine, machine); return list; } };
    const [first, second] = await Promise.all([lib.ensureApprovalList(runtime, deps), lib.ensureApprovalList(runtime, deps)]);
    assert.equal(first.taskList, list); assert.equal(second.taskList, list); assert.equal(opens, 1);
    await lib.ensureApprovalList(runtime, { ...deps, create: false }); assert.equal(opens, 2);
    const failedRuntime = { taskList: { dir: "/virtual", format: "yaml-file" } };
    const failure = { failed: true };
    const failedDeps = { openTaskList: async () => { opens++; throw failure; } };
    await assert.rejects(lib.ensureApprovalList(failedRuntime, failedDeps), error => error === failure);
    await assert.rejects(lib.ensureApprovalList(failedRuntime, deps), error => error === failure);
    assert.equal(opens, 3);
  }
});

test("approval payload validation retains optional values, arrays and getter order", async () => {
  const base = { schemaVersion: 1, approvalId: "id", commandPath: "group.run", message: "Approve?", enqueuedAt: "time", params: {}, result: { value: true }, error: null };
  const run = async (lib, metadata) => {
    const reads = [];
    const observed = metadata === null || typeof metadata !== "object" ? metadata : new Proxy(metadata, { get(target, key, receiver) {
      reads.push(String(key)); return Reflect.get(target, key, receiver);
    } });
    const result = await lib.loadApproval({ approvalId: "id", tasks: { async get() { return { metadata: observed }; } } });
    return { result, reads };
  };
  for (const value of [undefined, null, 3, "text", {}, base, { ...base, params: [] }, { ...base, params: null },
    { ...base, schemaVersion: 2 }, { ...base, plan: { nested: [1] }, planHash: "hash", pid: 1, declineInputPrompt: "Why?" },
    { ...base, plan: new Date(), planHash: null, pid: null, declineInputPrompt: null },
    { ...base, plan: false, planHash: 1, pid: NaN, declineInputPrompt: 2 }]) assert.deepEqual(await run(native, value), await run(reference, value));
});

test("approval enqueue retries one collision and preserves error identities", async () => {
  for (const [lib, errors] of [[native, nativeTasks], [reference, referenceTasks]]) {
    let creates = 0;
    const payload = { commandPath: "run", params: { original: true }, message: "Approve?", plan: false, planHash: "hash" };
    const tasks = { async create(record) {
      assert.equal(this, tasks); creates++;
      if (creates === 1) throw new errors.TaskAlreadyExistsError("collision");
      assert.equal(record.metadata.params, payload.params);
      assert.equal(record.metadata.plan, false);
    } };
    const result = await lib.enqueueApproval({ tasks, payload });
    assert.equal(creates, 2); assert.equal(result.pending.planHash, "hash");
    assert.equal(result.metadata.params, payload.params);
    const missing = new errors.TaskNotFoundError("missing");
    assert.equal(await lib.loadApproval({ tasks: { async get() { throw missing; } }, approvalId: "missing" }), undefined);
    for (const failure of [undefined, null, false, Symbol("failure"), { failed: true }]) {
      await assert.rejects(lib.loadApproval({ tasks: { async get() { throw failure; } } }), error => error === failure);
      await assert.rejects(lib.enqueueApproval({ payload, tasks: { async create() { throw failure; } } }), error => error === failure);
    }
  }
});
