import type { Budget } from "./budget.js";
import { getSandboxPrototype, setSandboxPrototype } from "./object-model.js";
import type { SandboxValue } from "./values.js";

export function createIteratorResult(value: SandboxValue, done: boolean, budget?: Budget): { value: SandboxValue; done: boolean } {
  const result = { value, done };
  const prototype = getSandboxPrototype(result, budget);
  if (prototype !== null) setSandboxPrototype(result, prototype, budget);
  return result;
}
