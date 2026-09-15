import {expect, it} from "vitest";
import {normalizeNfkcPoints} from "./normalization.js";
import {unicode32Normalization} from "./normalization-unicode32-data.js";
import {ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["cancelled", "steps", "allocation"] as const)("retains fatal %s without calling the normalization meter again", reason => {
  const cancelled = new ExecutionLimitError(reason);
  const cleanupFailure = new Error("meter called after cancellation");
  let calls = 0;
  let failure: unknown;
  try {
    normalizeNfkcPoints([65, 0x30a], unicode32Normalization, {
      checkpoint() {
        if (++calls === 2) throw cancelled;
        if (calls > 2) throw cleanupFailure;
      },
    });
  } catch (error) { failure = error; }
  expect(failure).toBe(cancelled);
  expect(calls).toBe(2);
});
