import { expect, it, vi } from "vitest";
import { Budget, createRealm } from "./index.js";

it.each([undefined, "after-prefix"] as const)(
  "settles saved subclass aggregates through a live realm callback (%s)",
  async (callbackScheduling) => {
    const mark = vi.fn();
    const budget = new Budget();
    const realm = createRealm({ budget, bindings: { mark }, callbackScheduling });
    try {
      const saved = await realm.evaluate(`
        let constructions = 0;
        class P extends Promise {
          constructor(executor) {
            constructions++;
            super((resolve, reject) => executor(value => resolve(value), reason => reject(reason)));
          }
        }
        const c = Promise.withResolvers();
        const result = P.all([c.promise]);
        return async () => {
          const before = constructions;
          c.resolve(7);
          const answer = [await result, before, constructions];
          mark();
          return answer;
        };
      `);
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw saved.error;
      expect(await realm.invokeCallback(saved.returnValue)).toEqual([[7], 3, 4]);
      expect(mark).toHaveBeenCalledTimes(1);
      await realm.close();
      await expect(realm.invokeCallback(saved.returnValue)).rejects.toThrow();
      expect(mark).toHaveBeenCalledTimes(1);
      expect(budget.currentDataSize).toBe(0);
    } finally {
      await realm.close();
    }
  }
);

it.each([undefined, "after-prefix"] as const)(
  "cancels a saved aggregate callback awaiting settlement on close (%s)",
  async (callbackScheduling) => {
    const mark = vi.fn();
    const budget = new Budget();
    const realm = createRealm({ budget, bindings: { mark }, callbackScheduling });
    try {
      const saved = await realm.evaluate(`
        const c = Promise.withResolvers();
        const result = Promise.all([c.promise]);
        return [async () => { await result; mark(); }, c.resolve];
      `);
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw saved.error;
      const [wait, resolve] = saved.returnValue as unknown[];
      const invocation = realm.startCallback(wait);
      const outcome = invocation.result.catch((error: unknown) => error);
      await invocation.synchronous;
      await realm.close();
      expect(await outcome).toBeDefined();
      await expect(realm.invokeCallback(resolve, { args: [7] })).rejects.toThrow();
      expect(mark).not.toHaveBeenCalled();
      expect(budget.currentDataSize).toBe(0);
    } finally {
      await realm.close();
    }
  }
);
