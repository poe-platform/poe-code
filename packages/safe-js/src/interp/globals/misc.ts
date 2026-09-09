import type { Budget } from "../budget.js";
import { createNumericParsers } from "./numeric-parsers.js";
import { sandboxNumber } from "../string-coercion.js";
import { createStructuredCloneGlobal } from "./structured-clone.js";
import {
  createSandboxClosure,
  type SandboxClosure
} from "../values.js";

export type MiscGlobals = {
  structuredClone: SandboxClosure;
  parseInt: SandboxClosure;
  parseFloat: SandboxClosure;
  isNaN: SandboxClosure;
  isFinite: SandboxClosure;
};

export function createMiscGlobals(options: {
  budget: Budget;
  numericParsers?: ReturnType<typeof createNumericParsers>;
}): MiscGlobals {
  return {
    structuredClone: createStructuredCloneGlobal(options.budget),
    ...(options.numericParsers ?? createNumericParsers(options.budget)),
    isNaN: createSandboxClosure({
      sandbox: true,
      call: ([value], context) => {
        const number = sandboxNumber(value, options.budget, context);
        return typeof number === "number" ? Number.isNaN(number) : number.then(Number.isNaN);
      },
      name: "isNaN"
    }),
    isFinite: createSandboxClosure({
      sandbox: true,
      call: ([value], context) => {
        const number = sandboxNumber(value, options.budget, context);
        return typeof number === "number" ? Number.isFinite(number) : number.then(Number.isFinite);
      },
      name: "isFinite"
    })
  };
}
