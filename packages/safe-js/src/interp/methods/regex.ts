import {
  createSandboxClosure,
  getSandboxRegexPattern,
  getRegexProperties,
  isSandboxClosure,
  isSandboxRegex,
  type SandboxCallContext,
  type SandboxRegex,
  type SandboxValue
} from "../values.js";
import { matchRegex, type RegexMatch } from "../regex/engine.js";
import type { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { getSandboxPropertyDescriptor, getSandboxPrototype, hasExplicitSandboxPrototype } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { setSandboxProperty } from "../interpreter.js";

export async function regexSearch(target: SandboxValue, input: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue> {
  if (target === null || typeof target !== "object") throw new TypeError("RegExp search requires an object receiver.");
  let string: string | undefined;
  let previous: SandboxValue;
  let result: SandboxValue;
  const release = retainValues(budget, () => [target, input, string, previous, result]);
  const read = (value: SandboxValue, key: PropertyKey) => {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  };
  try {
    string = await sandboxString(input, budget, context);
    input = undefined;
    previous = await read(target, "lastIndex");
    if (!Object.is(previous, 0)) await setSandboxProperty(target, "lastIndex", 0, budget, true, context);
    result = await regexExec(target, string, budget, context);
    if (!Object.is(await read(target, "lastIndex"), previous))
      await setSandboxProperty(target, "lastIndex", previous, budget, true, context);
    return result === null ? -1 : await read(result, "index");
  } finally {
    release();
  }
}

export type RegexMethodName = "exec" | "test" | "toString";

const regexMethodNames = new Set<RegexMethodName>(["exec", "test", "toString"]);
export const regexFlagProperties: Readonly<Record<string, string>> = {
  hasIndices: "d", global: "g", ignoreCase: "i", multiline: "m",
  dotAll: "s", unicode: "u", unicodeSets: "v", sticky: "y"
};

export function isRegexMethodName(property: string | number): property is RegexMethodName {
  return typeof property === "string" && regexMethodNames.has(property as RegexMethodName);
}

export function getRegexMember(
  target: SandboxRegex,
  property: string | number,
  budget: Budget,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (property === "source") return escapeRegexSource(target.source, budget);
  if (property === "flags") {
    let flags = "";
    const entries = Object.entries(regexFlagProperties);
    const release = retainValues(budget, () => [target, flags]);
    const read = (index: number): string | Promise<string> => {
      if (index === entries.length) return budget.allocateString(flags);
      budget.visitNode();
      const [key, flag] = entries[index];
      const descriptor = context?.getProperty === undefined
        ? getSandboxPropertyDescriptor(target, key, budget) : undefined;
      const value = context?.getProperty !== undefined
        ? context.getProperty(target, key)
        : descriptor !== undefined
          ? readPropertyDescriptor(descriptor, target, context)
          : target.flags.includes(flag);
      const append = (value: SandboxValue): string | Promise<string> => {
        if (value) flags += flag;
        return read(index + 1);
      };
      return value instanceof Promise ? value.then(append) : append(value);
    };
    try {
      const result = read(0);
      if (result instanceof Promise) return result.finally(release);
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }
  if (property === "lastIndex") return target.lastIndex;
  if (Object.hasOwn(regexFlagProperties, property)) return target.flags.includes(regexFlagProperties[property]);
  if (!isRegexMethodName(property)) {
    return undefined;
  }
  return createSandboxClosure({
    sandbox: true,
    name: property === "toString" ? "toString" : `RegExp#${property}`,
    call: (args, context) => callRegexMethod(context?.thisValue, property, args, budget, context)
  });
}

function escapeRegexSource(source: string, budget?: Budget): string {
  let text = "";
  let escaped = false;
  let inClass = false;
  for (const character of source) {
    budget?.visitNode();
    if (
      character === "\n" ||
      character === "\r" ||
      character === "\u2028" ||
      character === "\u2029"
    ) {
      if (escaped) text = text.slice(0, -1);
      text +=
        character === "\n"
          ? "\\n"
          : character === "\r"
            ? "\\r"
            : character === "\u2028"
              ? "\\u2028"
              : "\\u2029";
      escaped = false;
    } else {
      if (!escaped && character === "[") inClass = true;
      if (!escaped && character === "]") inClass = false;
      text += character === "/" && !escaped && !inClass ? "\\/" : character;
      escaped = character === "\\" && !escaped;
    }
    budget?.allocateString(text);
  }
  text = text === "" ? "(?:)" : text;
  return budget === undefined ? text : budget.allocateString(text);
}

export function setRegexMember(
  target: SandboxRegex,
  property: PropertyKey,
  value: SandboxValue,
  budget?: Budget
): void {
  const properties = getRegexProperties(target);
  if (!hasExplicitSandboxPrototype(target) && getSandboxPrototype(target, budget) === null && !Object.hasOwn(properties, property) &&
      (property === "source" || property === "flags" || Object.hasOwn(regexFlagProperties, property))) {
    throw new TypeError(`RegExp#${String(property)} is not writable.`);
  }
  if (!Reflect.set(properties, property, value)) throw new TypeError(`RegExp#${String(property)} is not writable.`);
}

export async function callRegexMethod(
  target: SandboxValue,
  methodName: RegexMethodName,
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  if (methodName === "toString") return regexToString(target, budget, context);
  if (target === null || typeof target !== "object" || (methodName === "exec" && !isSandboxRegex(target))) {
    throw new TypeError(`RegExp#${methodName} requires ${methodName === "exec" ? "a regex" : "an object"} receiver.`);
  }
  const retained = {};
  let cursor: SandboxValue;
  let convertedInput: string | undefined;
  budget.setRetainedValues(retained, () => [target, ...args, cursor, convertedInput]);
  try {
    const input = await sandboxString(args[0], budget, context);
    if (methodName === "test") {
      budget.setRetainedValues(retained, undefined);
      return await regexExec(target, input, budget, context) !== null;
    }
    if (typeof args[0] !== "string") convertedInput = input;
    if (!isSandboxRegex(target)) throw new TypeError("RegExp execution requires a regex receiver.");
    cursor = target.lastIndex;
    const lastIndex = await sandboxNumber(cursor, budget, context);
    const match = executeRegex(target, input, lastIndex);
    return toMatchArray(match, input);
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
}

export async function regexExec(
  target: SandboxValue,
  input: string,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  let exec: SandboxValue;
  const release = retainValues(budget, () => [target, input, exec]);
  try {
    const descriptor = context?.getProperty === undefined
      ? getSandboxPropertyDescriptor(target, "exec", budget) : undefined;
    exec = await (context?.getProperty !== undefined ? context.getProperty(target, "exec")
      : descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, target, context));
    if (isSandboxClosure(exec)) {
      const result = await invokeBuiltinClosure(exec, [input], budget, context, target);
      if (result !== null && typeof result !== "object")
        throw new TypeError("RegExp exec must return an object or null.");
      return result;
    }
    return await callRegexMethod(target, "exec", [input], budget, context);
  } finally {
    release();
  }
}

export async function regexToString(
  target: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  if (target === null || typeof target !== "object")
    throw new TypeError("RegExp#toString requires an object receiver.");
  const read = (key: "source" | "flags") => {
    if (context?.getProperty !== undefined) return context.getProperty(target, key);
    const descriptor = getSandboxPropertyDescriptor(target, key, budget);
    if (descriptor !== undefined) return readPropertyDescriptor(descriptor, target, context);
    return isSandboxRegex(target) ? getRegexMember(target, key, budget, context) : undefined;
  };
  let sourceValue: SandboxValue;
  let flagsValue: SandboxValue;
  let source: string | undefined;
  let flags: string | undefined;
  const release = retainValues(budget, () => [target, sourceValue, flagsValue, source, flags]);
  try {
    sourceValue = await read("source");
    source = await sandboxString(sourceValue, budget, context);
    sourceValue = undefined;
    flagsValue = await read("flags");
    flags = await sandboxString(flagsValue, budget, context);
    flagsValue = undefined;
    return budget.allocateString(`/${source}/${flags}`);
  } finally {
    release();
  }
}

export function executeRegex(target: SandboxRegex, input: string, lastIndex: number): RegexMatch | null {
  const pattern = getSandboxRegexPattern(target);
  const match = matchRegex(pattern, input, lastIndex);
  if (pattern.flags.global) {
    target.lastIndex = match === null ? 0 : match.index + match.text.length;
  }
  return match;
}

export function toMatchArray(match: RegexMatch | null, input: string): SandboxValue {
  if (match === null) {
    return null;
  }
  const result = [match.text, ...match.captures] as SandboxValue[];
  Object.assign(result, { index: match.index, input, groups: undefined });
  return result;
}
