import { expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { restore as restoreRunSnapshot } from "../restore.js";
import { dump } from "../dump.js";
import { SnapshotValidationError } from "./validation.js";
import { Budget, SandboxError } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import { interpret } from "../interp/interpreter.js";

it.each(["function f(){return await 1}return f", "return ()=>await 1"])(
  "rejects a restored root closure with invalid await: %s", async body => {
    const source = `{${body}}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    const saved = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "module", bindings: { f: original.returnValue as RuntimeSnapshotValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} })));
    expect(() => restore(saved, { source })).toThrow();
  }
);

it.each(["run", "interpreter"])("validates await context in restored module source: %s", async kind => {
  const source = "return 0";
  const saved = kind === "run"
    ? JSON.parse(await dump(await run(source)))
    : await captureDynamicFunction();
  const id = 1 + Math.max(0, ...Object.keys(saved.heap).map(Number));
  saved.heap[id] = { kind: "guest-source", functionKind: "module", parameters: "",
    body: "async function f(){return await 1}" };
  const invoke = () => kind === "run" ? restoreRunSnapshot(saved, { source }) : restore(saved, { source });
  expect(invoke).not.toThrow();
  saved.heap[id].body = "function f(){return await 1}";
  expect(invoke).toThrow(SnapshotValidationError);
});

it.each([
  ["", "return (", false],
  ["a)", "return 3", false],
  ["a", "return a", true]
] as const)("validates unreferenced dynamic source records: %s / %s", async (parameters, body, valid) => {
  const source = "return 3";
  const saved = JSON.parse(await dump(await run(source)));
  const id = 1 + Math.max(0, ...Object.keys(saved.heap).map(Number));
  saved.heap[id] = {kind: "guest-source", functionKind: "normal", parameters, body};
  if (valid) expect(restoreRunSnapshot(saved, {source})).toBe(saved);
  else expect(() => restoreRunSnapshot(saved, {source})).toThrow(SnapshotValidationError);
});

async function captureDynamicFunction() {
  const result = await run("return Function('x','return x+2')");
  if (!result.ok) throw result.error;
  return JSON.parse(JSON.stringify(serialize({source: "return 0", currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {f: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}})));
}

it.each(["run", "interpreter"])("preserves fatal module-source compilation errors in %s restore", async kind => {
  const source = "return 0";
  const saved = kind === "run" ? JSON.parse(await dump(await run(source))) : await captureDynamicFunction();
  const id = 1 + Math.max(0, ...Object.keys(saved.heap).map(Number));
  saved.heap[id] = { kind: "guest-source", functionKind: "module", parameters: "",
    body: `return /${"a".repeat(2000)}/` };
  const budget = new Budget({ maxSteps: 1000 });
  const operation = budget.acquireCompileOwner();
  try {
    const invoke = () => kind === "run"
      ? restoreRunSnapshot(saved, { source }, operation.owner)
      : restore(saved, { source, budget }, operation.owner);
    let failure: unknown;
    try { invoke(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(SandboxError);
    expect(failure).toMatchObject({ code: "budgetExceeded", budget: "steps", limit: 1000 });
  } finally { operation.release(); }
});

it.each(["run", "interpreter"])("preserves fatal dynamic-source compilation errors in %s restore", async kind => {
  const source = kind === "run" ? "const f=Function('return 3');await 0;return f()" : "return 0";
  let saved;
  if (kind === "run") {
    const pending = run(source);
    const completed = pending.catch(error => error);
    try { saved = JSON.parse(await dump(pending)); }
    finally { expect(await completed).toMatchObject({ok: true, returnValue: 3}); }
  } else saved = await captureDynamicFunction();
  const entry = Object.values(saved.heap).find(value => (value as {kind: string}).kind === "guest-source") as {body: string};
  expect(entry).toBeDefined();
  entry.body = `/*${"x".repeat(2000)}*/return 3`;
  const budget = new Budget({maxSteps: 1000});
  const operation = budget.acquireCompileOwner();
  try {
    const invoke = () => kind === "run"
      ? restoreRunSnapshot(saved, {source}, operation.owner)
      : restore(saved, {source, budget}, operation.owner);
    let failure: unknown;
    try { invoke(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(SandboxError);
    expect(failure).toMatchObject({code: "budgetExceeded", budget: "steps", limit: 1000});
  } finally { operation.release(); }
});

it("restores a dynamic closure directly from its own source namespace", async () => {
  const restored = restore(await captureDynamicFunction(), {source: "return 0"});
  const closure = restored.currentScope.lookup("f").value;
  expect(isSandboxClosure(closure)).toBe(true);
  if (!isSandboxClosure(closure)) throw new TypeError("Missing restored closure.");
  expect(await closure.call([5], {stack: [], thisValue: undefined})).toBe(7);
});

it.each(["invalid-kind", "invalid-body", "wrong-source", "unknown-node", "source-leak"])("rejects forged dynamic source state: %s", async alteration => {
  const saved = await captureDynamicFunction();
  const entries = Object.entries(saved.heap) as Array<[string, {kind: string; functionKind?: string; body?: string;
    dynamicSource?: {kind: string; id: number}; astNodeId?: number;
    state?: {properties: {properties: Array<[string, {kind: string; value: unknown; enumerable: boolean; writable: boolean; configurable: boolean}]>}}}]>;
  const source = entries.find(([,node]) => node.kind === "guest-source")![1];
  const [id, closure] = entries.find(([,node]) => node.kind === "guest-function" && node.dynamicSource !== undefined)!;
  if (alteration === "invalid-kind") source.functionKind = "native";
  if (alteration === "invalid-body") source.body = "return (";
  if (alteration === "wrong-source") closure.dynamicSource = {kind: "ref", id: Number(id)};
  if (alteration === "unknown-node") closure.astNodeId = 999999;
  if (alteration === "source-leak") closure.state!.properties.properties.push(["leak", {
    kind: "data", value: closure.dynamicSource, enumerable: true, writable: true, configurable: true
  }]);
  expect(() => restore(saved, {source: "return 0"})).toThrow(SnapshotValidationError);
});

it("reports malformed dynamic source in a run snapshot as a validation error", async () => {
  const source = "const f=Function('return 3');await 0;return f()";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: 3});
    const entry = Object.values(saved.heap).find(value => (value as {kind: string}).kind === "guest-source") as {body: string};
    expect(entry).toBeDefined();
    entry.body = "return (";
    expect(() => restoreRunSnapshot(saved, {source})).toThrow(SnapshotValidationError);
  } finally { await completed; }
});
