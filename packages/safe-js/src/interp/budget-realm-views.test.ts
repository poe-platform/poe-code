import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "./intrinsics.js";
import { createBuiltinBindings } from "./globals.js";
import { materializeFunctionProperties, releaseObjectPrototype } from "./object-model.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { parseModule } from "../parse/parser.js";
import { templateObject } from "./template-objects.js";

it("keeps realm tables distinct while charging one shared step limit", () => {
  const root = new Budget({ maxSteps: 5 });
  const first = root.forkRealm(), second = root.forkRealm();
  const a = {}, b = {};
  registerBuiltinIdentities(first, { value: a });
  registerBuiltinIdentities(second, { value: b });
  expect(resolveIntrinsicIdentity(first, '["value"]')).toBe(a);
  expect(resolveIntrinsicIdentity(second, '["value"]')).toBe(b);
  first.visitNode(2);
  second.visitNode(3);
  expect(root.stepsUsed).toBe(5);
  expect(() => first.visitNode()).toThrow("steps");
  expect(second.stepsUsed).toBe(6);
  expect(first.limits).toBe(root.limits);
});

it("shares retained values, data charges and nested realm views", () => {
  const root = new Budget({ dataSize: 10 });
  const first = root.forkRealm(), nested = first.forkRealm();
  const owner = {};
  first.setRetainedValues(owner, () => ["retained"]);
  expect([...nested.retainedValues()]).toEqual(["retained"]);
  nested.setRetainedDataUsage(owner, 4);
  root.reconcileDataUsage(6);
  expect(first.currentDataSize).toBe(10);
  expect(() => nested.chargeDataUsage(1)).toThrow("dataSize");
  first.setRetainedDataUsage(owner, 0);
  expect(root.currentDataSize).toBe(6);
  expect(nested.peakDataSize).toBe(10);
});

it("shares call-depth enforcement across realms", () => {
  const root = new Budget({ maxCallDepth: 2 });
  const first = root.forkRealm(), second = root.forkRealm();
  const leaveFirst = first.enterCall(), leaveSecond = second.enterAwait();
  try {
    expect(() => root.enterCall()).toThrow("callDepth");
    expect(root.currentCallDepth).toBe(2);
  } finally { leaveSecond(); leaveFirst(); }
  expect(second.currentCallDepth).toBe(0);
  expect(root.peakCallDepth).toBe(2);
});

it("shares compilation ownership without admitting independent budgets", () => {
  const root = new Budget();
  const view = root.forkRealm();
  const outer = root.acquireCompileOwner();
  const inner = view.acquireCompileOwner(false, outer.owner);
  try {
    const ticket = view.createCompileTicket(outer.owner);
    view.resizeCompileTicket(ticket, 7);
    expect(root.compileTicketUsage(ticket)).toBe(7);
    expect(root.currentDataSize).toBe(7);
    expect(() => new Budget().acquireCompileOwner(false, outer.owner)).toThrow("already running");
    root.discardCompileTicket(ticket);
    expect(view.currentDataSize).toBe(0);
  } finally { inner.release(); outer.release(); }
  root.reset();
  expect(() => view.acquireCompileOwner(false, outer.owner)).toThrow("already running");
});

it("shares suspension and reset state rather than granting a fresh allowance", () => {
  const root = new Budget({ maxSteps: 1, deadline: 0 });
  const view = root.forkRealm();
  const resume = root.suspendChecks();
  view.visitNode(2048);
  resume();
  expect(() => view.visitNode()).toThrow("steps");
  root.reset();
  expect(view.stepsUsed).toBe(0);
  expect(view.deadline).toBe(root.deadline);
  expect(() => view.visitNode(1024)).toThrow("deadline");
});

it("installs independent builtin graphs with shared execution accounting", async () => {
  const root = new Budget({ arrayLength: 3 });
  const first = root.forkRealm(), second = root.forkRealm();
  try {
    const a = createBuiltinBindings({ budget: first });
    const b = createBuiltinBindings({ budget: second });
    expect(a.Number === b.Number).toBe(false);
    expect(materializeFunctionProperties(a.Number).prototype === materializeFunctionProperties(b.Number).prototype).toBe(false);
    expect(await invokeBuiltinClosure(a.Number, ["7"], first, undefined, undefined)).toBe(7);
    expect(await invokeBuiltinClosure(b.Number, ["9"], second, undefined, undefined)).toBe(9);
    await expect(invokeBuiltinClosure(b.Array, [4], second, undefined, undefined, true))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength", current: 4, limit: 3 });
    expect(first.stepsUsed).toBe(second.stepsUsed);
    releaseObjectPrototype(first);
    expect(resolveIntrinsicIdentity(second, '["Number"]') === b.Number).toBe(true);
  } finally { releaseObjectPrototype(first); releaseObjectPrototype(second); }
});

it("invalidates every realm's template cache when shared accounting resets", () => {
  const statement = parseModule('tag`x`').body[0];
  if (statement.type !== "ExpressionStatement" || statement.expression.type !== "TaggedTemplateExpression")
    throw new Error("Missing template site");
  const root = new Budget(), child = root.forkRealm(), nested = child.forkRealm();
  const views = [root, child, nested];
  const before = views.map(view => templateObject(statement.expression.quasi, view));
  expect(new Set(before).size).toBe(3);
  expect([...root.retainedValues()]).toHaveLength(3);
  child.reset();
  expect([...root.retainedValues()]).toEqual([]);
  for (let index = 0; index < views.length; index++)
    expect(templateObject(statement.expression.quasi, views[index]) === before[index]).toBe(false);
  root.reset();
});
