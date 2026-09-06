import type { Budget } from "../budget.js";
import { isSandboxRegExpIterator, regexpIteratorState, type SandboxRegExpIterator } from "../regexp-iterator.js";
import { createSandboxClosure, type SandboxValue } from "../values.js";
import { executeRegex, toMatchArray } from "./regex.js";

export function nextRegExpIterator(
  iterator: SandboxRegExpIterator,
  budget?: Budget
): { value: SandboxValue; done: boolean } {
  const state = regexpIteratorState(iterator);
  budget?.visitNode();
  if (state.exhausted) return { value: undefined, done: true };
  const matcher = state.matcher!;
  const input = state.input!;
  const match = executeRegex(matcher, input, Number(matcher.lastIndex));
  if (match === null || !matcher.flags.includes("g")) {
    state.exhausted = true;
    state.matcher = undefined;
    state.input = undefined;
  }
  if (match === null) return { value: undefined, done: true };
  if (!state.exhausted && match.text.length === 0) {
    const index = Number(matcher.lastIndex);
    const unicode = matcher.flags.includes("u") || matcher.flags.includes("v");
    const codePoint = input.codePointAt(index);
    matcher.lastIndex = index + (unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
  }
  budget?.allocateArrayLength(match.captures.length + 1);
  return { value: toMatchArray(match, input), done: false };
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
      return nextRegExpIterator(receiver, budget);
    }
  });
}
