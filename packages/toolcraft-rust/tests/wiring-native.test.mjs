import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/approval-wiring.js";
import * as reference from "../../toolcraft/dist/human-in-loop/wiring.js";

function capture(operation) {
  try { return { value: operation() }; }
  catch (error) { return { error: [error.name, error.message] }; }
}

test("approval wiring finds the first gated command and preserves nested path labels", () => {
  for (const root of [
    { kind: "command", name: "direct", humanInLoop: {} },
    { kind: "group", children: [{ kind: "group", name: "nested", children: [{ kind: "command", name: "run", humanInLoop: {} }] }] },
    { kind: "group", children: [{ kind: "command", name: "ungated" }, { kind: "command", name: "gated", humanInLoop: true }] },
    { kind: "group", children: [] }
  ]) for (const runtime of [undefined, null, false, {}]) {
    assert.deepEqual(capture(() => native.assertHumanInLoopWired(root, runtime)), capture(() => reference.assertHumanInLoopWired(root, runtime)));
  }
});

test("approval root merging preserves strict flags, changing getters and callback receiver", () => {
  for (const lib of [native, reference]) {
    const root = {}, merged = {};
    for (const approvals of [undefined, false, 0, 1, "true"]) assert.equal(lib.mergeApprovalsRoot(root, { approvals }), root);
    let reads = 0;
    const runtime = { mergeApprovalsGroup(value) { assert.equal(this, runtime); assert.equal(value, root); return merged; } };
    const options = { approvals: true, get humanInLoop() { reads++; return reads === 1 ? {} : runtime; } };
    assert.equal(lib.mergeApprovalsRoot(root, options), merged);
    assert.equal(reads, 2);
    assert.throws(() => lib.mergeApprovalsRoot(root, { approvals: true }), /requires a wired humanInLoop runtime/);
  }
});

test("approval traversal closes iterators on early matches and preserves arbitrary exceptions", () => {
  for (const lib of [native, reference]) {
    const trace = [];
    const children = { *[Symbol.iterator]() { try { yield { kind: "command", name: "first", humanInLoop: true }; trace.push("late"); } finally { trace.push("closed"); } } };
    assert.throws(() => lib.assertHumanInLoopWired({ kind: "group", children }), /command 'first'/);
    assert.deepEqual(trace, ["closed"]);
    for (const failure of [undefined, null, false, Symbol("failure"), { failure: true }]) {
      const child = { kind: "command", name: "run", get humanInLoop() { throw failure; } };
      assert.throws(() => lib.assertHumanInLoopWired({ kind: "group", children: [child] }), error => error === failure);
      const runtime = { mergeApprovalsGroup() { throw failure; } };
      assert.throws(() => lib.mergeApprovalsRoot({}, { approvals: true, humanInLoop: runtime }), error => error === failure);
    }
  }
});
