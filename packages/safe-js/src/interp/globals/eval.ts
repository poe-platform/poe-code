import type { Budget } from "../budget.js";
import { registerIntrinsicFunction } from "../object-model.js";
import { createSandboxClosure } from "../values.js";

export function createEvalGlobal(budget: Budget) {
  const evaluate = createSandboxClosure({guest: true, sandbox: true, name: "eval", length: 1,
    call: ([value], context) => {
      if (typeof value !== "string") return value;
      if (context?.evaluateEval === undefined) throw new TypeError("Eval requires a guest execution context.");
      return context.evaluateEval(value);
    }
  });
  registerIntrinsicFunction(budget, evaluate);
  return evaluate;
}
