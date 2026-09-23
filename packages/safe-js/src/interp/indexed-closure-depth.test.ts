import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";

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
  expect(measureSandboxData([chain(MAX_DATA_DEPTH + 1)])).toBe(MAX_DATA_DEPTH + 5);
});

it("reports dataDepth rather than native stack overflow for deep indexed captures", () => {
  expect(() => measureSandboxData([chain(MAX_DATA_DEPTH + 2)])).toThrowError(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
});
