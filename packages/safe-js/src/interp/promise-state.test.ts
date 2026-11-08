import { expect, it } from "vitest";
import { createSandboxPromise, measureSandboxData } from "./values.js";
import { promiseStates } from "./promise-state.js";

it.each(["fulfilled", "rejected"] as const)("charges retained %s promise outcomes", async status => {
  const outcome = "x".repeat(200);
  const native = status === "fulfilled" ? Promise.resolve(outcome) : Promise.reject(outcome);
  const promise = createSandboxPromise(native);
  await native.catch(() => undefined);
  expect(promiseStates.get(promise)).toEqual({status, value: outcome});
  expect(measureSandboxData([promise])).toBeGreaterThanOrEqual(200);
});
