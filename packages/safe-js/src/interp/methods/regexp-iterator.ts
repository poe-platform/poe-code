import type { Budget } from "../budget.js";
import { isSandboxRegExpIterator, regexpIteratorState, type SandboxRegExpIterator } from "../regexp-iterator.js";
import { createSandboxClosure, isSandboxRegex, type SandboxCallContext, type SandboxValue } from "../values.js";
import { executeRegex, regexExec, toMatchArray } from "./regex.js";
import { getSandboxPropertyDescriptor, hasRegexPropertyOverride } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import { setSandboxProperty } from "../interpreter.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { normalizeLastIndex } from "../regex/engine.js";
import { retainValues } from "../resources.js";

export function nextRegExpIterator(
  iterator: SandboxRegExpIterator,
  budget?: Budget
): { value: SandboxValue; done: boolean } {
  const state = regexpIteratorState(iterator);
  budget?.visitNode();
  if (state.exhausted) return { value: undefined, done: true };
  const matcher = state.matcher!;
  if (!isSandboxRegex(matcher)) throw new TypeError("Custom RegExp iterator execution requires a sandbox context.");
  const input = state.input!;
  const match = executeRegex(matcher, input, Number(matcher.lastIndex));
  if (match === null || !(state.global ?? matcher.flags.includes("g"))) {
    state.exhausted = true;
    state.matcher = undefined;
    state.input = undefined;
  }
  if (match === null) return { value: undefined, done: true };
  if (!state.exhausted && match.text.length === 0) {
    const index = Number(matcher.lastIndex);
    const unicode = state.unicode ?? (matcher.flags.includes("u") || matcher.flags.includes("v"));
    const codePoint = input.codePointAt(index);
    matcher.lastIndex = index + (unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
  }
  budget?.allocateArrayLength(match.captures.length + 1);
  return { value: toMatchArray(match, input), done: false };
}

export async function nextObservableRegExpIterator(iterator: SandboxRegExpIterator, budget: Budget, context: SandboxCallContext): Promise<{ value: SandboxValue; done: boolean }> {
  const state = regexpIteratorState(iterator);
  if (state.exhausted) return { value: undefined, done: true };
  const matcher = state.matcher;
  if (isSandboxRegex(matcher) && !hasRegexPropertyOverride(matcher, ["exec"], budget) &&
      (matcher.lastIndex === null || typeof matcher.lastIndex !== "object"))
    return nextRegExpIterator(iterator, budget);
  const input = state.input!;
  let result: SandboxValue;
  let field: SandboxValue;
  const release = retainValues(budget, () => [iterator, matcher, input, result, field]);
  const read = (value: SandboxValue, key: PropertyKey) => {
    if (context.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  };
  try {
    budget.visitNode();
    result = await regexExec(matcher, input, budget, context);
    const global = state.global ?? (isSandboxRegex(matcher) && matcher.flags.includes("g"));
    if (result === null || !global) {
      state.exhausted = true;
      state.matcher = undefined;
      state.input = undefined;
      return result === null ? { value: undefined, done: true } : { value: result, done: false };
    }
    field = await read(result, "0");
    const text = await sandboxString(field, budget, context);
    field = undefined;
    if (text.length === 0) {
      field = await read(matcher, "lastIndex");
      const index = normalizeLastIndex(await sandboxNumber(field, budget, context));
      field = undefined;
      const unicode = state.unicode ?? (isSandboxRegex(matcher) && (matcher.flags.includes("u") || matcher.flags.includes("v")));
      const point = input.codePointAt(index);
      await setSandboxProperty(matcher, "lastIndex", index + (unicode && point !== undefined && point > 0xffff ? 2 : 1), budget, true, context);
    }
    return { value: result, done: false };
  } finally {
    release();
  }
}

export function getRegExpIteratorMember(property: PropertyKey, budget: Budget): SandboxValue {
  if (property === Symbol.toStringTag) return "RegExp String Iterator";
  if (property === Symbol.iterator) return createSandboxClosure({
    sandbox: true,
    name: "[Symbol.iterator]",
    call: (_args, context) => context?.thisValue
  });
  if (property !== "next") return undefined;
  return createSandboxClosure({
    sandbox: true,
    name: "next",
    call: (_args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxRegExpIterator(receiver))
        throw new TypeError("RegExp string iterator next requires a matching receiver.");
      return context === undefined ? nextRegExpIterator(receiver, budget) : nextObservableRegExpIterator(receiver, budget, context);
    }
  });
}
