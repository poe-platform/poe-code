import type { Budget, CompileOwner } from "../budget.js";
import { retainValues } from "../resources.js";
import { parseJsonWithReviver } from "./json-parse.js";
import { createRawJson, isRawJson } from "../raw-json.js";
import { readPropertyDescriptor } from "../accessors.js";
import { getBoxedPrototype, getSandboxPropertyDescriptor, registerIntrinsicFunction, registerIntrinsicObject } from "../object-model.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { isSandboxDate } from "../date.js";
import { dateToJSON } from "./date.js";
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
  ownEnumerableSandboxKeys,
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

  const globals = {
    JSON: {
      rawJSON: createSandboxClosure({
        sandbox: true,
        guest: true,
        name: "rawJSON",
        length: 1,
        call: async ([value], context) => {
          const text = await sandboxString(value, options.budget, context);
          options.budget.visitNode(text.length);
          return createRawJson(options.budget.allocateString(text));
        }
      }),
      isRawJSON: createSandboxClosure({
        sandbox: true,
        guest: true,
        name: "isRawJSON",
        length: 1,
        call: ([value]) => isRawJson(value)
      }),
      parse: createSandboxClosure({
        sandbox: true,
        guest: true,
        length: 2,
        call: async ([text, reviver], context) => {
          const converted = sandboxString(text, options.budget, context);
          const source = converted instanceof Promise ? await converted : converted;
          if (isSandboxClosure(reviver)) return parseJsonWithReviver(source, reviver, options.budget, context);
          return copyJsonToSandbox(
            JSON.parse(source),
            options.budget
          );
        },
        name: "parse"
      }),
      stringify: createSandboxClosure({
        sandbox: true,
        guest: true,
        length: 3,
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
              properties: {},
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
              properties: {},
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
  const jsonMethods = Object.entries(globals.JSON);
  for (const [name] of jsonMethods) {
    Object.defineProperty(globals.JSON, name, { enumerable: false });
  }
  Object.defineProperty(globals.JSON, Symbol.toStringTag, { value: "JSON", configurable: true });
  registerBuiltinIdentities(options.budget, { JSON: globals.JSON });
  for (const [, method] of jsonMethods) registerIntrinsicFunction(options.budget, method);
  registerIntrinsicObject(options.budget, globals.JSON);
  return globals;
}

async function stringifyJson(
  value: SandboxValue,
  replacer: SandboxValue,
  indent: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  const allocation = {};
  let propertyList: string[] | undefined;
  const release = retainValues(budget, () => [value, replacer, indent]);
  try {
    if (Array.isArray(replacer)) {
      propertyList = [];
      const seen = new Set<string>();
      let size = 0;
      const state: StringifyState = { budget, context, gap: "", stack: [] };
      const length = replacer.length;
      for (let index = 0; index < length; index++) {
        budget.visitNode();
        const entry = await getStringifyProperty(replacer, String(index), state);
        const primitive = isSandboxBox(entry) ? boxedValue(entry) : entry;
        if (typeof primitive !== "string" && typeof primitive !== "number") continue;
        const key = await sandboxString(entry, budget, context);
        if (seen.has(key)) continue;
        budget.allocateArrayLength(propertyList.length + 1);
        size += key.length + 2;
        budget.setRetainedDataUsage(allocation, size);
        propertyList.push(key);
        seen.add(key);
      }
    }

    if (isSandboxBox(indent)) {
      const primitive = boxedValue(indent);
      if (typeof primitive === "number") indent = await sandboxNumber(indent, budget, context);
      else if (typeof primitive === "string") indent = await sandboxString(indent, budget, context);
    }

    const holder: SandboxObject = {};
    defineDataProperty(holder, "", value);
    const output = await stringifyProperty("", holder, {
      budget,
      context,
      gap: normalizeStringifyGap(indent),
      replacer: isSandboxClosure(replacer) ? replacer : undefined,
      propertyList,
      stack: []
    });

    if (output === undefined) {
      return undefined;
    }

    return budget.allocateString(output);
  } finally {
    budget.setRetainedDataUsage(allocation, 0);
    release();
  }
}

type StringifyState = {
  budget: Budget;
  context?: SandboxCallContext;
  gap: string;
  replacer?: SandboxClosure;
  propertyList?: string[];
  stack: object[];
};

async function stringifyProperty(
  key: string,
  holder: SandboxArray | SandboxObject,
  state: StringifyState,
  indent = ""
): Promise<string | undefined> {
  let value: unknown = await getStringifyProperty(holder, key, state);
  const release = retainValues(state.budget, () => [holder, value]);
  try {
    if (isSandboxDate(value) && getSandboxPropertyDescriptor(value, "toJSON", state.budget) === undefined) {
      value = await dateToJSON(value, state.budget, state.context);
    } else if (typeof value === "bigint" || isSandboxClosure(value) || isStringifyContainer(value)) {
      const toJSON = await getStringifyProperty(value, "toJSON", state);
      if (isSandboxClosure(toJSON)) {
        value = await callStringifyClosure(toJSON, [key], value, state);
      }
    }

    if (state.replacer !== undefined) {
      value = await callStringifyClosure(
        state.replacer,
        [key, toSandboxValue(value)],
        holder,
        state
      );
    }

    return await stringifyValue(value, state, indent);
  } finally {
    release();
  }
}

async function stringifyValue(
  value: unknown,
  state: StringifyState,
  indent: string
): Promise<string | undefined> {
  if (isRawJson(value)) return value.rawJSON;
  if (isSandboxBox(value)) {
    const primitive = boxedValue(value);
    value =
      typeof primitive === "number"
        ? await sandboxNumber(value, state.budget, state.context)
        : typeof primitive === "string"
          ? await sandboxString(value, state.budget, state.context)
          : typeof primitive === "symbol" ? value : primitive;
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
  const entries: string[] = [];
  const release = retainValues(state.budget, () => entries);
  try {
    const nextIndent = indent + state.gap;

    const length = value.length;
    for (let index = 0; index < length; index += 1) {
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
    release();
    leaveStringifyObject(value, state);
  }
}

async function stringifyObject(
  value: SandboxObject,
  state: StringifyState,
  indent: string
): Promise<string> {
  enterStringifyObject(value, state);
  const entries: string[] = [];
  const release = retainValues(state.budget, () => entries);
  try {
    const nextIndent = indent + state.gap;

    for (const key of state.propertyList ?? ownEnumerableSandboxKeys(value)) {
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
    release();
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
    !isSandboxClosure(value)
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
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "boolean" ||
    isSandboxClosure(value) ||
    isSandboxPromise(value) ||
    Array.isArray(value) ||
    isStringifyContainer(value)
  ) {
    return value as SandboxValue;
  }

  throw new TypeError(
    `JSON.stringify(value) produced an unsupported value of type ${typeof value}.`
  );
}

function getStringifyProperty(
  target: SandboxArray | SandboxObject | SandboxClosure | bigint,
  key: string,
  state: StringifyState
): SandboxValue | Promise<SandboxValue> {
  if (state.context?.getProperty !== undefined) return state.context.getProperty(target, key);
  const object = typeof target === "bigint" ? getBoxedPrototype(target, state.budget) : target;
  const descriptor = object === undefined ? undefined : getSandboxPropertyDescriptor(object, key, state.budget);
  return descriptor === undefined
    ? undefined
    : readPropertyDescriptor(descriptor, target, state.context);
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
