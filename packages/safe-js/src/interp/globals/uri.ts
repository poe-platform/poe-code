import type { Budget } from "../budget.js";
import { sandboxString } from "../string-coercion.js";
import { registerIntrinsicFunction } from "../object-model.js";
import { createSandboxClosure, type SandboxClosure } from "../values.js";

const conversions = { encodeURI, encodeURIComponent, decodeURI, decodeURIComponent };

export function createUriGlobals(budget: Budget): Record<keyof typeof conversions, SandboxClosure> {
  return Object.fromEntries(Object.entries(conversions).map(([name, conversion]) => {
    const closure = createSandboxClosure({
      sandbox: true,
      guest: true,
      name,
      length: 1,
      call: ([value], context) => {
        const convert = (text: string): string => {
          budget.visitNode(text.length);
          return budget.allocateString(conversion(text));
        };
        const text = sandboxString(value, budget, context);
        return typeof text === "string" ? convert(text) : text.then(convert);
      }
    });
    registerIntrinsicFunction(budget, closure);
    return [name, closure];
  })) as Record<keyof typeof conversions, SandboxClosure>;
}
