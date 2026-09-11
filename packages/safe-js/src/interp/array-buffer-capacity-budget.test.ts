import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { allocateProducedSandboxValue } from "./values.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { CompileScope } from "./regex/compile-guard.js";

it("rejects guest buffer capacity above the array-length budget", async () => {
  await expect(run("return new ArrayBuffer(8,{maxByteLength:512})", {
    budget: new Budget({ arrayLength: 128 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each(["binding", "operation"])("enforces buffer capacity for host %s imports", async route => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 512 }]) as ArrayBuffer;
  const budget = new Budget({ arrayLength: 128 });
  const result = route === "binding"
    ? run("return buffer.maxByteLength", { budget, bindings: { buffer } })
    : run("return (await make()).maxByteLength", { budget, bindings: { make: declareHostOperation(() => buffer, "re-issue") } });
  await expect(result).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it("enforces buffer capacity when restoring a snapshot", () => {
  const source = "return 0";
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 512 }]) as ArrayBuffer;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { buffer } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  expect(() => restore(saved, { source, budget: new Budget({ arrayLength: 128 }) }))
    .toThrow(expect.objectContaining({ code: "budgetExceeded" }));
});

it.each([false, true])("enforces capacity for produced values (view: %s)", view => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 512 }]) as ArrayBuffer;
  expect(() => allocateProducedSandboxValue(view ? new Float32Array(buffer) : buffer, new Budget({ arrayLength: 128 })))
    .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "arrayLength" }));
});

it("enforces capacity during budget-owned replay decoding", () => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 512 }]) as ArrayBuffer;
  const saved = encodeReplayData(buffer);
  const operation = new Budget({ arrayLength: 128 }).acquireCompileOwner();
  const parent = new CompileScope(operation.owner);
  try {
    expect(() => decodeReplayData(saved, {}, parent)).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "arrayLength" }));
  } finally { parent.dispose(); operation.release(); }
});

it.each([false, true])("rejects excessive host capacity before copying storage (view: %s)", async view => {
  const value = (await run(`const buffer=new ArrayBuffer(8,{maxByteLength:512});return ${view ? "new Float32Array(buffer)" : "buffer"}`)).returnValue;
  const construct = vi.spyOn(Reflect, "construct");
  try {
    await expect(run("return value", { bindings: { value }, budget: new Budget({ arrayLength: 128 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(construct.mock.calls.filter(([target]) => target === ArrayBuffer)).toHaveLength(0);
  } finally { construct.mockRestore(); }
});

it("preserves within-budget buffer and view aliases through imports and restore", async () => {
  const source = "return 0";
  const values = (await run("const buffer=new ArrayBuffer(8,{maxByteLength:128});const view=new Float32Array(buffer);view.set([1,2]);return [buffer,view]")).returnValue;
  expect(await run("return [values[0]===values[1].buffer,values[0].maxByteLength,Array.from(values[1])]", {
    bindings: { values }, budget: new Budget({ arrayLength: 128 })
  })).toMatchObject({ ok: true, returnValue: [true,128,[1,2]] });
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { values } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(saved, { source, budget: new Budget({ arrayLength: 128 }) }).currentScope.lookup("values");
  if (!restored.found || !Array.isArray(restored.value)) throw new Error("Missing restored values");
  expect((restored.value[1] as Float32Array).buffer).toBe(restored.value[0]);
  expect(Array.from(restored.value[1] as Float32Array)).toEqual([1,2]);
  const operation = new Budget({ arrayLength: 128 }).acquireCompileOwner();
  const parent = new CompileScope(operation.owner);
  try {
    const replay = decodeReplayData(encodeReplayData(values), {}, parent);
    if (!Array.isArray(replay)) throw new Error("Missing replay values");
    expect((replay[1] as Float32Array).buffer).toBe(replay[0]);
    expect(Array.from(replay[1] as Float32Array)).toEqual([1,2]);
  } finally { parent.dispose(); operation.release(); }
});
