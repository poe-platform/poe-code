import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues} from "./runtime-values.js";

it("bounds retained character-map adapters before mapping begins", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 4096});
  const values = new RuntimeValues(meter);
  const retained: RuntimeCharmap[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 1000; index++) retained.push(new RuntimeCharmap(values, meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(1000);
  let retry: unknown;
  try {new RuntimeCharmap(values, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(["cancelled", "steps"] as const)("does not publish character-map adapters after %s termination", reason => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  let failure: unknown;
  if (reason === "cancelled") controller.abort();
  else {
    try {meter.checkpoint(100001);} catch (error) {failure = error;}
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let caught: unknown;
    try {new RuntimeCharmap(values, meter);} catch (error) {caught = error;}
    expect(caught).toBeInstanceOf(ExecutionLimitError);
    expect(caught).toMatchObject({reason});
    if (failure === undefined) failure = caught;
    else expect(caught).toBe(failure);
  }
});
