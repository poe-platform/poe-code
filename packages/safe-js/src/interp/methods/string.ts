import type { Expression } from "../../parse.js";
import { types } from "node:util";
import { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { CompileScope } from "../regex/compile-guard.js";
import { advanceStringIndex, normalizeLastIndex } from "../regex/engine.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { getSandboxDataProperty, getSandboxPropertyDescriptor, hasRegexPropertyOverride } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import { createSandboxBox } from "../boxed.js";
import { setSandboxProperty } from "../interpreter.js";
import {
  createSandboxClosure,
  createSandboxRegex,
  deepCopyFromSandbox,
  getSandboxRegexPattern,
  isSandboxClosure,
  isSandboxRegex,
  measureSandboxData,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxRegex,
  type SandboxValue
} from "../values.js";
import { executeRegex, getRegexMember, regexExec, regexFlagProperties, regexSearch, toMatchArray } from "./regex.js";
import { restoreSandboxRegExpIterator } from "../regexp-iterator.js";
import { compareStringLocale } from "./string-locale.js";

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
  const fallback = (coercePattern = false) => {
    const apply = (string: string) => {
      if (coercePattern && (methodName === "match" || methodName === "matchAll" || methodName === "search"))
        return callStringPattern(string, methodName, args[0], budget, parent, context);
      const useRegex = isSandboxRegex(args[0]) && !coercePattern;
      if (methodName === "replace" || methodName === "replaceAll")
        return callReplaceLikeMethod(string, methodName, args, budget, callClosure, useRegex, context);
      if (methodName === "split") return callSplit(string, args, budget, useRegex, parent, context);
      return callStringMethodBody(string, methodName, args, budget, parent, context);
    };
    return typeof value === "string" ? apply(value) : Promise.resolve(sandboxString(value, budget, context)).then(apply);
  };
  const symbol = methodName === "match" ? Symbol.match
    : methodName === "search" ? Symbol.search
    : methodName === "matchAll" ? Symbol.matchAll
    : methodName === "replace" || methodName === "replaceAll" ? Symbol.replace
    : methodName === "split" ? Symbol.split : undefined;
  const pattern = args[0];
  if (symbol !== undefined && types.isRegExp(pattern))
    throw new TypeError(`String#${methodName} does not accept unbranded host RegExp values.`);
  if (symbol === undefined || pattern === null || pattern === undefined) return fallback();
  const readProperty = (key: PropertyKey) => context?.getProperty !== undefined
    ? context.getProperty(pattern, key)
    : key === "flags" && isSandboxRegex(pattern) && getSandboxPropertyDescriptor(pattern, key, budget) === undefined
      ? getRegexMember(pattern, key, budget, context) : getSandboxDataProperty(pattern, key, budget);
  const dispatch = () => {
    const overriddenRegex = isSandboxRegex(pattern) && getSandboxPropertyDescriptor(pattern, symbol, budget) !== undefined;
    const applyHook = (hook: SandboxValue) => {
      if (hook === null || hook === undefined) return fallback(overriddenRegex);
      if (!isSandboxClosure(hook)) throw new TypeError(`String#${methodName} symbol hook must be callable.`);
      return invokeBuiltinClosure(hook, symbol === Symbol.split || symbol === Symbol.replace ? [value, args[1]] : [value], budget, context, pattern);
    };
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

  const regex = args[0];
  if (methodName === "search" && isSandboxRegex(regex) &&
      hasRegexPropertyOverride(regex, ["exec"], budget))
    return regexSearch(regex, value, budget, context);
  if (methodName === "match" && isSandboxRegex(regex) &&
      hasRegexPropertyOverride(regex, ["exec", "flags", ...Object.keys(regexFlagProperties)], budget))
    return regexMatch(value, regex, budget, context);
  if (isSandboxRegex(regex) && (methodName === "matchAll" ||
      (methodName === "match" && !regex.flags.includes("g") &&
       regex.lastIndex !== null && typeof regex.lastIndex === "object"))) {
    return callStringRegexCursor(value, methodName, regex, budget, parent, context);
  }

  if ((methodName === "match" || methodName === "matchAll" || methodName === "search") && !isSandboxRegex(args[0])) {
    return callStringPattern(value, methodName, args[0], budget, parent, context);
  }

  if (methodName === "localeCompare" && context?.getProperty !== undefined)
    return compareStringLocale(value, args, budget, context);

  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner);
  try {
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
  useRegex: boolean,
  context?: SandboxCallContext
): string | Promise<string> {
  const search = args[0];
  const replacement = args[1];
  const regexSearch = useRegex && isSandboxRegex(search);
  if (
    (!regexSearch && typeof search !== "string") ||
    (typeof replacement !== "string" && !isSandboxClosure(replacement))
  ) {
    return (async () => {
      let normalizedSearch: SandboxValue;
      let normalizedReplacement: SandboxValue;
      const release = retainValues(budget, () => [normalizedSearch, normalizedReplacement]);
      try {
        normalizedSearch = regexSearch ? search : await sandboxString(search, budget, context);
        normalizedReplacement = isSandboxClosure(replacement) ? replacement : await sandboxString(replacement, budget, context);
        return await callReplaceLikeMethod(value, methodName, [normalizedSearch, normalizedReplacement], budget, callClosure, useRegex, context);
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
    callClosure,
    context
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
  if (getSandboxRegexPattern(regex).groups !== undefined || hasRegexPropertyOverride(regex, ["exec", "flags", ...Object.keys(regexFlagProperties)], budget))
    return regexReplace(value, regex, replacement, budget, callClosure, context);
  if (regex.flags.includes("g")) regex.lastIndex = 0;
  const cursor = regex.lastIndex;
  let result = "";
  const retained = {};
  budget.setRetainedValues(retained, () => [value, regex, cursor, replacement, result]);
  try {
    const lastIndex = await sandboxNumber(cursor, budget, context);
    const matches = collectRegexMatches(regex, value, regex.flags.includes("g"), undefined, lastIndex);
    let copiedThrough = 0;
    for (const match of matches) {
      result += value.slice(copiedThrough, match.index);
      result +=
        typeof replacement === "string"
          ? await expandReplacement(replacement, match.text, match.captures, value, match.index, budget, context)
          : await sandboxString(
              await callClosure(replacement, [match.text, ...match.captures, match.index, value]),
              budget,
              context
            );
      copiedThrough = match.index + match.text.length;
    }
    result += value.slice(copiedThrough);
    return budget.allocateString(result);
  } finally {
    budget.setRetainedValues(retained, undefined);
  }
}

function readReplacementProperty(target: SandboxValue, key: string, budget: Budget, context?: SandboxCallContext): SandboxValue | Promise<SandboxValue> {
  if (context?.getProperty !== undefined) return context.getProperty(target, key);
  const descriptor = getSandboxPropertyDescriptor(target, key, budget);
  if (descriptor !== undefined) return readPropertyDescriptor(descriptor, target, context);
  return isSandboxRegex(target) ? getRegexMember(target, key, budget, context) : undefined;
}

export async function regexReplace(
  input: SandboxValue,
  regex: SandboxValue,
  replacementInput: SandboxValue,
  budget: Budget,
  callClosure: (closure: SandboxClosure, args: readonly SandboxValue[]) => Promise<SandboxValue>,
  context?: SandboxCallContext
): Promise<string> {
  if (regex === null || typeof regex !== "object") throw new TypeError("RegExp replace requires an object receiver.");
  let value: string | undefined;
  let replacement: string | SandboxClosure | undefined;
  const matches: SandboxValue[] = [];
  let current: SandboxValue;
  let field: SandboxValue;
  let groups: SandboxValue;
  let matched: string | undefined;
  let captures: (string | undefined)[] = [];
  let result = "";
  let flags: string | undefined;
  const release = retainValues(budget, () => [input, value, regex, replacementInput, replacement, matches, current, field, groups, matched, captures, result, flags]);
  try {
    value = await sandboxString(input, budget, context);
    input = undefined;
    replacement = isSandboxClosure(replacementInput) ? replacementInput : await sandboxString(replacementInput, budget, context);
    replacementInput = undefined;
    if (isSandboxRegex(regex) && getSandboxRegexPattern(regex).groups === undefined && !hasRegexPropertyOverride(regex, ["exec", "flags", ...Object.keys(regexFlagProperties)], budget)) {
      release();
      return await replaceRegex(value, regex, replacement, budget, callClosure, context);
    }
    field = await readReplacementProperty(regex, "flags", budget, context);
    flags = await sandboxString(field, budget, context);
    field = undefined;
    const global = flags.includes("g");
    const fullUnicode = flags.includes("u") || flags.includes("v");
    flags = undefined;
    if (global) await setSandboxProperty(regex, "lastIndex", 0, budget, true, context);
    while (true) {
      budget.visitNode();
      current = await regexExec(regex, value, budget, context);
      if (current === null) break;
      budget.allocateArrayLength(matches.length + 1);
      matches.push(current);
      if (!global) break;
      field = await readReplacementProperty(current, "0", budget, context);
      matched = await sandboxString(field, budget, context);
      field = undefined;
      if (matched.length === 0) {
        field = await readReplacementProperty(regex, "lastIndex", budget, context);
        const index = normalizeLastIndex(await sandboxNumber(field, budget, context));
        const point = fullUnicode ? value.codePointAt(index) : undefined;
        await setSandboxProperty(regex, "lastIndex", index + (point !== undefined && point > 0xffff ? 2 : 1), budget, true, context);
        field = undefined;
      }
      matched = undefined;
      current = undefined;
    }
    let copiedThrough = 0;
    for (current of matches) {
      field = await readReplacementProperty(current, "length", budget, context);
      const count = Math.max(normalizeLastIndex(await sandboxNumber(field, budget, context)) - 1, 0);
      field = await readReplacementProperty(current, "0", budget, context);
      matched = await sandboxString(field, budget, context);
      field = await readReplacementProperty(current, "index", budget, context);
      const number = await sandboxNumber(field, budget, context);
      const position = Math.min(Math.max(Number.isNaN(number) ? 0 : Math.trunc(number), 0), value.length);
      field = undefined;
      captures = [];
      budget.allocateArrayLength(count);
      for (let index = 1; index <= count; index++) {
        budget.visitNode();
        field = await readReplacementProperty(current, String(index), budget, context);
        captures.push(field === undefined ? undefined : await sandboxString(field, budget, context));
        field = undefined;
      }
      groups = await readReplacementProperty(current, "groups", budget, context);
      let text: string;
      if (typeof replacement === "string") {
        if (groups === null) throw new TypeError("Replacement groups cannot be null.");
        if (groups !== undefined && typeof groups !== "object") {
          groups = createSandboxBox(groups);
          budget.chargeDataUsage(measureSandboxData([groups]));
        }
        text = await expandReplacement(replacement, matched, captures, value, position, budget, context, groups);
      } else {
        const args: SandboxValue[] = [matched, ...captures, position, value];
        if (groups !== undefined) args.push(groups);
        budget.allocateArrayLength(args.length);
        field = await callClosure(replacement, args);
        text = await sandboxString(field, budget, context);
        field = undefined;
      }
      if (position >= copiedThrough) {
        result = budget.allocateString(result + value.slice(copiedThrough, position) + text);
        copiedThrough = position + matched.length;
      }
      matched = undefined;
      captures = [];
      groups = undefined;
    }
    return budget.allocateString(result + value.slice(copiedThrough));
  } finally {
    release();
  }
}

async function expandReplacement(
  replacement: string,
  match: string,
  captures: (string | undefined)[],
  input: string,
  matchIndex: number,
  budget: Budget,
  context?: SandboxCallContext,
  groups?: SandboxValue
): Promise<string> {
  let result = "";
  const release = retainValues(budget, () => [replacement, match, captures, input, groups, result]);
  try {
    for (let index = 0; index < replacement.length; index += 1) {
      budget.visitNode();
      budget.allocateString(result);
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
      } else if (token === "<" && groups !== undefined) {
        const end = replacement.indexOf(">", index + 2);
        if (end === -1) {
          result += "$";
          continue;
        }
        const capture = await readReplacementProperty(groups, replacement.slice(index + 2, end), budget, context);
        if (capture !== undefined) result += await sandboxString(capture, budget, context);
        index = end;
        continue;
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
    return budget.allocateString(result);
  } finally {
    release();
  }
}

async function replaceWithClosure(
  value: string,
  searchValue: string,
  replacer: SandboxClosure,
  replaceAll: boolean,
  budget: Budget,
  callClosure: (closure: SandboxClosure, args: readonly SandboxValue[]) => Promise<SandboxValue>,
  context?: SandboxCallContext
): Promise<string> {
  const offsets = findReplacementOffsets(value, searchValue, replaceAll);
  let result = "";
  let copiedThrough = 0;

  const release = retainValues(budget, () => [value, searchValue, replacer, result]);
  try {
    for (const offset of offsets) {
      result += value.slice(copiedThrough, offset);
      result += await sandboxString(await callClosure(replacer, [searchValue, offset, value]), budget, context);
      copiedThrough = offset + searchValue.length;
    }

    result += value.slice(copiedThrough);
    return budget.allocateString(result);
  } finally {
    release();
  }
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
  useRegex: boolean,
  parent?: CompileScope,
  context?: SandboxCallContext
): SandboxValue[] | Promise<SandboxValue[]> {
  const pattern = args[0];
  let separator: string | SandboxRegex | undefined;
  const release = retainValues(budget, () => [value, ...args, separator]);
  const withLimit = (number: number): SandboxValue[] | Promise<SandboxValue[]> => {
    const limit = number >>> 0;
    const converted = useRegex || pattern === undefined ? pattern : sandboxString(pattern, budget, context);
    const split = (converted: string | SandboxRegex | undefined) => {
      separator = converted;
      return splitNormalized(value, converted, limit, budget, parent);
    };
    return converted instanceof Promise ? converted.then(split) : split(converted as string | SandboxRegex | undefined);
  };
  try {
    const limit = args[1] === undefined ? 2 ** 32 - 1 : sandboxNumber(args[1], budget, context);
    const result = limit instanceof Promise ? limit.then(withLimit) : withLimit(limit);
    if (result instanceof Promise) return result.finally(release);
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}

function splitNormalized(
  value: string,
  separator: string | SandboxRegex | undefined,
  limit: number,
  budget: Budget,
  parent?: CompileScope
): SandboxValue[] {
  if (limit === 0) return [];
  if (isSandboxRegex(separator)) {
    const regex = separator;
    const operation = budget.acquireCompileOwner(false, parent?.owner);
    const compilation = new CompileScope(operation.owner);
    try {
      const splitter = createSandboxRegex(
        regex.source,
        regex.flags.includes("g") ? regex.flags : `${regex.flags}g`,
        0,
        compilation
      );
      const result: SandboxValue[] = [];
      let copiedThrough = 0;
      let endedWithZeroWidthMatch = false;
      while (result.length < limit) {
        const match = executeRegex(splitter, value, Number(splitter.lastIndex));
        if (match === null) break;
        if (match.text.length === 0) splitter.lastIndex = advanceStringIndex(value, match.index, splitter.flags.includes("u") || splitter.flags.includes("v"));
        endedWithZeroWidthMatch = match.text.length === 0 && match.index === value.length;
        if (
          match.text.length === 0 &&
          (match.index === copiedThrough || match.index === value.length)
        )
          continue;
        budget.allocateArrayLength(result.length + 1);
        result.push(budget.allocateString(value.slice(copiedThrough, match.index)));
        for (const capture of match.captures) {
          if (result.length >= limit) break;
          budget.allocateArrayLength(result.length + 1);
          result.push(capture === undefined ? undefined : budget.allocateString(capture));
        }
        copiedThrough = match.index + match.text.length;
      }
      if (result.length < limit && (value.length > 0 || !endedWithZeroWidthMatch)) {
        budget.allocateArrayLength(result.length + 1);
        result.push(budget.allocateString(value.slice(copiedThrough)));
      }
      return result;
    } finally {
      compilation.dispose();
      operation.release();
    }
  }
  const result = splitString(value, separator, limit).map((part) => budget.allocateString(part));
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

export async function regexMatch(
  input: SandboxValue,
  regex: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<SandboxValue> {
  if (regex === null || typeof regex !== "object") throw new TypeError("RegExp match requires an object receiver.");
  let value: string | undefined;
  const matches: SandboxValue[] = [];
  let result: SandboxValue;
  let matched: SandboxValue;
  let cursor: SandboxValue;
  let flagsValue: SandboxValue;
  let flags: string | undefined;
  const release = retainValues(budget, () => [input, value, regex, matches, result, matched, cursor, flagsValue, flags]);
  const read = (target: SandboxValue, key: PropertyKey) => {
    if (context?.getProperty !== undefined) return context.getProperty(target, key);
    const descriptor = getSandboxPropertyDescriptor(target, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, target, context);
  };
  try {
    value = await sandboxString(input, budget, context);
    input = undefined;
    if (isSandboxRegex(regex) && !hasRegexPropertyOverride(regex, ["exec", "flags", ...Object.keys(regexFlagProperties)], budget)) {
      release();
      return await callStringMethodBody(value, "match", [regex], budget, context?.compilation, context);
    }
    flagsValue = await read(regex, "flags");
    flags = await sandboxString(flagsValue, budget, context);
    flagsValue = undefined;
    if (!flags.includes("g")) return await regexExec(regex, value, budget, context);
    const fullUnicode = flags.includes("u") || flags.includes("v");
    flags = undefined;
    await setSandboxProperty(regex, "lastIndex", 0, budget, true, context);
    while (true) {
      budget.visitNode();
      result = await regexExec(regex, value, budget, context);
      if (result === null) return matches.length === 0 ? null : matches;
      const descriptor = context?.getProperty === undefined
        ? getSandboxPropertyDescriptor(result, "0", budget) : undefined;
      matched = await (context?.getProperty !== undefined ? context.getProperty(result, "0")
        : descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, result, context));
      const text = await sandboxString(matched, budget, context);
      matched = undefined;
      budget.allocateArrayLength(matches.length + 1);
      matches.push(text);
      if (text.length === 0) {
        cursor = await read(regex, "lastIndex");
        const index = normalizeLastIndex(await sandboxNumber(cursor, budget, context));
        const point = fullUnicode ? value.codePointAt(index) : undefined;
        await setSandboxProperty(regex, "lastIndex", index + (point !== undefined && point > 0xffff ? 2 : 1), budget, true, context);
        cursor = undefined;
      }
      result = undefined;
    }
  } finally {
    release();
  }
}

function callStringRegexCursor(
  value: string,
  methodName: "match" | "matchAll",
  regex: SandboxRegex,
  budget: Budget,
  parent: CompileScope | undefined,
  context: SandboxCallContext | undefined
): SandboxValue | Promise<SandboxValue> {
  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner);
  let cursor: SandboxValue;
  let flagsValue: SandboxValue;
  let flags: string | undefined;
  let matcher: SandboxRegex | undefined;
  const retained = {};
  budget.setRetainedValues(retained, () => [value, regex, cursor, flagsValue, flags, matcher]);
  const release = () => {
    budget.setRetainedValues(retained, undefined);
    compilation.dispose();
    operation.release();
  };
  const readCursor = () => {
    cursor = regex.lastIndex;
    const finish = (lastIndex: number) => {
      if (matcher !== undefined) {
        matcher.lastIndex = normalizeLastIndex(lastIndex);
        return restoreSandboxRegExpIterator({ matcher, input: value, exhausted: false });
      }
      return callMatchLikeMethod(value, methodName, [regex], compilation, lastIndex);
    };
    const lastIndex = sandboxNumber(cursor, budget, context);
    return lastIndex instanceof Promise ? lastIndex.then(finish) : finish(lastIndex);
  };
  const clone = (text: string) => {
    flags = text;
    flagsValue = undefined;
    matcher = createSandboxRegex(regex.source, flags, 0, compilation);
    flags = undefined;
    return readCursor();
  };
  const convertFlags = (value: SandboxValue) => {
    flagsValue = value;
    const text = sandboxString(value, budget, context);
    return text instanceof Promise ? text.then(clone) : clone(text);
  };
  try {
    let result: SandboxValue | Promise<SandboxValue>;
    if (methodName === "matchAll") {
      const descriptor = context?.getProperty === undefined
        ? getSandboxPropertyDescriptor(regex, "flags", budget) : undefined;
      const value = context?.getProperty !== undefined
        ? context.getProperty(regex, "flags")
        : descriptor !== undefined
          ? readPropertyDescriptor(descriptor, regex, context)
          : getRegexMember(regex, "flags", budget, context);
      result = value instanceof Promise ? value.then(convertFlags) : convertFlags(value);
    } else result = readCursor();
    if (result instanceof Promise) return result.finally(release);
    release();
    return result;
  } catch (error) {
    release();
    throw error;
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
    return toMatchArray(executeRegex(regex, value, lastIndex ?? Number(regex.lastIndex)), value, compilation.owner?.budget);
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
    if (all && match.text.length === 0) regex.lastIndex = lastIndex = advanceStringIndex(value, lastIndex, regex.flags.includes("u") || regex.flags.includes("v"));
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
  return +(value as number);
}

function asNumberOrUndefined(value: SandboxValue | undefined): number | undefined {
  return value === undefined ? undefined : +(value as number);
}

function asStringOrUndefined(value: SandboxValue | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
