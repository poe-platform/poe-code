import { setImmediate as turn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, declareHostOperation, dump, run } from "./index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe.each([false, true])("execution controls with extensions=%s", (extensions) => {
  it("holds guest continuations after a pending host operation settles", async () => {
    const entered = deferred<void>();
    const gate = deferred<number>();
    const mark = vi.fn();
    const task = run("const value = await wait(); mark(value); return value;", {
      ...(extensions ? { extensions: [] } : {}),
      bindings: {
        wait: () => {
          entered.resolve();
          return gate.promise;
        },
        mark
      }
    });
    try {
      await entered.promise;
      await task.pause();
      expect(task.executionState).toBe("paused");
      gate.resolve(7);
      await turn();
      await turn();
      expect(mark).not.toHaveBeenCalled();
      task.resume();
      expect(await task).toMatchObject({ ok: true, returnValue: 7 });
      expect(mark).toHaveBeenCalledExactlyOnceWith(7);
      expect(task.executionState).toBe("finished");
      await expect(task.pause()).rejects.toThrow("finished");
    } finally {
      gate.resolve(7);
      if (task.executionState === "paused") task.resume();
      await task.catch(() => undefined);
    }
  });

  it("allows a host turn to pause CPU-bound guest work", async () => {
    const budget = new Budget({ maxSteps: 100000 });
    const task = run("let n = 0; for (let i = 0; i < 2000; i++) n++; return n;", {
      budget,
      ...(extensions ? { extensions: [] } : {})
    });
    try {
      await turn();
      await task.pause();
      const stoppedAt = budget.stepsUsed;
      expect(stoppedAt).toBeGreaterThan(0);
      await turn();
      expect(budget.stepsUsed).toBe(stoppedAt);
      task.resume();
      expect(await task).toMatchObject({ ok: true, returnValue: 2000 });
      expect(budget.stepsUsed).toBeGreaterThan(stoppedAt);
    } finally {
      if (task.executionState === "paused") task.resume();
      await task.catch(() => undefined);
    }
  });

  it("cancels a paused run without allowing a later guest effect", async () => {
    const controller = new AbortController();
    const entered = deferred<void>();
    const gate = deferred<void>();
    const mark = vi.fn();
    const reason = new Error("parent cancelled child");
    const task = run("await wait(); mark();", {
      signal: controller.signal,
      ...(extensions ? { extensions: [] } : {}),
      bindings: {
        wait: () => {
          entered.resolve();
          return gate.promise;
        },
        mark
      }
    });
    const outcome = task.catch((error: unknown) => error);
    try {
      await entered.promise;
      await task.pause();
      controller.abort(reason);
      expect(await outcome).toMatchObject({ name: "Error", message: reason.message });
      expect(mark).not.toHaveBeenCalled();
      expect(task.executionState).toBe("finished");
    } finally {
      controller.abort(reason);
      gate.resolve();
      await outcome;
    }
  });

  it("preserves an async function's synchronous prefix across a CPU pause", async () => {
    const order: string[] = [];
    const task = run(
      "async function child() { for (let i = 0; i < 2000; i++) {} mark('child'); } const pending = child(); mark('parent'); await pending;",
      {
        ...(extensions ? { extensions: [] } : {}),
        bindings: {
          mark: (value: string) => {
            order.push(value);
          }
        }
      }
    );
    try {
      await turn();
      await task.pause();
      expect(order).toEqual([]);
      await turn();
      expect(order).toEqual([]);
      task.resume();
      await task;
      expect(order).toEqual(["child", "parent"]);
    } finally {
      if (task.executionState === "paused") task.resume();
      await task.catch(() => undefined);
    }
  });
});

it("hands a checkpoint to a replacement only after stopping the paused original", async () => {
  const entered = deferred<void>();
  const gate = deferred<string>();
  const controller = new AbortController();
  const charge = vi.fn(() => {
    entered.resolve();
    return gate.promise;
  });
  const receipt = vi.fn();
  const source =
    'import { charge, receipt } from "work"; const value = await charge(); receipt(value); return value;';
  const task = run(source, {
    signal: controller.signal,
    modules: {
      work: {
        charge: declareHostOperation(charge, "read-side-effect"),
        receipt: declareHostOperation(receipt, "read-side-effect")
      }
    }
  });
  const outcome = task.catch((error: unknown) => error);
  try {
    await entered.promise;
    await task.pause();
    gate.resolve("confirmed");
    await turn();
    expect(receipt).not.toHaveBeenCalled();
    const snapshot = JSON.parse(await dump(task));
    controller.abort(new Error("handoff"));
    expect(await outcome).toMatchObject({ name: "Error", message: "handoff" });
    expect(() => task.resume()).toThrow("finished");
    expect(receipt).not.toHaveBeenCalled();
    const duplicate = vi.fn(() => {
      throw new Error("must not repeat the charge");
    });
    const replacement = await run(source, {
      snapshot,
      modules: {
        work: {
          charge: declareHostOperation(duplicate, "read-side-effect"),
          receipt: declareHostOperation(receipt, "read-side-effect")
        }
      }
    });
    expect(replacement).toMatchObject({ ok: true, returnValue: "confirmed" });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(receipt).toHaveBeenCalledExactlyOnceWith("confirmed");
  } finally {
    gate.resolve("confirmed");
    controller.abort(new Error("test cleanup"));
    await outcome;
  }
});

it("lets a parent pause and resume successive children independently", async () => {
  const events: string[] = [];
  let childNumber = 0;
  const parent = await run("return [await child(), await child()];", {
    bindings: {
      child: async () => {
        const number = ++childNumber;
        const budget = new Budget({ maxSteps: 100000 });
        const task = run("let n = 0; for (let i = 0; i < 2000; i++) n++; return n;", { budget });
        try {
          await turn();
          await task.pause();
          const stoppedAt = budget.stepsUsed;
          events.push(`parent owns paused child ${number}`);
          await turn();
          expect(budget.stepsUsed).toBe(stoppedAt);
          task.resume();
          const result = await task;
          events.push(`child ${number} finished`);
          if (!result.ok) throw new Error(result.error.message);
          return result.returnValue;
        } finally {
          if (task.executionState === "paused") task.resume();
          await task.catch(() => undefined);
        }
      }
    }
  });
  expect(parent).toMatchObject({ ok: true, returnValue: [2000, 2000] });
  expect(events).toEqual([
    "parent owns paused child 1",
    "child 1 finished",
    "parent owns paused child 2",
    "child 2 finished"
  ]);
});

it("dumps a paused live run without waiting for another guest yield", async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const task = run("await wait(); return 9;", {
    bindings: {
      wait: () => {
        entered.resolve();
        return gate.promise;
      }
    }
  });
  try {
    await entered.promise;
    await task.pause();
    const snapshot = JSON.parse(await dump(task));
    expect(snapshot.sourceHash).toEqual(expect.any(String));
    expect(snapshot.hostCalls).toHaveLength(1);
    expect(task.executionState).toBe("paused");
  } finally {
    gate.resolve();
    if (task.executionState === "paused") task.resume();
    await task;
  }
});

it("closes a paused persistent realm and revokes further execution", async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const mark = vi.fn();
  const realm = createRealm({
    bindings: {
      wait: () => {
        entered.resolve();
        return gate.promise;
      },
      mark
    }
  });
  const task = realm.evaluate("await wait(); mark();").catch((error: unknown) => error);
  try {
    await entered.promise;
    await realm.pause();
    await realm.close();
    expect(await task).toMatchObject({ name: "Error", message: "SafeJS realm is closed." });
    expect(mark).not.toHaveBeenCalled();
    expect(realm.executionState).toBe("finished");
    await expect(realm.evaluate("return 1;")).rejects.toThrow();
  } finally {
    gate.resolve();
    await realm.close();
  }
});
