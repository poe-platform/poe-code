import { generatorIterator } from "../iteration.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  createSandboxPromise,
  type SandboxGenerator,
  type SandboxValue
} from "../values.js";
import type { Budget } from "../budget.js";

const generatorMethodNames = new Set(["next", "return", "throw"] as const);
type GeneratorMethodName = "next" | "return" | "throw";

export function getGeneratorMember(
  target: SandboxGenerator,
  property: string | number,
  budget: Budget
): SandboxValue | undefined {
  if (typeof property !== "string" || !generatorMethodNames.has(property as GeneratorMethodName)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: property,
    call: ([value]) => {
      const iterator = generatorIterator(target, budget);
      const result = Promise.resolve(iterator[property as GeneratorMethodName]!(value)).then(result => allocateProducedSandboxValue(
        { value: result.value, done: result.done === true },
        budget
      ));
      return target.async ? createSandboxPromise(result) : result;
    }
  });
}
