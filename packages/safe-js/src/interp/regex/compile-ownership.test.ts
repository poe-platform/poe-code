import { describe, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { declareHostOperation } from "../host-bridge.js";
import { createSandboxRegex, isSandboxRegex } from "../values.js";
import { HostCallJournal } from "../host-call.js";
import { PromiseReplay, promiseReplayContext } from "../promise-replay.js";
import { encodeReplayData } from "../../snapshot/replay-data.js";

async function completedObjectReplay() {
  const provider = vi.fn(async () => {
    const regex = createSandboxRegex("a", "g", 2);
    return { first: regex, second: regex };
  });
  const resumeProvider = vi.fn();
  const bindings = { read: declareHostOperation(provider, "read-side-effect") };
  const source =
    "const value = await read(); return [value.first === value.second, value.first.source, value.first.lastIndex]";
  const freshBudget = new Budget();
  const fresh = await run(source, { budget: freshBudget, bindings });
  expect(fresh).toMatchObject({ ok: true, returnValue: [true, "a", 2] });
  expect(fresh.snapshot.replay?.calls).toHaveLength(1);
  expect(fresh.snapshot.replay?.calls[0]).toMatchObject({
    lifecycle: "consumed",
    outcome: { status: "fulfilled" }
  });
  const encoded = fresh.snapshot.replay?.calls[0].outcome?.data;
  expect(encoded?.nodes.some((node) => node.kind === "regex")).toBe(false);
  expect(encoded?.nodes.every((node) => node.kind === "object")).toBe(true);
  expect(provider).toHaveBeenCalledTimes(1);
  const snapshotBytes = JSON.stringify(fresh.snapshot);
  const replayBudget = new Budget();
  const replay = await run(source, {
    budget: replayBudget,
    bindings,
    snapshot: fresh.snapshot,
    hostCallResumeProvider: resumeProvider
  });
  expect(replay).toMatchObject({ ok: true, returnValue: [true, "a", 2] });
  expect(replay.snapshot.promiseReplay).toEqual(fresh.snapshot.promiseReplay);
  expect(replay.snapshot.replay).toEqual(fresh.snapshot.replay);
  expect(replay.snapshot.initialInputs).toEqual(fresh.snapshot.initialInputs);
  expect(JSON.stringify(fresh.snapshot)).toBe(snapshotBytes);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(resumeProvider).not.toHaveBeenCalled();
  return { freshBudget, replayBudget };
}

describe("compile preimage ownership", () => {
  it.each(["replace", "replaceAll"])(
    "CONTROL extracted %s keeps bound callback owner",
    async (method) => {
      await expect(
        run(`const replace = "a".${method}; return await replace("a", "x".toUpperCase);`)
      ).resolves.toMatchObject({ ok: true, returnValue: "X" });
    }
  );
  it.each(["replace", "replaceAll"])(
    "CONTROL direct %s keeps bound callback owner",
    async (method) => {
      await expect(run(`return await "a".${method}("a", "x".toUpperCase);`)).resolves.toMatchObject(
        { ok: true, returnValue: "X" }
      );
    }
  );
  it("CONTROL independent default nested run", async () => {
    await expect(
      run("return await nested()", {
        bindings: {
          nested: async () => {
            const result = await run("return 1");
            if (!result.ok) throw new Error(result.error.message);
            return result.returnValue;
          }
        }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 1 });
  });
  it("CONTROL sequential Budget reuse", async () => {
    const budget = new Budget();
    await expect(run("return 1", { budget })).resolves.toMatchObject({ returnValue: 1 });
    await expect(run("return 2", { budget })).resolves.toMatchObject({ returnValue: 2 });
  });
  it("RED independent overlapping Budget reuse", async () => {
    const budget = new Budget();
    await expect(
      run("return await nested()", {
        budget,
        bindings: {
          nested: async () => {
            const result = await run("return 1", { budget });
            if (!result.ok) throw new Error(result.error.message);
            return result.returnValue;
          }
        }
      })
    ).rejects.toMatchObject({ code: "reentry" });
  });
  it("RED reset during an active run", async () => {
    const budget = new Budget();
    await expect(
      run("reset(); return 1", {
        budget,
        bindings: { reset: () => budget.reset() }
      })
    ).rejects.toMatchObject({ code: "reentry" });
  });
  it("RED stale exported callback after sequential reuse", async () => {
    const budget = new Budget();
    let callback: (() => Promise<unknown>) | undefined;
    await run("capture(() => 1); return 1", {
      budget,
      bindings: {
        capture: (value: unknown) => {
          callback = value as () => Promise<unknown>;
        }
      }
    });
    expect(callback).toBeTypeOf("function");
    await expect(callback!()).resolves.toBe(1);
    await run("return 2", { budget });
    await expect(callback!()).rejects.toMatchObject({ code: "reentry" });
  });
  it("CONTROL completed ordinary-object journal graph and zero provider reissues", async () => {
    await completedObjectReplay();
  });
  it("RED genuine guest regex journal reconstruction charges 40 then 80 physical steps", async () => {
    const produced = await run("const regex = /a/g; regex.lastIndex = 2; return [regex, regex]");
    if (!produced.ok) throw new Error(produced.error.message);
    const graph = produced.returnValue;
    if (!Array.isArray(graph) || !isSandboxRegex(graph[0]))
      throw new Error("Missing guest regex graph");
    expect(graph).toHaveLength(2);
    expect(graph[0]).toBe(graph[1]);
    const captured = new HostCallJournal(produced.snapshot.sourceHash);
    const issued = captured.issue({
      moduleId: "<fixture>",
      operation: "guestRegex",
      argumentDigest: "empty-arguments",
      policy: "read-side-effect"
    });
    captured.start(issued.record);
    captured.settle(issued.record, { status: "fulfilled", value: graph });
    captured.consume(issued.record);
    const journal = captured.snapshotReplay();
    captured.dispose();
    expect(journal.calls).toHaveLength(1);
    expect(journal.calls[0]).toMatchObject({
      lifecycle: "consumed",
      outcome: { status: "fulfilled" }
    });
    const encoded = journal.calls[0].outcome?.data;
    if (encoded === undefined) throw new Error("Missing completed outcome graph");
    expect(encoded.root).toEqual({ tag: "ref", id: 0 });
    expect(encoded.nodes).toHaveLength(2);
    const root = encoded.nodes[0];
    if (root.kind !== "array") throw new Error("Missing aliased array root");
    expect(root.properties["0"].value).toEqual({ tag: "ref", id: 1 });
    expect(root.properties["1"].value).toEqual({ tag: "ref", id: 1 });
    expect(encoded.nodes[1]).toEqual({ kind: "regex", source: "a", flags: "g", lastIndex: 2 });
    const journalBytes = JSON.stringify(journal);
    const provider = vi.fn();
    const budget = new Budget({ maxSteps: 80 });
    const logical = new PromiseReplay();
    logical.attachBudget(budget);
    const logicalBefore = logical.snapshot();
    promiseReplayContext.run(logical, () => {
      const restored = new HostCallJournal(
        produced.snapshot.sourceHash,
        [],
        provider,
        journal,
        budget
      );
      try {
        expect(budget.stepsUsed).toBe(40);
        expect(logical.snapshot()).toEqual(logicalBefore);
        expect(restored.snapshotReplay()).toEqual(journal);
        const record = restored.snapshot()[0];
        const outcome = restored.replayOutcome(record);
        if (outcome?.status !== "fulfilled" || !Array.isArray(outcome.value))
          throw new Error("Missing replayed array");
        expect(isSandboxRegex(outcome.value[0])).toBe(true);
        expect(outcome.value[0]).toBe(outcome.value[1]);
        expect(encodeReplayData(outcome.value)).toEqual(encoded);
        expect(budget.stepsUsed).toBe(80);
        expect(logical.snapshot()).toEqual(logicalBefore);
        expect(restored.snapshotReplay()).toEqual(journal);
        expect(JSON.stringify(journal)).toBe(journalBytes);
        expect(provider).not.toHaveBeenCalled();
      } finally {
        restored.dispose();
      }
    });
  });
});
