import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

it("counts suspended callback locals together with a later source result", async () => {
  let finish!: () => void;
  const tail = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let callback: unknown;
  const budget = new Budget({ dataSize: 50000 });
  const realm = createRealm({
    callbackScheduling: "after-prefix",
    budget,
    bindings: {
      save: (value: unknown) => {
        callback = value;
      },
      wait: () => tail
    }
  });
  try {
    expect(
      await realm.evaluate(`save(async () => {
      const local = {text: "x".repeat(30000)};
      await wait(); return local;
    });`)
    ).toMatchObject({ ok: true });
    const invocation = realm.startCallback(callback);
    const outcome = invocation.result.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    await invocation.synchronous;
    expect(budget.currentDataSize).toBeGreaterThanOrEqual(30000);
    await expect(realm.evaluate('return "y".repeat(30000);')).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect(await outcome).toMatchObject({ rejected: true });
  } finally {
    finish();
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});
