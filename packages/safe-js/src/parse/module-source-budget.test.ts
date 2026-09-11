import { expect, it } from "vitest";
import { Budget, SandboxError } from "../interp/budget.js";
import { createModuleSource } from "./dynamic-source.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreRunSnapshot } from "../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { SnapshotValidationError } from "../snapshot/validation.js";

it.each(["run", "interpreter"].flatMap(kind => ["steps", "stringLength"].map(limit => ({ kind, limit }))))(
  "enforces $limit while restoring stored module source through $kind", async ({ kind, limit }) => {
    const source = "return 0";
    const value = await run("return Function('return 3')");
    if (!value.ok) throw new Error(value.error.message);
    const saved = kind === "run" ? JSON.parse(await dump(await run(source)))
      : JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
        scopeChain: [{ id: "module", bindings: { f: value.returnValue as RuntimeSnapshotValue } }],
        callStack: [], pendingPromises: [], moduleBindings: {} })));
    const id = 1 + Math.max(0, ...Object.keys(saved.heap).map(Number));
    saved.heap[id] = { kind: "guest-source", functionKind: "module", parameters: "",
      body: "return 3" };
    const invoke = () => {
      const budget = new Budget(limit === "steps" ? { maxSteps: 1000 } : { stringLength: 100 });
      const operation = budget.acquireCompileOwner();
      try {
        return kind === "run" ? restoreRunSnapshot(saved, { source }, operation.owner)
          : restore(saved, { source, budget }, operation.owner);
      } finally { operation.release(); }
    };
    expect(invoke).not.toThrow();
    saved.heap[id].body = `/*${"x".repeat(2000)}*/return 3`;
    let failure: unknown;
    try { invoke(); } catch (error) { failure = error; }
    if (kind === "interpreter" && limit === "stringLength") {
      expect(failure).toBeInstanceOf(SnapshotValidationError);
      expect(failure).toMatchObject({ code: "invalidValue", path: `$.heap["${id}"]`,
        message: expect.stringContaining("exceeds string limit 100") });
    } else {
      expect(failure).toBeInstanceOf(SandboxError);
      expect(failure).toMatchObject({ code: "budgetExceeded", budget: limit,
        limit: limit === "steps" ? 1000 : 100 });
    }
  }
);

it.each([`/*${"x".repeat(2000)}*/return 3`, `${";".repeat(2000)}return 3`])(
  "meters stored module compilation work", body => {
    const budget = new Budget({ maxSteps: 1000 });
    const operation = budget.acquireCompileOwner();
    try {
      expect(() => createModuleSource(body, operation.owner)).toThrow(SandboxError);
      expect(budget.stepsUsed).toBe(1001);
    } finally { operation.release(); }
  }
);

it("checks module source length before compilation work", () => {
  const budget = new Budget({ stringLength: 100 });
  const operation = budget.acquireCompileOwner();
  try {
    expect(() => createModuleSource(`/*${"x".repeat(200)}*/return 3`, operation.owner))
      .toThrow(SandboxError);
    expect(budget.stepsUsed).toBe(0);
  } finally { operation.release(); }
});

it("charges the accepted source once and permits owner-free compilation", () => {
  const body = "return 3";
  const budget = new Budget({ maxSteps: body.length });
  const operation = budget.acquireCompileOwner();
  try {
    expect(createModuleSource(body, operation.owner).node.body).toHaveLength(1);
    expect(budget.stepsUsed).toBe(body.length);
    expect(createModuleSource(body).node.body).toHaveLength(1);
  } finally { operation.release(); }
});
