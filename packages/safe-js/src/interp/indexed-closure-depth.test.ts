import { expect, it } from "vitest";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";

const STRESS_DEPTH = 1_024;

function chain(length: number): SandboxValue {
  let value: SandboxValue = "leaf";
  for (let index = 0; index < length; index++) {
    const child = value;
    const closure = createSandboxClosure({ call: () => undefined });
    registerIndexedClosureCaptures(closure, (append) => append(child));
    value = closure;
  }
  return value;
}

it("measures indexed closure captures through the permitted data depth", () => {
  expect(measureSandboxData([chain(STRESS_DEPTH + 1)])).toBe(STRESS_DEPTH + 5);
});

it("measures deep indexed captures without a default depth ceiling", () => {
  expect(() => measureSandboxData([chain(STRESS_DEPTH + 2)])).not.toThrow();
});
