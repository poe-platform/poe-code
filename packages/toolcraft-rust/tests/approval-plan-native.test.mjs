import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/approval-plan.js";
import * as reference from "../../toolcraft/dist/human-in-loop/plan-hash.js";

function capture(lib, value) {
  try { return lib.createApprovalPlan(value); }
  catch (error) { return { error: [error.name, error.message] }; }
}

test("approval plans retain canonical text, hashing, shared values and JSON rejection", () => {
  const shared = { z: 1, a: "x" };
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [null, false, 2, -0, "😀\ud800", undefined, NaN, Infinity, 4n, Symbol("x"), () => {},
    new Date(0), new Map(), [1, false, null], Array(3), { z: shared, a: shared }, Object.create(null),
    { nested: { numbers: [2, 1], value: true } }, cyclic, JSON.parse('{"__proto__":{"x":1},"a":2}')]) {
    assert.deepEqual(capture(native, value), capture(reference, value));
    if (value !== cyclic) assert.equal(native.isApprovalPlanValue(value), reference.isApprovalPlanValue(value));
  }
});

test("approval plan traversal retains sorted getter order and host array species", () => {
  const run = lib => {
    const trace = [];
    const shared = new Proxy({ z: 1, a: 2 }, { get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); } });
    const plan = lib.createApprovalPlan({ z: shared, a: shared });
    return { plan, trace };
  };
  assert.deepEqual(run(native), run(reference));
  class Items extends Array {}
  for (const lib of [native, reference]) {
    const values = new Items(2); values[1] = { z: 1 };
    const result = lib.createApprovalPlan(values);
    assert.ok(result.value instanceof Items);
    assert.equal(0 in result.value, false);
    assert.equal(result.canonical, '[null,{"z":1}]');
    const failure = { failure: true };
    assert.throws(() => lib.createApprovalPlan({ get value() { throw failure; } }), error => error === failure);
  }
});

test("approval message and hash checks preserve accessor ordering and exact errors", () => {
  for (const lib of [native, reference]) {
    const trace = [];
    assert.equal(lib.formatApprovalMessage("Proceed?", { get display() { trace.push("display"); return "{}"; }, get hash() { trace.push("hash"); return "sha256:fixture"; } }), "Proceed?\n\nPlan:\n{}\n\nPlan hash: sha256:fixture");
    assert.deepEqual(trace, ["display", "hash"]);
    assert.equal(lib.assertApprovalPlanHash("same", "same"), undefined);
    assert.throws(() => lib.assertApprovalPlanHash("before", "after"), { name: "UserError", message: "Approval plan changed after approval. Expected before, received after." });
  }
});
