import {expect, it} from "vitest";
import {detectSourceEncoding} from "./source-encoding.js";
import {ExecutionBudget, ExecutionLimitError} from "./runtime/execution-budget.js";

it.each((["cancelled", "steps", "allocation"] as const).flatMap(reason =>
  ["entry", "header"].map(stage => ({reason, stage}))
))("preserves source cookie $reason termination at $stage without another checkpoint", ({reason, stage}) => {
  const controller = new AbortController();
  const budget = new ExecutionBudget({
    maxSteps: reason === "steps" ? (stage === "entry" ? 0 : 5) : 1000,
    maxAllocatedBytes: reason === "allocation" ? (stage === "entry" ? 0 : 64) : 10000,
    signal: controller.signal
  });
  let terminal: unknown;
  let calls = 0;
  let terminalCall = 0;
  const meter = {
    checkpoint(steps = 1, allocatedBytes = 0) {
      calls++;
      if (terminal !== undefined) throw new Error("checkpoint after termination");
      if (reason === "cancelled" && calls === (stage === "entry" ? 1 : 5)) controller.abort();
      try {budget.checkpoint(steps, allocatedBytes);}
      catch (error) {terminal = error; terminalCall = calls; throw error;}
    }
  };
  let failure: unknown;
  try {detectSourceEncoding(new TextEncoder().encode("# coding: latin_1\n"), {meter});}
  catch (error) {failure = error;}
  expect(terminal).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toBe(terminal);
  expect(calls).toBe(terminalCall);
  if (stage === "header") expect(calls).toBeGreaterThan(1);
  expect(() => budget.checkpoint()).toThrow(terminal as ExecutionLimitError);
});

it("observes cancellation while propagating a source BOM conflict", () => {
  const controller = new AbortController();
  const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal});
  const options = {
    meter: budget,
    get filename() {controller.abort(); return "source.py";}
  };
  expect(() => detectSourceEncoding(new TextEncoder().encode("\ufeff# coding: ascii"), options))
    .toThrow("execution cancelled");
  expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
});
