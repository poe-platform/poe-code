import { error, numericResult } from "../values.js";
import { asBoolean, bool, collect, scalarArg } from "./common.js";
import type { FunctionImplementation, SpecialForm } from "./types.js";

export const logicalFunctions: Readonly<Record<string, FunctionImplementation>> = {
  TRUE: () => bool(true), FALSE: () => bool(false),
  NOT: (args, host) => { const value = asBoolean(scalarArg(args, 0, host)); return value === undefined ? error("#VALUE!") : bool(!value); },
  IFERROR: (args, host) => { const first = scalarArg(args, 0, host); return first.kind === "error" ? scalarArg(args, 1, host) : first; },
  IFNA: (args, host) => { const first = scalarArg(args, 0, host); return first.kind === "error" && first.value === "#N/A" ? scalarArg(args, 1, host) : first; }
};
export const logicalSpecialForms: Readonly<Record<string, SpecialForm>> = {
  ...Object.fromEntries(["AND", "OR", "XOR"].map(name => [name, ((args, host) => {
    let count = 0, result = name === "AND";
    for (const arg of args) for (const value of collect(host.evaluate(arg), host)) {
      if (value.kind === "error") return value;
      if (value.kind !== "number" && value.kind !== "boolean") continue;
      const yes = asBoolean(value)!; count++;
      result = name === "AND" ? result && yes : name === "OR" ? result || yes : result !== yes;
    }
    return count ? bool(result) : error("#VALUE!");
  }) satisfies SpecialForm])),
  IFS: (args, host) => {
    for (let index = 0; index < args.length; index += 2) {
      const condition = host.scalar(host.evaluate(args[index]!));
      if (condition.kind === "error") return condition;
      if (condition.kind !== "boolean") return error("#VALUE!");
      if (condition.value) {
        if (index + 1 >= args.length) return error("#N/A");
        const value = host.scalar(host.evaluate(args[index + 1]!)); return value.kind === "blank" ? numericResult(0) : value;
      }
    }
    return error("#N/A");
  },
  SWITCH: (args, host) => {
    if (!args.length) return error("#VALUE!");
    const evaluatedFirst = host.scalar(host.evaluate(args[0]!));
    const first = evaluatedFirst.kind === "blank" ? numericResult(0) : evaluatedFirst;
    if (first.kind === "error") return first;
    let index = 1;
    for (; index + 1 < args.length; index += 2) {
      const evaluatedChoice = host.scalar(host.evaluate(args[index]!));
      const choice = evaluatedChoice.kind === "blank" ? numericResult(0) : evaluatedChoice;
      if (choice.kind === "error") return choice;
      if (choice.kind === first.kind && (choice.kind === "blank" || first.kind !== "blank" && choice.value === first.value)) {
        const value = host.scalar(host.evaluate(args[index + 1]!)); return value.kind === "blank" ? numericResult(0) : value;
      }
    }
    if (index >= args.length) return error("#N/A");
    const fallback = host.scalar(host.evaluate(args[index]!));
    return fallback.kind === "blank" ? numericResult(0) : fallback;
  }
};
