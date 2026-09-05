import type { Budget, CompileOwner } from "../budget.js";
import { dateMethods, isSandboxDate } from "../date.js";
import { boxedValue, isSandboxBox } from "../boxed.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { CompileScope } from "../regex/compile-guard.js";
import type { HostCallJournal } from "../host-call.js";
import { wrapCallerInjectedBindings } from "../host-bridge.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  deepCopyFromSandbox,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "../values.js";

export type ConsoleSink = {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

export type ConsoleJsonGlobalsOptions = {
  budget: Budget;
  compileOwner?: CompileOwner;
  sink?: ConsoleSink;
  hostCalls?: HostCallJournal;
};

export function createConsoleJsonGlobals(
  options: ConsoleJsonGlobalsOptions
): Record<"JSON" | "console", SandboxObject> {
  const sink = options.sink ?? console;

  return {
    JSON: {
      parse: createSandboxClosure({
        sandbox: true,
        call: async ([text]) => parseJson(text, options.budget),
        name: "parse"
      }),
      stringify: createSandboxClosure({
        sandbox: true,
        call: async ([value, replacer, indent], context) =>
          stringifyJson(value, replacer, indent, options.budget, context),
        name: "stringify"
      })
    },
    console:
      options.hostCalls === undefined
        ? {
            error: createSandboxClosure({
              sandbox: true,
              call: async (args, context) => {
                const operation = options.budget.acquireCompileOwner(
                  false,
                  options.compileOwner ?? context?.compilation?.owner
                );
                const compilation = new CompileScope(operation.owner);
                try {
                  sink.error(...args.map((value) => deepCopyFromSandbox(value, { compilation })));
                  return undefined;
                } finally {
                  compilation.dispose();
                  operation.release();
                }
              },
              name: "error"
            }),
            log: createSandboxClosure({
              sandbox: true,
              call: async (args, context) => {
                const operation = options.budget.acquireCompileOwner(
                  false,
                  options.compileOwner ?? context?.compilation?.owner
                );
                const compilation = new CompileScope(operation.owner);
                try {
                  sink.log(...args.map((value) => deepCopyFromSandbox(value, { compilation })));
                  return undefined;
                } finally {
                  compilation.dispose();
                  operation.release();
                }
              },
              name: "log"
            })
          }
        : wrapCallerInjectedBindings(
            {
              error: (...args: unknown[]) => {
                sink.error(...args);
                return undefined;
              },
              log: (...args: unknown[]) => {
                sink.log(...args);
                return undefined;
              }
            },
            {
              budget: options.budget,
              compileOwner: options.compileOwner,
              hostCalls: options.hostCalls,
              moduleId: "<console>"
            }
          )
  };
}

function parseJson(input: SandboxValue, budget: Budget): SandboxValue {
  const text = budget.allocateString(toJsonParseText(input));

  return copyJsonToSandbox(JSON.parse(text), budget);
}

async function stringifyJson(
  value: SandboxValue,
  replacer: SandboxValue,
  indent: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  if (replacer !== undefined && replacer !== null && !isSandboxClosure(replacer)) {
    throw new TypeError(
      "JSON.stringify(value, replacer, indent) only supports function, null, or undefined replacers."
    );
  }

  if (indent !== undefined && typeof indent !== "number" && typeof indent !== "string") {
    throw new TypeError(
      "JSON.stringify(value, replacer, indent) requires indent to be a string, number, or undefined."
    );
  }

  const holder: SandboxObject = {};
  defineDataProperty(holder, "", value);
  const output = await stringifyProperty("", holder, {
    budget,
    context,
    gap: normalizeStringifyGap(indent),
    replacer: isSandboxClosure(replacer) ? replacer : undefined,
    stack: []
  });

  if (output === undefined) {
    return undefined;
  }

  return budget.allocateString(output);
}

function toJsonParseText(input: SandboxValue): string {
  if (Array.isArray(input)) {
    return input
      .map((entry) => (entry === null || entry === undefined ? "" : toJsonParseText(entry)))
      .join(",");
  }

  if (typeof input === "object" && input !== null) {
    return "[object Object]";
  }

  return String(input);
}

type StringifyState = {
  budget: Budget;
  context?: SandboxCallContext;
  gap: string;
  replacer?: SandboxClosure;
  stack: object[];
};

async function stringifyProperty(
  key: string,
  holder: SandboxArray | SandboxObject,
  state: StringifyState,
  indent = ""
): Promise<string | undefined> {
  let value = getOwnDataValue(holder, key);

  if (isSandboxDate(value)) {
    value = dateMethods.get("toJSON")!.invoke(value, []) as SandboxValue;
  } else if (isStringifyContainer(value)) {
    const toJSON = getOwnDataValue(value, "toJSON");
    if (isSandboxClosure(toJSON)) {
      value = await callStringifyClosure(toJSON, [key], value, state);
    }
  }

  if (state.replacer !== undefined) {
    value = await callStringifyClosure(state.replacer, [key, toSandboxValue(value)], holder, state);
  }

  return stringifyValue(value, state, indent);
}

async function stringifyValue(
  value: unknown,
  state: StringifyState,
  indent: string
): Promise<string | undefined> {
  if (isSandboxBox(value)) {
    const primitive = boxedValue(value);
    value = typeof primitive === "number" ? await sandboxNumber(value, state.budget, state.context)
      : typeof primitive === "string" ? await sandboxString(value, state.budget, state.context)
      : primitive;
  }
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return quoteJsonString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "bigint") {
    throw new TypeError("Do not know how to serialize a BigInt.");
  }

  if (isSandboxPromise(value)) return "{}";

  if (value === undefined || isSandboxClosure(value)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return stringifyArray(value, state, indent);
  }

  if (isStringifyObject(value)) {
    return stringifyObject(value, state, indent);
  }

  return undefined;
}

async function stringifyArray(
  value: SandboxArray,
  state: StringifyState,
  indent: string
): Promise<string> {
  enterStringifyObject(value, state);

  try {
    const nextIndent = indent + state.gap;
    const entries: string[] = [];

    for (let index = 0; index < value.length; index += 1) {
      entries.push((await stringifyProperty(String(index), value, state, nextIndent)) ?? "null");
    }

    if (entries.length === 0) {
      return "[]";
    }

    if (state.gap === "") {
      return `[${entries.join(",")}]`;
    }

    return `[\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${indent}]`;
  } finally {
    leaveStringifyObject(value, state);
  }
}

async function stringifyObject(
  value: SandboxObject,
  state: StringifyState,
  indent: string
): Promise<string> {
  enterStringifyObject(value, state);

  try {
    const nextIndent = indent + state.gap;
    const entries: string[] = [];

    for (const key of Object.keys(value)) {
      const serialized = await stringifyProperty(key, value, state, nextIndent);
      if (serialized !== undefined) {
        entries.push(`${quoteJsonString(key)}:${state.gap === "" ? "" : " "}${serialized}`);
      }
    }

    if (entries.length === 0) {
      return "{}";
    }

    if (state.gap === "") {
      return `{${entries.join(",")}}`;
    }

    return `{\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${indent}}`;
  } finally {
    leaveStringifyObject(value, state);
  }
}

async function callStringifyClosure(
  closure: SandboxClosure,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  state: StringifyState
): Promise<unknown> {
  const result = await closure.call(args, { stack: [], thisValue });
  if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
    await result.synchronousPrefix;
  }
  return allocateProducedSandboxValue(result, state.budget);
}

function enterStringifyObject(value: object, state: StringifyState): void {
  if (state.stack.includes(value)) {
    throw new TypeError("Converting circular structure to JSON.");
  }

  state.stack.push(value);
}

function leaveStringifyObject(value: object, state: StringifyState): void {
  if (state.stack.at(-1) === value) {
    state.stack.pop();
    return;
  }

  const index = state.stack.lastIndexOf(value);
  if (index >= 0) {
    state.stack.splice(index, 1);
  }
}

function normalizeStringifyGap(indent: SandboxValue): string {
  if (typeof indent === "number") {
    return " ".repeat(Math.min(10, Math.max(0, Math.trunc(indent))));
  }

  if (typeof indent === "string") {
    return indent.slice(0, 10);
  }

  return "";
}

function quoteJsonString(value: string): string {
  return JSON.stringify(value);
}

function isStringifyContainer(value: unknown): value is SandboxArray | SandboxObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !isSandboxClosure(value) &&
    !isSandboxPromise(value)
  );
}

function isStringifyObject(value: unknown): value is SandboxObject {
  return isStringifyContainer(value) && !Array.isArray(value);
}

function toSandboxValue(value: unknown): SandboxValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isSandboxClosure(value) ||
    isSandboxPromise(value) ||
    Array.isArray(value) ||
    isStringifyContainer(value)
  ) {
    return value as SandboxValue;
  }

  if (typeof value === "bigint") {
    throw new TypeError("Do not know how to serialize a BigInt.");
  }

  throw new TypeError(
    `JSON.stringify(value) produced an unsupported value of type ${typeof value}.`
  );
}

function getOwnDataValue(target: SandboxArray | SandboxObject, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    return undefined;
  }

  if ("get" in descriptor || "set" in descriptor) {
    throw new TypeError(`JSON.stringify(value) cannot serialize accessor property ${key}.`);
  }

  return descriptor.value as unknown;
}

function copyJsonToSandbox(value: unknown, budget: Budget): SandboxValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
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
    const copy = Object.create(null) as SandboxObject;

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
