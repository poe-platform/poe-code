import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreRun } from "../restore.js";
import { Budget, SandboxError } from "../interp/budget.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

async function captureClosure() {
  const result = await run('return eval("(function(){return 7})")');
  if (!result.ok) throw result.error;
  return serialize({source: "return 0", currentAstNodeId: 1,
    scopeChain: [{id: "external", bindings: {f: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
}

it.each(["invalid-body", "missing-context", "missing-flag", "invalid-flag", "extra-context",
  "invalid-private-names", "duplicate-private-names", "empty-private-name", "wrong-source", "unknown-node", "source-leak"])(
  "rejects forged eval source records: %s", async alteration => {
    const wire = JSON.parse(JSON.stringify(await captureClosure()));
    const entries = Object.entries(wire.heap) as Array<[string, {kind: string; body?: string;
      context?: Record<string, unknown>; dynamicSource?: {kind: string; id: number}; astNodeId?: number;
      state?: {properties: {properties: unknown[]}}}]>;
    const source = entries.find(([,node]) => node.kind === "guest-script")![1];
    const [id, closure] = entries.find(([,node]) => node.kind === "guest-function" && node.dynamicSource !== undefined)!;
    if (alteration === "invalid-body") source.body = "return 7";
    if (alteration === "missing-context") delete source.context;
    if (alteration === "missing-flag") delete source.context!.strict;
    if (alteration === "invalid-flag") source.context!.strict = 1;
    if (alteration === "extra-context") source.context!.extra = true;
    if (alteration === "invalid-private-names") source.context!.privateNames = [1];
    if (alteration === "duplicate-private-names") source.context!.privateNames = ["x", "x"];
    if (alteration === "empty-private-name") source.context!.privateNames = [""];
    if (alteration === "wrong-source") closure.dynamicSource = {kind: "ref", id: Number(id)};
    if (alteration === "unknown-node") closure.astNodeId = 999999;
    if (alteration === "source-leak") closure.state!.properties.properties.push(["leak", {
      kind: "data", value: closure.dynamicSource, enumerable: true, writable: true, configurable: true
    }]);
    expect(() => restore(wire, {source: "return 0"})).toThrow(SnapshotValidationError);
  }
);

it.each(["run", "interpreter"])("preserves fatal eval compilation limits during %s restore", async route => {
  const source = route === "run" ? 'const f=eval("()=>7");await 0;return f()' : "return 0";
  let wire;
  if (route === "run") {
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {wire = JSON.parse(await dump(pending));}
    finally {expect(await completed).toMatchObject({ok: true, returnValue: 7});}
  } else wire = await captureClosure();
  const script = Object.values(wire.heap).find(node => (node as {kind: string}).kind === "guest-script") as {body: string};
  expect(script).toBeDefined();
  script.body = `/*${"x".repeat(2000)}*/()=>7`;
  const budget = new Budget({maxSteps: 1000});
  const operation = budget.acquireCompileOwner();
  try {
    let failure: unknown;
    try {
      if (route === "run") restoreRun(wire, {source}, operation.owner);
      else restore(wire, {source, budget}, operation.owner);
    } catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(SandboxError);
    expect(failure).toMatchObject({code: "budgetExceeded", budget: "steps"});
  } finally {operation.release();}
});

it("does not let wire context mutations alter retained source metadata", async () => {
  const result = await run('return eval("()=>7")');
  if (!result.ok) throw result.error;
  const state = {source: "return 0", currentAstNodeId: 1,
    scopeChain: [{id: "external", bindings: {f: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}};
  const first = Object.values(serialize(state).heap).find(node => node.kind === "guest-script");
  assert(first?.kind === "guest-script");
  first.context.strict = false;
  first.context.privateNames.push("forged");
  const second = Object.values(serialize(state).heap).find(node => node.kind === "guest-script");
  assert(second?.kind === "guest-script");
  expect(second.context.strict).toBe(true);
  expect(second.context.privateNames).toEqual([]);
});
