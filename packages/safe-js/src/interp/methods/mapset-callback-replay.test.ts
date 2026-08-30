import { describe, expect, it, vi } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run, type RunSnapshot } from "../../run.js";
import { Budget } from "../budget.js";
import { declareHostOperation } from "../host-bridge.js";

describe.each(["Map", "Set"])("%s callback mutation replay", (kind) => {
  it("recovers a finite worklist from a budget checkpoint without repeating effects", async () => {
    const source = `
      const work = ${kind === "Map" ? "new Map([[0, 0]])" : "new Set([0])"};
      const visits = [];
      work.forEach(function(value, key) {
        visits.push([key, value, effect(key)]);
        if (key < 5) ${kind === "Map" ? "work.set(key + 1, key + 1)" : "work.add(key + 1)"};
      });
      return { visits, entries: [...work] };
    `;
    const expected = Function("effect", '"use strict";\n' + source)((key: number) => key * 10);
    const effect = vi.fn((key: number) => key * 10);
    const execution = run(source, { bindings: { effect }, budget: new Budget({ maxSteps: 120 }) });
    await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(effect.mock.calls.length).toBeGreaterThan(0);
    expect(effect.mock.calls.length).toBeLessThan(6);
    const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
      source
    });
    const callsBefore = effect.mock.calls.length;
    await expect(
      run(source, {
        snapshot,
        bindings: { effect },
        budget: new Budget({ maxSteps: 120 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(effect).toHaveBeenCalledTimes(callsBefore);
    const recovered = await run(source, {
      snapshot,
      bindings: { effect },
      budget: new Budget({ maxSteps: 3000 })
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(structuredClone(recovered.returnValue)).toStrictEqual(expected);
    expect(effect.mock.calls).toEqual([[0], [1], [2], [3], [4], [5]]);
    const freshEffect = vi.fn(() => -1);
    const replayed = await run(source, {
      snapshot: restore(JSON.parse(await dump(recovered)), { source }),
      bindings: { effect: freshEffect }
    });
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(structuredClone(replayed.returnValue)).toStrictEqual(expected);
    expect(freshEffect).not.toHaveBeenCalled();
  });

  it("preserves genuine pending boundaries and does not await callback return values", async () => {
    const source = `
      const initial = await start();
      const work = ${kind === "Map" ? 'new Map([["a", 1], ["b", 2], ["c", 3]])' : 'new Set(["a", "b", "c"])'};
      const visits = [];
      const tasks = [];
      const returned = work.forEach(function(value, key) {
        visits.push([key, value]);
        if (key === "a") {
          work.delete("b");
          ${kind === "Map" ? 'work.set("d", 4)' : 'work.add("d")'};
        }
        const task = (async function() {
          const answer = await pause(key);
          work.delete(key);
          ${kind === "Map" ? 'work.set("late", 99)' : 'work.add("late")'};
          return [key, answer];
        })();
        tasks.push(task);
        return task;
      });
      const beforeAwait = visits.slice();
      const answers = await Promise.all(tasks);
      return { initial, returned, visits, beforeAwait, answers, entries: [...work] };
    `;
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    const nativeGate = deferred<number>();
    const nativeReached = deferred<void>();
    const nativePause = vi.fn(() => {
      if (nativePause.mock.calls.length === 3) nativeReached.resolve();
      return nativeGate.promise;
    });
    const nativeExecution = new AsyncFunction("start", "pause", source)(async () => 7, nativePause);
    await nativeReached.promise;
    nativeGate.resolve(11);
    const expected = await nativeExecution;

    const gate = deferred<number>();
    const reached = deferred<void>();
    const start = vi.fn(async () => 7);
    const pause = vi.fn(() => {
      if (pause.mock.calls.length === 3) reached.resolve();
      return gate.promise;
    });
    let completed = false;
    const execution = run(source, {
      bindings: {
        start: declareHostOperation(start, "re-issue"),
        pause: declareHostOperation(pause, "re-issue")
      }
    });
    void execution.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      }
    );
    let saved: string;
    try {
      await reached.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(completed).toBe(false);
      saved = await dump(execution, { mode: "replay" });
      expect(completed).toBe(false);
      expect(pause.mock.calls).toEqual([["a"], ["c"], ["d"]]);
      const pending: RunSnapshot = restore(JSON.parse(saved), { source });
      expect(pending.hostCalls?.filter((call) => call.lifecycle === "running")).toHaveLength(3);
    } finally {
      gate.resolve(11);
    }
    const original = await execution;
    expect(original.ok).toBe(true);
    if (original.ok) expect(structuredClone(original.returnValue)).toStrictEqual(expected);
    expect(start).toHaveBeenCalledOnce();

    const resumedStart = vi.fn(async () => -1);
    const resumedPause = vi.fn(async () => 11);
    const bindings = {
      start: declareHostOperation(resumedStart, "re-issue"),
      pause: declareHostOperation(resumedPause, "re-issue")
    };
    const resumed = await run(source, {
      snapshot: restore(JSON.parse(saved!), { source }),
      bindings
    });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(structuredClone(resumed.returnValue)).toStrictEqual(expected);
    expect(resumedStart).not.toHaveBeenCalled();
    expect(resumedPause.mock.calls).toEqual([["a"], ["c"], ["d"]]);
    resumedPause.mockClear();
    for (const snapshot of [
      resumed.snapshot,
      restore(JSON.parse(await dump(resumed)), { source })
    ]) {
      const replayed = await run(source, { snapshot, bindings });
      expect(replayed.ok).toBe(true);
      if (replayed.ok) expect(structuredClone(replayed.returnValue)).toStrictEqual(expected);
      expect(resumedPause).not.toHaveBeenCalled();
      expect(resumedStart).not.toHaveBeenCalled();
    }
  });
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
