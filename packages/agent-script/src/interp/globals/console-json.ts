import type { Budget } from "../budget.js";
import { createSandboxClosure, deepCopyFromSandbox, type SandboxObject, type SandboxValue } from "../values.js";

export type ConsoleSink = {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

export type ConsoleJsonGlobalsOptions = {
  budget: Budget;
  sink?: ConsoleSink;
};

export function createConsoleJsonGlobals(options: ConsoleJsonGlobalsOptions): Record<"JSON" | "console", SandboxObject> {
  const sink = options.sink ?? console;

  return {
    JSON: {
      parse: createSandboxClosure({
        call: async ([text]) => parseJson(text, options.budget),
        name: "parse"
      }),
      stringify: createSandboxClosure({
        call: async ([value, replacer, indent]) => stringifyJson(value, replacer, indent, options.budget),
        name: "stringify"
      })
    },
    console: {
      error: createSandboxClosure({
        call: async (args) => {
          sink.error(...args.map((value) => deepCopyFromSandbox(value)));
          return undefined;
        },
        name: "error"
      }),
      log: createSandboxClosure({
        call: async (args) => {
          sink.log(...args.map((value) => deepCopyFromSandbox(value)));
          return undefined;
        },
        name: "log"
      })
    }
  };
}

function parseJson(input: SandboxValue, budget: Budget): SandboxValue {
  if (typeof input !== "string") {
    throw new TypeError("JSON.parse(text) requires a string.");
  }

  budget.allocateString(input);

  return copyJsonToSandbox(JSON.parse(input), budget);
}

function stringifyJson(
  value: SandboxValue,
  replacer: SandboxValue,
  indent: SandboxValue,
  budget: Budget
): SandboxValue {
  if (replacer !== undefined && replacer !== null) {
    throw new TypeError("JSON.stringify(value, replacer, indent) only supports null or undefined replacers.");
  }

  if (indent !== undefined && typeof indent !== "number" && typeof indent !== "string") {
    throw new TypeError("JSON.stringify(value, replacer, indent) requires indent to be a string, number, or undefined.");
  }

  const output = JSON.stringify(deepCopyFromSandbox(value), undefined, indent as number | string | undefined);
  if (output === undefined) {
    return undefined;
  }

  return budget.allocateString(output);
}

function copyJsonToSandbox(value: unknown, budget: Budget): SandboxValue {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return budget.allocateString(value);
  }

  if (Array.isArray(value)) {
    budget.allocateArrayLength(value.length);
    return value.map((entry) => copyJsonToSandbox(entry, budget));
  }

  if (isPlainObject(value)) {
    const copy: SandboxObject = {};

    for (const [key, entry] of Object.entries(value)) {
      defineDataProperty(copy, key, copyJsonToSandbox(entry, budget));
    }

    return copy;
  }

  throw new TypeError("JSON.parse(text) produced an unsupported value.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defineDataProperty(target: SandboxObject, key: string, value: SandboxValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
