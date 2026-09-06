import type { Expression } from "../../parse.js";
import { types } from "node:util";
import { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { CompileScope } from "../regex/compile-guard.js";
import { normalizeLastIndex } from "../regex/engine.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { getSandboxDataProperty, getSandboxPropertyDescriptor } from "../object-model.js";
import {
  createSandboxClosure,
  createSandboxRegex,
  deepCopyFromSandbox,
  isSandboxClosure,
  isSandboxRegex,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxRegex,
  type SandboxValue
} from "../values.js";
import { executeRegex, toMatchArray } from "./regex.js";
import { restoreSandboxRegExpIterator } from "../regexp-iterator.js";

const SPLIT_STRING_MESSAGE = "String#split only supports string separator values.";

type StringMethodName =
  | "at"
  | "charAt"
  | "charCodeAt"
  | "codePointAt"
  | "concat"
  | "endsWith"
  | "includes"
  | "indexOf"
  | "isWellFormed"
  | "lastIndexOf"
  | "localeCompare"
  | "match"
  | "matchAll"
  | "normalize"
  | "padEnd"
  | "padStart"
  | "repeat"
  | "replace"
  | "replaceAll"
  | "slice"
  | "search"
  | "split"
  | "startsWith"
  | "substr"
  | "substring"
  | "toLowerCase"
  | "toUpperCase"
  | "toWellFormed"
  | "trim"
  | "trimEnd"
  | "trimStart";

export const stringMethodNames = new Set<StringMethodName>([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "isWellFormed",
  "lastIndexOf",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "slice",
  "search",
  "split",
  "startsWith",
  "substr",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "toWellFormed",
  "trim",
  "trimEnd",
  "trimStart"
]);

export function getStringMember(
  value: string,
  property: string | number,
  budget: Budget
): SandboxValue | undefined {
  const index = getStringIndex(property);
  if (index !== undefined) {
    return value[index];
  }

  if (property === "length") {
    return value.length;
  }

  if (!isStringMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    name: `String#${property}`,
    ...(property === "localeCompare" ? { length: 1 } : {}),
    ...(property === "isWellFormed" || property === "toWellFormed" ? { length: 0 } : {}),
    call: async (args, context) => {
      const receiver = context?.thisValue;
      if (receiver === null || receiver === undefined) {
        throw new TypeError(`String#${property} requires a non-null receiver.`);
      }
      const retainedReceiver = {};
      budget.setRetainedValues(retainedReceiver, () => [receiver]);
      try {
        return await callStringMethod(
          receiver,
          property,
          args,
          budget,
          (closure, closureArgs) => invokeBuiltinClosure(closure, closureArgs, budget, context, undefined),
          context?.compilation,
          context
        );
      } finally {
        budget.setRetainedValues(retainedReceiver, undefined);
      }
    }
  });
}

export function getStringIndex(property: string | number): number | undefined {
  const index = typeof property === "number" ? property : Number(property);
  if (!Number.isInteger(index) || index < 0 || String(index) !== String(property)) {
    return undefined;
  }

  return index;
}

export function isStringMethodName(property: string | number): property is StringMethodName {
  return typeof property === "string" && stringMethodNames.has(property as StringMethodName);
}

export function validateStringMethodArguments(
  _methodName: StringMethodName,
  _args: readonly Expression[]
): void {}

export function callStringMethod(
  value: SandboxValue,
  methodName: StringMethodName,
  args: readonly SandboxValue[],
  budget: Budget,
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[]
  ) => Promise<SandboxValue> = async (closure, closureArgs) => await closure.call(closureArgs),
  parent?: CompileScope,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (value === null || value === undefined)
    throw new TypeError(`String#${methodName} requires a non-null receiver.`);
  const fallback = () => typeof value === "string"
    ? callStringMethodBody(value, methodName, args, budget, callClosure, parent, context)
    : Promise.resolve(sandboxString(value, budget, context)).then(string =>
      callStringMethodBody(string, methodName, args, budget, callClosure, parent, context));
  const symbol = methodName === "match" ? Symbol.match
    : methodName === "search" ? Symbol.search
    : methodName === "matchAll" ? Symbol.matchAll
    : methodName === "replace" || methodName === "replaceAll" ? Symbol.replace
    : methodName === "split" ? Symbol.split : undefined;
  const pattern = args[0];
  if (symbol !== undefined && types.isRegExp(pattern))
    throw new TypeError(`String#${methodName} does not accept unbranded host RegExp values.`);
  if (symbol === undefined || pattern === null || pattern === undefined) return fallback();
  const applyHook = (hook: SandboxValue) => {
    if (hook === null || hook === undefined) return fallback();
    if (!isSandboxClosure(hook)) throw new TypeError(`String#${methodName} symbol hook must be callable.`);
    return invokeBuiltinClosure(hook, symbol === Symbol.split || symbol === Symbol.replace ? [value, args[1]] : [value], budget, context, pattern);
  };
  const readProperty = (key: PropertyKey) => context?.getProperty !== undefined
    ? context.getProperty(pattern, key)
    : key === "flags" && isSandboxRegex(pattern) && getSandboxPropertyDescriptor(pattern, key, budget) === undefined
      ? pattern.flags : getSandboxDataProperty(pattern, key, budget);
  const dispatch = () => {
    const hook = readProperty(symbol);
    return hook instanceof Promise ? hook.then(applyHook) : applyHook(hook);
  };
  if ((methodName === "replaceAll" || methodName === "matchAll") &&
      (typeof pattern === "object" || typeof pattern === "function")) {
    const checkFlags = (flags: SandboxValue) => {
      const checkText = (text: string) => {
        if (!text.includes("g")) throw new TypeError(`String#${methodName} requires a global regex.`);
        return dispatch();
      };
      const text = sandboxString(flags, budget, context);
      return typeof text === "string" ? checkText(text) : text.then(checkText);
    };
    const checkMatch = (match: SandboxValue) => {
      if (!(match === undefined ? isSandboxRegex(pattern) : Boolean(match))) return dispatch();
      const flags = readProperty("flags");
      return flags instanceof Promise ? flags.then(checkFlags) : checkFlags(flags);
    };
    const match = readProperty(Symbol.match);
    return match instanceof Promise ? match.then(checkMatch) : checkMatch(match);
  }
  return dispatch();
}

function callStringMethodBody(
  value: string,
  methodName: StringMethodName,
  args: readonly SandboxValue[],
  budget: Budget,
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[]
  ) => Promise<SandboxValue> = async (closure, closureArgs) => await closure.call(closureArgs),
  parent?: CompileScope,
  context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  if (methodName === "concat" && args.some(argument => argument !== null && typeof argument === "object")) {
    return callConcat(value, args, budget, context);
  }

  if (methodName === "isWellFormed") {
    for (let index = 0; index < value.length; index++) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const nextCodeUnit = value.charCodeAt(index + 1);
        if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
          return false;
        }
        index++;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return false;
      }
    }
    return true;
  }

  if (methodName === "toWellFormed") {
    budget.allocateString(value);
    let result = "";
    let spanStart = 0;
    for (let index = 0; index < value.length; index++) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const nextCodeUnit = value.charCodeAt(index + 1);
        if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
          index++;
          continue;
        }
      } else if (codeUnit < 0xdc00 || codeUnit > 0xdfff) {
        continue;
      }
      result += value.slice(spanStart, index) + "\ufffd";
      spanStart = index + 1;
    }
    return budget.allocateString(result + value.slice(spanStart));
  }

  if (methodName === "replace" || methodName === "replaceAll") {
    return callReplaceLikeMethod(value, methodName, args, budget, callClosure, context);
  }

  const regex = args[0];
  if (isSandboxRegex(regex) && regex.lastIndex !== null && typeof regex.lastIndex === "object" &&
      ((methodName === "match" && !regex.flags.includes("g")) ||
       methodName === "matchAll")) {
    return callStringRegexCursor(value, methodName, regex, budget, parent, context);
  }

  if ((methodName === "match" || methodName === "matchAll" || methodName === "search") && !isSandboxRegex(args[0])) {
    return callStringPattern(value, methodName, args[0], budget, parent, context);
  }

  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner);
  try {
    if (methodName === "split") {
      return callSplit(value, args, budget, compilation);
    }

    if (methodName === "match" || methodName === "matchAll" || methodName === "search") {
      return callMatchLikeMethod(value, methodName, args, compilation);
    }

    if (methodName === "localeCompare") {
      if (isSandboxClosure(args[0])) {
        throw new TypeError("String#localeCompare does not support function comparison values.");
      }
      const comparison = budget.allocateString(
        String(deepCopyFromSandbox(args[0], { compilation }))
      );
      const locales: string[] = Reflect.apply(Intl.getCanonicalLocales, Intl, [
        deepCopyFromSandbox(args[1], { compilation })
      ]);
      const options = args[2];
      const nativeOptions =
        options === undefined || options === null
          ? options
          : Object.fromEntries(
              [
                "usage",
                "localeMatcher",
                "collation",
                "numeric",
                "caseFirst",
                "sensitivity",
                "ignorePunctuation"
              ].map((property) => {
                const descriptor = Object.getOwnPropertyDescriptor(options, property);
                if (descriptor !== undefined && !("value" in descriptor)) {
                  throw new TypeError("String#localeCompare only supports data option properties.");
                }
                const option: SandboxValue = descriptor?.value;
                return [
                  property,
                  option === undefined
                    ? undefined
                    : property === "numeric" || property === "ignorePunctuation"
                      ? Boolean(option)
                      : deepCopyFromSandbox(option, { compilation })
                ];
              })
            );
      budget.visitNode(value.length + comparison.length);
      return Reflect.apply(String.prototype.localeCompare, value, [
        comparison,
        locales,
        nativeOptions
      ]);
    }

    if (args.some(isSandboxClosure)) {
      throw new TypeError(`String#${methodName} does not support function arguments.`);
    }

    switch (methodName) {
      case "at": {
        const result = value.at(asNumber(args[0]));
        return result === undefined ? undefined : budget.allocateString(result);
      }
      case "charAt":
        return budget.allocateString(value.charAt(asNumber(args[0])));
      case "charCodeAt":
        return value.charCodeAt(asNumber(args[0]));
      case "codePointAt":
        return value.codePointAt(asNumber(args[0]));
      case "concat":
        return budget.allocateString(value.concat(...args.map(String)));
      case "endsWith":
        return value.endsWith(String(args[0]), asNumberOrUndefined(args[1]));
      case "includes":
        return value.includes(String(args[0]), asNumberOrUndefined(args[1]));
      case "indexOf":
        return value.indexOf(String(args[0]), asNumberOrUndefined(args[1]));
      case "lastIndexOf":
        return value.lastIndexOf(String(args[0]), asNumberOrUndefined(args[1]));
      case "normalize":
        return budget.allocateString(value.normalize(asStringOrUndefined(args[0])));
      case "padEnd":
        return budget.allocateString(value.padEnd(asNumber(args[0]), asStringOrUndefined(args[1])));
      case "padStart":
        return budget.allocateString(
          value.padStart(asNumber(args[0]), asStringOrUndefined(args[1]))
        );
      case "repeat":
        return budget.allocateString(value.repeat(asNumber(args[0])));
      case "slice":
        return budget.allocateString(
          value.slice(asNumberOrUndefined(args[0]), asNumberOrUndefined(args[1]))
        );
      case "startsWith":
        return value.startsWith(String(args[0]), asNumberOrUndefined(args[1]));
      case "substr":
        return budget.allocateString(value.substr(asNumber(args[0]), asNumberOrUndefined(args[1])));
      case "substring":
        return budget.allocateString(
          value.substring(asNumber(args[0]), asNumberOrUndefined(args[1]))
        );
      case "toLowerCase":
        return budget.allocateString(value.toLowerCase());
      case "toUpperCase":
        return budget.allocateString(value.toUpperCase());
      case "trim":
        return budget.allocateString(value.trim());
      case "trimEnd":
        return budget.allocateString(value.trimEnd());
      case "trimStart":
        return budget.allocateString(value.trimStart());
    }
  } finally {
    compilation.dispose();
    operation.release();
  }
}

async function callConcat(
  value: string,
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  let result = budget.allocateString(value);
  const release = retainValues(budget, () => [result]);
  try {
    for (const argument of args) {
      const text = sandboxString(argument, budget, context);
      result = budget.allocateString(result + (typeof text === "string" ? text : await text));
    }
    return result;
  } finally {
    release();
  }
}

function callReplaceLikeMethod(
  value: string,
  methodName: "replace" | "replaceAll",
  args: readonly SandboxValue[],
  budget: Budget,
  callClosure: (closure: SandboxClosure, args: readonly SandboxValue[]) => Promise<SandboxValue>,
  context?: SandboxCallContext
): string | Promise<string> {
  const search = args[0];
  const replacement = args[1];
  const useRegex = isSandboxRegex(search) && getSandboxPropertyDescriptor(search, Symbol.replace, budget) === undefined;
  if (
    (!useRegex && typeof search !== "string") ||
    (typeof replacement !== "string" && !isSandboxClosure(replacement))
  ) {
    return (async () => {
      let normalizedSearch: SandboxValue;
      let normalizedReplacement: SandboxValue;
      const release = retainValues(budget, () => [normalizedSearch, normalizedReplacement]);
      try {
        normalizedSearch = useRegex ? search : await sandboxString(search, budget, context);
        normalizedReplacement = isSandboxClosure(replacement) ? replacement : await sandboxString(replacement, budget, context);
        return await callReplaceLikeMethod(value, methodName, [normalizedSearch, normalizedReplacement], budget, callClosure, context);
      } finally {
        release();
      }
    })();
  }
  if (isSandboxRegex(search)) {
    return replaceRegex(
      value,
      search,
      replacement,
      budget,
      callClosure,
      context
    );
  }
  if (typeof replacement === "string") {
    return budget.allocateString(
      methodName === "replace"
        ? value.replace(search, replacement)
        : value.replaceAll(search, replacement)
    );
  }
  return replaceWithClosure(
    value,
    search,
    replacement,
    methodName === "replaceAll",
    budget,
    callClosure
  );
}

async function replaceRegex(
  value: string,
  regex: SandboxRegex,
  replacement: string | SandboxClosure,
  budget: Budget,
  callClosure: (closure: SandboxClosure, args: readonly SandboxValue[]) => Promise<SandboxValue>,
  context?: SandboxCallContext
): Promise<string> {
  if (regex.flags.includes("g")) regex.lastIndex = 0;
  const cursor = regex.lastIndex;
  const retained = {};
  budget.setRetainedValues(retained, () => [value, regex, cursor, replacement]);
  try {
    const lastIndex = await sandboxNumber(cursor, budget, context);
    const matches = collectRegexMatches(regex, value, regex.flags.includes("g"), undefined, lastIndex);
    let result = "";
    let copiedThrough = 0;
    for (const match of matches) {
      result += value.slice(copiedThrough, match.index);
      result +=
        typeof replacement === "string"
          ? expandReplacement(replacement, match.text, match.captures, value, match.index)
          : String(
              await callClosure(replacement, [match.text, ...match.captures, match.index, value])
            );
      copiedThrough = match.index + match.text.length;
    }
    result += value.slice(copiedThrough);
    return budget.allocateString(result);
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
}

function expandReplacement(
  replacement: string,
  match: string,
  captures: (string | undefined)[],
  input: string,
  matchIndex: number
): string {
  let result = "";
  for (let index = 0; index < replacement.length; index += 1) {
    const character = replacement.charAt(index);
    if (character !== "$") {
      result += character;
      continue;
    }

    const token = replacement.charAt(index + 1);
    if (token === "$") {
      result += "$";
    } else if (token === "&") {
      result += match;
    } else if (token === "`") {
      result += input.slice(0, matchIndex);
    } else if (token === "'") {
      result += input.slice(matchIndex + match.length);
    } else if (token >= "0" && token <= "9") {
      let captureIndex = Number(token);
      const nextDigit = replacement.charAt(index + 2);
      if (nextDigit >= "0" && nextDigit <= "9") {
        const twoDigitIndex = Number(token + nextDigit);
        if (twoDigitIndex > 0 && twoDigitIndex <= captures.length) {
          captureIndex = twoDigitIndex;
          index += 1;
        }
      }
      if (captureIndex === 0 || captureIndex > captures.length) {
        result += "$";
        continue;
      }
      result += captures[captureIndex - 1] ?? "";
    } else {
      result += "$";
      continue;
    }
    index += 1;
  }
  return result;
}

async function replaceWithClosure(
  value: string,
  searchValue: string,
  replacer: SandboxClosure,
  replaceAll: boolean,
  budget: Budget,
  callClosure: (closure: SandboxClosure, args: readonly SandboxValue[]) => Promise<SandboxValue>
): Promise<string> {
  const offsets = findReplacementOffsets(value, searchValue, replaceAll);
  let result = "";
  let copiedThrough = 0;

  for (const offset of offsets) {
    result += value.slice(copiedThrough, offset);
    result += String(await callClosure(replacer, [searchValue, offset, value]));
    copiedThrough = offset + searchValue.length;
  }

  result += value.slice(copiedThrough);
  return budget.allocateString(result);
}

function findReplacementOffsets(value: string, searchValue: string, replaceAll: boolean): number[] {
  const firstOffset = value.indexOf(searchValue);
  if (firstOffset === -1) {
    return [];
  }

  if (!replaceAll) {
    return [firstOffset];
  }

  if (searchValue.length === 0) {
    return Array.from({ length: value.length + 1 }, (_, offset) => offset);
  }

  const offsets: number[] = [];
  let offset = firstOffset;

  while (offset !== -1) {
    offsets.push(offset);
    offset = value.indexOf(searchValue, offset + searchValue.length);
  }

  return offsets;
}

function callSplit(
  value: string,
  args: readonly SandboxValue[],
  budget: Budget,
  compilation: CompileScope
): SandboxValue[] {
  if (args.some(isSandboxClosure))
    throw new TypeError("String#split does not support function arguments.");
  if (isSandboxRegex(args[0])) {
    const regex = args[0];
    const splitter = createSandboxRegex(
      regex.source,
      regex.flags.includes("g") ? regex.flags : `${regex.flags}g`,
      0,
      compilation
    );
    const limit = asNumberOrUndefined(args[1]) ?? 2 ** 32 - 1;
    const result: SandboxValue[] = [];
    let copiedThrough = 0;
    let endedWithZeroWidthMatch = false;
    for (const match of collectRegexMatches(splitter, value, true)) {
      endedWithZeroWidthMatch = match.text.length === 0 && match.index === value.length;
      if (
        match.text.length === 0 &&
        (match.index === copiedThrough || match.index === value.length)
      )
        continue;
      if (result.length >= limit) break;
      result.push(budget.allocateString(value.slice(copiedThrough, match.index)));
      for (const capture of match.captures) {
        if (result.length >= limit) break;
        result.push(capture === undefined ? undefined : budget.allocateString(capture));
      }
      copiedThrough = match.index + match.text.length;
    }
    if (result.length < limit && (value.length > 0 || !endedWithZeroWidthMatch))
      result.push(budget.allocateString(value.slice(copiedThrough)));
    budget.allocateArrayLength(result.length);
    return result;
  }
  if (args[0] !== undefined && typeof args[0] !== "string")
    throw new TypeError(SPLIT_STRING_MESSAGE);
  const limit = asNumberOrUndefined(args[1]);
  const result = splitString(value, args[0], limit).map((part) => budget.allocateString(part));
  budget.allocateArrayLength(result.length);
  return result;
}

async function callStringPattern(
  value: string,
  methodName: "match" | "matchAll" | "search",
  pattern: SandboxValue,
  budget: Budget,
  parent: CompileScope | undefined,
  context: SandboxCallContext | undefined
): Promise<SandboxValue> {
  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner);
  const retainedPattern = {};
  budget.setRetainedValues(retainedPattern, () => [value, pattern]);
  try {
    const source = pattern === undefined ? "" : await sandboxString(pattern, budget, context);
    const regex = createSandboxRegex(source, methodName === "matchAll" ? "g" : "", 0, compilation);
    return callMatchLikeMethod(value, methodName, [regex], compilation);
  } finally {
    budget.setRetainedValues(retainedPattern, undefined);
    compilation.dispose();
    operation.release();
  }
}

async function callStringRegexCursor(
  value: string,
  methodName: "match" | "matchAll",
  regex: SandboxRegex,
  budget: Budget,
  parent: CompileScope | undefined,
  context: SandboxCallContext | undefined
): Promise<SandboxValue> {
  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner);
  const cursor = regex.lastIndex;
  const retained = {};
  budget.setRetainedValues(retained, () => [value, regex, cursor]);
  try {
    const lastIndex = await sandboxNumber(cursor, budget, context);
    return callMatchLikeMethod(value, methodName, [regex], compilation, lastIndex);
  } finally {
    budget.setRetainedValues(retained, undefined);
    compilation.dispose();
    operation.release();
  }
}

function callMatchLikeMethod(
  value: string,
  methodName: "match" | "matchAll" | "search",
  args: readonly SandboxValue[],
  compilation: CompileScope,
  lastIndex?: number
): SandboxValue {
  const regex = args[0];
  if (!isSandboxRegex(regex))
    throw new TypeError(`String#${methodName} requires a regex argument.`);
  if (methodName === "search") {
    const lastIndex = regex.lastIndex;
    if (!Object.is(lastIndex, 0)) regex.lastIndex = 0;
    const match = executeRegex(regex, value, 0);
    if (!Object.is(regex.lastIndex, lastIndex)) regex.lastIndex = lastIndex;
    return match?.index ?? -1;
  }
  if (methodName === "match" && !regex.flags.includes("g"))
    return toMatchArray(executeRegex(regex, value, lastIndex ?? Number(regex.lastIndex)), value);
  if (methodName === "match") regex.lastIndex = 0;
  const matcher =
    methodName === "matchAll"
      ? createSandboxRegex(regex.source, regex.flags, normalizeLastIndex(lastIndex ?? Number(regex.lastIndex)), compilation)
      : regex;
  if (methodName === "matchAll")
    return restoreSandboxRegExpIterator({ matcher, input: value, exhausted: false });
  const matches = collectRegexMatches(matcher, value, matcher.flags.includes("g"), compilation.owner?.budget, Number(matcher.lastIndex));
  return matches.length === 0 ? null : matches.map((match) => match.text);
}

function collectRegexMatches(regex: SandboxRegex, value: string, all: boolean, budget?: Budget, lastIndex = 0) {
  const matches = [];
  do {
    const match = executeRegex(regex, value, lastIndex);
    if (match === null) break;
    budget?.allocateArrayLength(matches.length + 1);
    matches.push(match);
    lastIndex = match.index + match.text.length;
    if (all && match.text.length === 0) regex.lastIndex = ++lastIndex;
  } while (all);
  return matches;
}

function splitString(
  value: string,
  separator: string | undefined,
  limit: number | undefined
): string[] {
  const split = String.prototype.split as (
    this: string,
    separator: string | undefined,
    limit?: number
  ) => string[];

  return split.call(value, separator, limit);
}

function asNumber(value: SandboxValue | undefined): number {
  return Number(value);
}

function asNumberOrUndefined(value: SandboxValue | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function asStringOrUndefined(value: SandboxValue | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
