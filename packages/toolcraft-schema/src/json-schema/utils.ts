import type { ValidationIssue } from "../validate.js";
import type { Dialect, EvaluationResult, JsonSchema, SchemaObject } from "./types.js";

export function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "boolean" || isObject(value);
}

export function isObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dialectFor(schema: SchemaObject, inherited: Dialect): Dialect {
  const dialect = schema.$schema;
  if (typeof dialect !== "string") {
    return inherited;
  }
  if (dialect.includes("draft-07")) {
    return "draft7";
  }
  if (dialect.includes("2020-12")) {
    return "draft2020-12";
  }
  return inherited;
}

export function resolveUri(reference: string, baseUri: string): string {
  try {
    return new URL(reference, baseUri).href;
  } catch {
    throw new Error(`Invalid schema URI: ${reference}`);
  }
}

export function withoutFragment(uri: string): string {
  const index = uri.indexOf("#");
  return index === -1 ? uri : uri.slice(0, index);
}

export function fragmentOf(uri: string): string {
  const index = uri.indexOf("#");
  return index === -1 ? "" : uri.slice(index + 1);
}

export function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function decodePointer(value: string): string {
  return decodeURIComponent(value).replaceAll("~1", "/").replaceAll("~0", "~");
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key])
      )
    );
  }
  return false;
}

export function receivedType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return "integer";
  }
  return typeof value;
}

export function issue(
  path: readonly string[],
  expected: string,
  value: unknown,
  message: string,
  keyword: string = keywordFor(expected)
): ValidationIssue {
  return { path, expected, received: receivedType(value), message, keyword };
}

function keywordFor(expected: string): string {
  if (["null", "boolean", "object", "array", "number", "integer", "string"].includes(expected)) {
    return "type";
  }
  if (expected.startsWith("multiple of")) return "multipleOf";
  if (expected.startsWith("length <=")) return "maxLength";
  if (expected.startsWith("length >=")) return "minLength";
  if (expected.startsWith("pattern ")) return "pattern";
  if (expected.startsWith("items <=")) return "maxItems";
  if (expected.startsWith("items >=")) return "minItems";
  if (expected === "unique items") return "uniqueItems";
  if (expected.startsWith("properties <=")) return "maxProperties";
  if (expected.startsWith("properties >=")) return "minProperties";
  if (expected.startsWith("<= ")) return "maximum";
  if (expected.startsWith(">= ")) return "minimum";
  if (expected.startsWith("< ")) return "exclusiveMaximum";
  if (expected.startsWith("> ")) return "exclusiveMinimum";
  if (expected === "valid schema") return "false schema";
  return expected;
}

export function validResult(): EvaluationResult {
  return {
    valid: true,
    issues: [],
    evaluatedProperties: new Set(),
    evaluatedItems: new Set()
  };
}

export function invalidResult(problem: ValidationIssue): EvaluationResult {
  return {
    valid: false,
    issues: [problem],
    evaluatedProperties: new Set(),
    evaluatedItems: new Set()
  };
}

export function mergeResults(results: readonly EvaluationResult[]): EvaluationResult {
  const merged = validResult();
  for (const result of results) {
    merged.valid &&= result.valid;
    merged.issues.push(...result.issues);
    for (const key of result.evaluatedProperties) {
      merged.evaluatedProperties.add(key);
    }
    for (const index of result.evaluatedItems) {
      merged.evaluatedItems.add(index);
    }
  }
  return merged;
}

export function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

export function unicodeLength(value: string): number {
  return [...value].length;
}

export function isMultipleOf(value: number, divisor: number): boolean {
  if (divisor === 0) {
    return false;
  }
  const quotient = value / divisor;
  return (
    Math.abs(quotient - Math.round(quotient)) <=
    Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4
  );
}
