import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/approval-commands.js";
import * as reference from "../../toolcraft/dist/human-in-loop/approvals-commands.js";
import { createHumanInLoop as nativeRuntime } from "../dist/approval-runtime.js";
import { createHumanInLoop as referenceRuntime } from "../../toolcraft/dist/human-in-loop/runtime.js";
import { approvalStateMachine } from "../dist/approval-state-machine.js";
import { TaskNotFoundError as NativeMissing } from "@poe-code/task-list-rust";
import { TaskNotFoundError as ReferenceMissing } from "@poe-code/task-list";

const command = (api, name) => api.approvalsGroup.children.find(child => child.name === name);

test("approval group merging preserves identity, markers and property access order", () => {
  function run(api) {
    const trace = [];
    const root = new Proxy({ kind: "group", name: "root", children: [], extra: 1 }, {
      get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); }
    });
    const merged = api.mergeApprovalsGroup(root);
    assert.equal(api.mergeApprovalsGroup(merged), merged);
    assert.equal(merged.children[0], api.approvalsGroup);
    const symbol = Object.getOwnPropertySymbols(api.approvalsGroup).find(key => key.description === "toolcraft.humanInLoop.approvalsBuiltIn");
    assert.deepEqual(Object.getOwnPropertyDescriptor(api.approvalsGroup, symbol), {
      value: true, writable: false, configurable: false, enumerable: false
    });
    assert.throws(() => api.mergeApprovalsGroup({ children: [{ kind: "group", name: "approvals" }] }),
      { message: "'approvals' is reserved for human-in-loop built-ins" });
    assert.deepEqual(root.children, []);
    return trace;
  }
  assert.deepEqual(run(native), run(reference));
});

test("approval lists preserve filter ordering, duplicate reads, receivers and settlement timing", async () => {
  async function run(api, states, fail) {
    const trace = [];
    const task = new Proxy({ qualifiedId: "a", id: "a" }, { get(target, key) { trace.push(`task:${String(key)}`); return target[key]; } });
    const failure = { code: "ENOENT" };
    const tasks = { stateMachine: approvalStateMachine, async all(options) {
      assert.equal(this, tasks); trace.push(options?.state ?? "all");
      if (fail) throw failure;
      return [task, task];
    } };
    const params = { get state() { trace.push("state"); return states; } };
    const runtimeOptions = { taskList: { list: () => tasks } };
    const pending = command(api, "list").handler({ params, humanInLoop: { runtimeOptions } });
    const settled = pending.then(value => { trace.push("resolved"); return { value }; }, error => {
      assert.equal(error, failure); trace.push("rejected"); return { failed: true };
    });
    for (let i = 0; i < 16; i++) { trace.push(`tick:${i}`); await Promise.resolve(); }
    const result = await settled;
    return { result: result.failed ? result : { value: result.value.map(value => value.id) }, trace: [...trace] };
  }
  for (const states of [undefined, [], ["pending"], ["pending", "declined", "pending"]]) {
    for (const fail of [false, true]) assert.deepEqual(await run(native, states, fail), await run(reference, states, fail));
  }
});

test("approval commands translate only the reference missing errors", async () => {
  for (const [api, Missing] of [[native, NativeMissing], [reference, ReferenceMissing]]) {
    for (const failure of [new Missing("absent"), { code: "ENOENT" }, Object.create({ code: "ENOENT" }), null, 0]) {
      const tasks = { stateMachine: approvalStateMachine, async get() { throw failure; } };
      await assert.rejects(command(api, "show").handler({ params: { approvalId: "id" },
        humanInLoop: { runtimeOptions: { taskList: { list: () => tasks } } } }), error => {
        if (failure instanceof Missing || Object.hasOwn(failure ?? {}, "code")) {
          assert.equal(error.message, 'Approval "id" not found. Run approvals list to see queued approvals.');
        } else assert.equal(error, failure);
        return true;
      });
    }
    const runtimeOptions = { taskList: { list() { throw { code: "ENOENT" }; } } };
    assert.deepEqual(await command(api, "list").handler({ params: {}, humanInLoop: { runtimeOptions } }), []);
  }
});

test("approval renderers preserve output, callbacks, getters and JSON fallback", () => {
  function run(api, name, result) {
    const trace = [];
    const primitives = {
      get logger() { trace.push("logger"); return { message(value) { trace.push(["message", value]); } }; },
      get renderTable() { trace.push("renderTable"); return options => { trace.push(options); return "table"; }; },
      get getTheme() { trace.push("getTheme"); return () => { trace.push("theme"); return "theme"; }; }
    };
    const render = command(api, name).render;
    const rich = render.rich(result, primitives);
    const markdown = render.markdown(result);
    assert.equal(render.json(result), result);
    return { rich, markdown, trace };
  }
  const task = { list: "approvals", id: "x|y\ud800", qualifiedId: "approvals/x", name: "Task|name", state: "pending", metadata: { x: 1 } };
  for (const [name, result] of [["list", []], ["list", [task]], ["show", task], ["run", task], ["run", undefined]])
    assert.deepEqual(run(native, name, result), run(reference, name, result));
  for (const metadata of [undefined, 1n, { toJSON: () => undefined }, { toJSON() { throw 0; }, toString: () => "fallback" }])
    assert.deepEqual(run(native, "show", { ...task, metadata }), run(reference, "show", { ...task, metadata }));
});

test("human-in-loop runtime admission and option copying preserve reference observations", async () => {
  function run(create) {
    const trace = [];
    const options = { get provider() { trace.push("provider"); return null; }, get taskList() { trace.push("taskList"); return undefined; } };
    const runtime = create(options);
    assert.notEqual(runtime.runtimeOptions, options);
    assert.equal(runtime.runtimeOptions.provider, null);
    assert.deepEqual(Object.keys(runtime), ["runtimeOptions", "invoke", "mergeApprovalsGroup"]);
    return trace;
  }
  assert.deepEqual(run(nativeRuntime), run(referenceRuntime));
  for (const options of [null, undefined, {}, { provider: undefined }]) {
    let message;
    try { referenceRuntime(options); } catch (error) { message = error.message; }
    assert.throws(() => nativeRuntime(options), { message });
  }
  const ctx = { params: {} };
  const node = { handler(value) { assert.equal(this, node); assert.equal(value, ctx); return "ok"; } };
  assert.equal(await nativeRuntime({ provider: {} }).invoke(node, ctx, "run"), "ok");
});
