import { describe, expect, it } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { activeCancellation, awaitSandboxValue } from "./cancel.js";
import { createSandboxPromise } from "./values.js";

describe.each(["fulfilled", "rejected"] as const)("await %s settlement", status => {
  it.each([
    { value: "x".repeat(16), limits: { stringLength: 16 }, accepted: true },
    { value: "x".repeat(17), limits: { stringLength: 16 }, accepted: false },
    { value: [1, 2, 3, 4], limits: { arrayLength: 4 }, accepted: true },
    { value: [1, 2, 3, 4, 5], limits: { arrayLength: 4 }, accepted: false }
  ])("enforces allocation limits %j", async ({ value, limits, accepted }) => {
    const native = status === "fulfilled" ? Promise.resolve(value) : Promise.reject(value);
    const pending = createSandboxPromise(native, { trackReplay: false });
    const result = awaitSandboxValue(pending, undefined, new Budget(limits));
    if (!accepted) await expect(result).rejects.toMatchObject({ code: "budgetExceeded", budget: Object.keys(limits)[0] });
    else if (status === "fulfilled") await expect(result).resolves.toBe(value);
    else await expect(result).rejects.toBe(value);
  });
});

it.each(["budgetExceeded", "reentry", "aborted"] as const)("preserves an existing %s error with restrictive allocation limits", async code => {
  const error = code === "budgetExceeded" ? new SandboxError({ budget: "callDepth", current: 9, limit: 8 })
    : code === "reentry" ? new SandboxError("reentry") : new SandboxError("aborted");
  const pending = createSandboxPromise(Promise.reject(error), { trackReplay: false });
  await expect(awaitSandboxValue(pending, undefined, new Budget({ stringLength: 1 }))).rejects.toBe(error);
});

it.each([false, true])("preserves cancellation identity with restrictive limits, managed=%s", async managed => {
  const controller = new AbortController();
  const error = new Error("external cancellation");
  let release!: () => void;
  const native = new Promise<undefined>(resolve => { release = () => resolve(undefined); });
  const create = () => createSandboxPromise(native, { trackReplay: false });
  const pending = managed ? activeCancellation.run({ host: true, signal: controller.signal }, create) : create();
  const result = awaitSandboxValue(pending, controller.signal, new Budget({ stringLength: 1 }));
  try {
    controller.abort(error);
    await expect(result).rejects.toBe(error);
  } finally { release(); }
});
