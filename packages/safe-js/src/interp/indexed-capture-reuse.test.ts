import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues, type SandboxValue } from "./values.js";

function captured(...values: SandboxValue[]) {
  const closure = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(closure, append => {
    for (let index = 0; index < values.length; index++) append(values[index]!);
  });
  return closure;
}

it.each([false, true])("keeps parent captures and later siblings charged (held=%s)", held => {
  const payload = { data: "x".repeat(1000) };
  const child = captured("abc", "longer");
  const first = captured(child, "tail", payload);
  const second = captured("later", payload);
  expect(measureSandboxData([first, second])).toBe(1027);
  expect(measureSandboxData([first, second])).toBe(1027);
  payload.data += "grown";
  expect(measureSandboxData([first, second])).toBe(1032);
  const budget = new Budget({ dataSize: 1028 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [first, second])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("isolates nested measurements during collection with a parent capture pending", () => {
  const payload = { data: "x".repeat(1000) };
  const child = captured("abc", "longer");
  const inner = captured("inside", payload);
  const outer = createSandboxClosure({ call: () => undefined });
  let nested = -1;
  registerIndexedClosureCaptures(outer, append => {
    append(child);
    nested = measureSandboxData([inner]);
    append("tail");
    append(payload);
  });
  expect(measureSandboxData([outer])).toBe(1021);
  expect(nested).toBe(1013);
  expect(measureSandboxData([outer])).toBe(1021);
});

it("recovers after collection and descendant failures without changing subsequent charges", () => {
  const failure = new Error("capture failed");
  const payload = { data: "x".repeat(1000) };
  let throws = true;
  const child = createSandboxClosure({ call: () => undefined });
  registerIndexedClosureCaptures(child, append => {
    append(payload);
    if (throws) throw failure;
    append("abc");
  });
  const outer = captured(child, "tail", payload);
  expect(() => measureSandboxData([child])).toThrow(failure);
  expect(() => measureSandboxData([outer])).toThrow(failure);
  throws = false;
  expect(measureSandboxData([child])).toBe(1010);
  expect(measureSandboxData([outer])).toBe(1015);
});

it.each([64, 65])("keeps aliases and following captures charged after a %s-root capture", count => {
  const payload = { data: "x".repeat(1000) };
  const wide = captured(...Array.from({ length: count }, () => payload));
  const following = captured("done", "abc");
  const outer = captured(wide, following, payload);
  expect(measureSandboxData([outer])).toBe(1016);
  expect(measureSandboxData([outer])).toBe(1016);
});
