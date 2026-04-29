import type { Expression } from "../../parse.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, isSandboxClosure, type SandboxValue } from "../values.js";

const SPLIT_REGEX_MESSAGE = "String#split does not support regex separator values.";
const SPLIT_STRING_MESSAGE = "String#split only supports string separator values.";
const REPLACE_MESSAGE =
  "String#replace does not support function replacers or regex search values.";
const REPLACE_ALL_MESSAGE =
  "String#replaceAll does not support function replacers or regex search values.";

type StringMethodName =
  | "charAt"
  | "charCodeAt"
  | "codePointAt"
  | "concat"
  | "endsWith"
  | "includes"
  | "indexOf"
  | "lastIndexOf"
  | "normalize"
  | "padEnd"
  | "padStart"
  | "repeat"
  | "replace"
  | "replaceAll"
  | "slice"
  | "split"
  | "startsWith"
  | "substr"
  | "substring"
  | "toLowerCase"
  | "toUpperCase"
  | "trim"
  | "trimEnd"
  | "trimStart";

const stringMethodNames = new Set<StringMethodName>([
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "slice",
  "split",
  "startsWith",
  "substr",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart"
]);

export function getStringMember(
  value: string,
  property: string | number,
  budget: Budget
): SandboxValue | undefined {
  if (property === "length") {
    return value.length;
  }

  if (!isStringMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    name: `String#${property}`,
    call: (args) => callStringMethod(value, property, args, budget)
  });
}

export function isStringMethodName(property: string | number): property is StringMethodName {
  return typeof property === "string" && stringMethodNames.has(property as StringMethodName);
}

export function validateStringMethodArguments(
  methodName: StringMethodName,
  args: readonly Expression[]
): void {
  if (methodName === "split" && args[0]?.type === "RegexLiteral") {
    throw new TypeError(SPLIT_REGEX_MESSAGE);
  }

  if (
    (methodName === "replace" || methodName === "replaceAll") &&
    (args[0]?.type === "RegexLiteral" || isFunctionExpression(args[1]))
  ) {
    throw new TypeError(methodName === "replace" ? REPLACE_MESSAGE : REPLACE_ALL_MESSAGE);
  }
}

export function callStringMethod(
  value: string,
  methodName: StringMethodName,
  args: readonly SandboxValue[],
  budget: Budget
): SandboxValue {
  if (methodName === "replace" || methodName === "replaceAll") {
    return callReplaceLikeMethod(value, methodName, args, budget);
  }

  if (methodName === "split") {
    return callSplit(value, args, budget);
  }

  if (args.some(isSandboxClosure)) {
    throw new TypeError(`String#${methodName} does not support function arguments.`);
  }

  switch (methodName) {
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
      return budget.allocateString(value.padStart(asNumber(args[0]), asStringOrUndefined(args[1])));
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
}

function callReplaceLikeMethod(
  value: string,
  methodName: "replace" | "replaceAll",
  args: readonly SandboxValue[],
  budget: Budget
): string {
  const message = methodName === "replace" ? REPLACE_MESSAGE : REPLACE_ALL_MESSAGE;

  if (isSandboxClosure(args[0]) || isSandboxClosure(args[1])) {
    throw new TypeError(message);
  }

  if (isRegexValue(args[0])) {
    throw new TypeError(message);
  }

  if (typeof args[0] !== "string" || typeof args[1] !== "string") {
    throw new TypeError(
      `String#${methodName} only supports string search and replacement arguments.`
    );
  }

  return budget.allocateString(
    methodName === "replace" ? value.replace(args[0], args[1]) : value.replaceAll(args[0], args[1])
  );
}

function callSplit(value: string, args: readonly SandboxValue[], budget: Budget): SandboxValue[] {
  if (args.some(isSandboxClosure)) {
    throw new TypeError("String#split does not support function arguments.");
  }

  if (isRegexValue(args[0])) {
    throw new TypeError(SPLIT_REGEX_MESSAGE);
  }

  if (args[0] !== undefined && typeof args[0] !== "string") {
    throw new TypeError(SPLIT_STRING_MESSAGE);
  }

  const limit = asNumberOrUndefined(args[1]);
  const result = splitString(value, args[0], limit).map((part) => budget.allocateString(part));
  budget.allocateArrayLength(result.length);
  return result;
}

function isFunctionExpression(node: Expression | undefined): boolean {
  return node?.type === "ArrowFunctionExpression";
}

function isRegexValue(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

function splitString(value: string, separator: string | undefined, limit: number | undefined): string[] {
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
