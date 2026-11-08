import { describe, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { parseModule } from "../../parse/parser.js";
import { decodeReplayData, encodeReplayData } from "../../snapshot/replay-data.js";
import { Budget, SandboxError } from "../budget.js";
import { interpret } from "../interpreter.js";
import { PromiseReplay, promiseReplayContext } from "../promise-replay.js";
import { HostCallJournal } from "../host-call.js";
import { createConsoleJsonGlobals } from "../globals/console-json.js";
import { restore as restoreInterpreterSnapshot } from "../../snapshot/restore.js";
import { serialize } from "../../snapshot/serialize.js";
import { SnapshotValidationError } from "../../snapshot/validation.js";
import { createSandboxRegex, isSandboxClosure, reconcileCompiledValues } from "../values.js";
import { CompileScope } from "./compile-guard.js";

describe("compile ownership drafts", () => {
  it("does not lose the originating generation when a journal is disposed", () => {
    const original = new HostCallJournal("source");
    const issued = original.issue({
      moduleId: "host",
      operation: "read",
      argumentDigest: "args",
      policy: "read-side-effect"
    });
    original.settle(issued.record, { status: "fulfilled", value: createSandboxRegex("a") });
    const budget = new Budget();
    const restored = new HostCallJournal(
      "source",
      [],
      undefined,
      original.snapshotReplay(),
      budget
    );
    const record = restored.snapshot()[0];
    restored.dispose();
    budget.reset();
    expect(() => restored.replayOutcome(record)).toThrow(SandboxError);
  });
  it("charges physical compile work without advancing logical replay steps", () => {
    const budget = new Budget();
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    const replay = new PromiseReplay();
    replay.attachBudget(budget);
    const before = replay.snapshot();
    try {
      promiseReplayContext.run(replay, () => createSandboxRegex("a", "", 0, compilation));
      expect(budget.stepsUsed).toBeGreaterThan(0);
      expect(replay.snapshot()).toEqual(before);
    } finally {
      compilation.dispose();
      operation.release();
    }
  });

  it("preserves logical replay with enough work budget, not equal tight budgets", async () => {
    const source = "return /a/.source";
    const freshBudget = new Budget();
    const fresh = await run(source, { budget: freshBudget });
    const restoredBudget = new Budget();
    const restored = await run(source, { budget: restoredBudget, snapshot: fresh.snapshot });
    expect(restored).toMatchObject({ ok: true, returnValue: "a" });
    expect(restored.snapshot.promiseReplay?.steps).toBe(fresh.snapshot.promiseReplay?.steps);
    expect(restoredBudget.stepsUsed).toBeGreaterThan(freshBudget.stepsUsed);
    await expect(
      run(source, {
        budget: new Budget({ maxSteps: freshBudget.stepsUsed }),
        snapshot: fresh.snapshot
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("rejects snapshot metadata at the caller string limit before reconstruction", () => {
    const source = "await task()";
    const statement = parseModule(source).body[0];
    const snapshot = serialize({
      source,
      currentAstNodeId: statement.nodeId!,
      scopeChain: [{ id: "module", bindings: { regex: createSandboxRegex("abc") } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const budget = new Budget({ stringLength: 2 });
    let failure: unknown;
    try {
      restoreInterpreterSnapshot(snapshot, { source, budget });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SnapshotValidationError);
    expect(failure).toMatchObject({
      code: "budgetExceeded",
      path: "$.sourceHash",
      message: "Invalid snapshot at $.sourceHash: exceeds string limit 2"
    });
    expect(budget.currentDataSize).toBe(0);
    const restored = restoreInterpreterSnapshot(snapshot, { source });
    expect(restored.currentScope.lookup("regex")).toMatchObject({
      found: true,
      value: { source: "abc" }
    });
  });

  it("accounts for standalone console native copies without matching", async () => {
    const budget = new Budget({ stringLength: 2 });
    const sink = { log: vi.fn(), error: vi.fn() };
    const globals = createConsoleJsonGlobals({ budget, sink });
    const log = globals.console.log;
    if (!isSandboxClosure(log)) throw new Error("Missing console.log");
    await expect(log.call([createSandboxRegex("abc")])).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "stringLength"
    });
    expect(sink.log).not.toHaveBeenCalled();
    expect(budget.currentDataSize).toBe(0);
  });

  it("enforces constructor and embedded unevaluated literal limits", async () => {
    for (const source of [
      "return RegExp('abcd')",
      "return new RegExp('abcd')",
      "if (false) { `${/abcd/}`; } return 1"
    ]) {
      await expect(run(source, { budget: new Budget({ stringLength: 3 }) })).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength",
        current: 4,
        limit: 3
      });
    }
  });

  it("allows default nested runs but refuses independent overlapping Budget reuse", async () => {
    await expect(
      run("return (await nested()).returnValue", {
        bindings: { nested: () => run("return /a/.source") }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: "a" });
    const budget = new Budget();
    await expect(
      run("return await nested()", {
        budget,
        bindings: { nested: () => run("return /a/", { budget }) }
      })
    ).rejects.toMatchObject({ code: "reentry" });
  });

  it("keeps sequential Budget reuse and refuses a stale exported callback", async () => {
    const budget = new Budget();
    let callback: (() => Promise<unknown>) | undefined;
    await run("capture(() => /a/); return 1", {
      budget,
      bindings: {
        capture: (value: unknown) => {
          callback = value as () => Promise<unknown>;
        }
      }
    });
    expect(callback).toBeTypeOf("function");
    await expect(callback!()).resolves.toBeInstanceOf(RegExp);
    await expect(run("return /b/.source", { budget })).resolves.toMatchObject({ returnValue: "b" });
    await expect(callback!()).rejects.toMatchObject({ code: "reentry" });
  });

  it("does not reset an explicitly supplied standalone interpreter Budget", async () => {
    const budget = new Budget();
    budget.visitNode();
    const ast = parseModule("return /a/.source").body[0];
    if (ast.type !== "ReturnStatement") throw new Error("Missing return statement");
    await expect(interpret(ast, { budget })).resolves.toMatchObject({ returnValue: "a" });
    const steps = budget.stepsUsed;
    await interpret(ast, { budget });
    expect(budget.stepsUsed).toBeGreaterThan(steps);
  });

  it("recompiles replay values with alias and cursor preservation", () => {
    const regex = createSandboxRegex("(a)", "g", 2);
    const encoded = encodeReplayData([regex, regex]);
    const budget = new Budget();
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      const restored = decodeReplayData(encoded, {}, compilation) as unknown[];
      expect(restored[0]).toBe(restored[1]);
      expect(restored[0]).toMatchObject({ source: "(a)", flags: "g", lastIndex: 2 });
      expect(budget.stepsUsed).toBeGreaterThan(0);
      const staged = budget.currentDataSize;
      reconcileCompiledValues(budget, restored, compilation);
      expect(budget.currentDataSize).toBe(staged);
    } finally {
      compilation.dispose();
      operation.release();
    }
    const bounded = new Budget({ stringLength: 2 });
    const limitedOperation = bounded.acquireCompileOwner();
    const limitedScope = new CompileScope(limitedOperation.owner);
    try {
      expect(() => decodeReplayData(encoded, {}, limitedScope)).toThrow(SandboxError);
    } finally {
      limitedScope.dispose();
      limitedOperation.release();
    }
    expect(bounded.currentDataSize).toBe(0);
  });
});
