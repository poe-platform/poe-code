import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxClosure } from "../values.js";

export function createNumericParsers(budget: Budget) {
  return {
    parseInt: createSandboxClosure({
      sandbox: true,
      name: "parseInt",
      call: ([value, radix], context) => {
        const parse = (text: string): number | Promise<number> => {
          const release = retainValues(budget, () => [text]);
          let convertedRadix: number | Promise<number>;
          try {
            convertedRadix = sandboxNumber(radix, budget, context);
          } catch (error) {
            release();
            throw error;
          }
          if (typeof convertedRadix === "number") {
            try {
              return globalThis.parseInt(text, convertedRadix);
            } finally {
              release();
            }
          }
          return convertedRadix
            .then((number) => globalThis.parseInt(text, number))
            .finally(release);
        };
        const text = sandboxString(value, budget, context);
        return typeof text === "string" ? parse(text) : text.then(parse);
      }
    }),
    parseFloat: createSandboxClosure({
      sandbox: true,
      name: "parseFloat",
      call: ([value], context) => {
        const text = sandboxString(value, budget, context);
        return typeof text === "string"
          ? globalThis.parseFloat(text)
          : text.then(globalThis.parseFloat);
      }
    })
  };
}
