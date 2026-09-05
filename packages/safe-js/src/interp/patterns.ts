import type {
  ArrayPattern,
  AssignmentPattern,
  AssignmentProperty,
  Identifier,
  MemberExpression,
  ObjectPattern,
  ParseResult,
  RestElement,
  VariableDeclarationKind,
  VariableDeclarator
} from "../parse.js";
import type { AsyncEvaluationResult } from "./async.js";
import type { Scope } from "./scope.js";
import {
  isSandboxMap,
  isSandboxSet,
  ownEnumerableSandboxEntries,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

type Pattern = VariableDeclarator["id"] | AssignmentPattern | MemberExpression | RestElement;

export type PatternTarget = { kind: VariableDeclarationKind; initialize?: true } | { assign: true };

export type PatternContext = {
  evaluate(node: ParseResult): Promise<AsyncEvaluationResult>;
  toPropertyKey(value: SandboxValue): Promise<string>;
  getProperty(value: SandboxValue, key: string | number): SandboxValue;
  setProperty(target: SandboxValue, key: string | number, value: SandboxValue): void;
};

export type BindPatternResult =
  | { ok: true }
  | {
      ok: false;
      result: AsyncEvaluationResult;
    };

export async function bindPattern(
  pattern: Pattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  switch (pattern.type) {
    case "Identifier":
      bindIdentifier(pattern, value, target, scope);
      return { ok: true };
    case "MemberExpression":
      if ("kind" in target) {
        throw new TypeError("Destructuring declarations cannot bind to member expressions.");
      }
      return bindMemberExpression(pattern, value, scope, context);
    case "AssignmentPattern":
      return bindAssignmentPattern(pattern, value, target, scope, context);
    case "ArrayPattern":
      return bindArrayPattern(pattern, value, target, scope, context);
    case "ObjectPattern":
      return bindObjectPattern(pattern, value, target, scope, context);
    case "RestElement":
      return bindPattern(pattern.argument, value, target, scope, context);
  }
}

function bindIdentifier(
  pattern: Identifier,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope
): void {
  if ("assign" in target || (target.kind === "var" && target.initialize !== true)) {
    if ("assign" in target) {
      const binding = scope.lookup(pattern.name);
      if (!binding.found) {
        throw new ReferenceError(`Cannot assign to undeclared binding '${pattern.name}'.`);
      }
      if (binding.kind === "const") {
        throw new TypeError(`Cannot assign to const '${pattern.name}'`);
      }
    }
    scope.assign(pattern.name, value);
    return;
  }

  scope.declare(pattern.name, target.kind, value);
}

async function bindAssignmentPattern(
  pattern: AssignmentPattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  if (value !== undefined) {
    return bindPattern(pattern.left, value, target, scope, context);
  }

  const defaultValue = await context.evaluate(pattern.right);
  if (defaultValue.kind !== "normal") {
    return { ok: false, result: defaultValue };
  }

  return bindPattern(pattern.left, defaultValue.value, target, scope, context);
}

async function bindArrayPattern(
  pattern: ArrayPattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  const values = getArrayPatternValues(value);

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (element === null) {
      continue;
    }

    const elementValue =
      element.type === "RestElement" ? values.slice(index) : (values[index] as SandboxValue);
    const binding = await bindPattern(element, elementValue, target, scope, context);
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

async function bindObjectPattern(
  pattern: ObjectPattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Object destructuring declarations require a non-null object value.");
  }

  const excludedKeys = new Set<string>();
  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      const binding = await bindPattern(
        property,
        copyObjectRestValue(value, excludedKeys),
        target,
        scope,
        context
      );
      if (!binding.ok) {
        return binding;
      }
      continue;
    }

    const key = await evaluatePatternKey(property, context);
    if (!key.ok) {
      return key;
    }

    excludedKeys.add(String(key.value));
    const binding = await bindPattern(
      property.value,
      context.getProperty(value, key.value),
      target,
      scope,
      context
    );
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

async function bindMemberExpression(
  pattern: MemberExpression,
  value: SandboxValue,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  const object = await context.evaluate(pattern.object);
  if (object.kind !== "normal") {
    return { ok: false, result: object };
  }
  const property = pattern.computed
    ? await context.evaluate(pattern.property)
    : { kind: "normal" as const, value: getStaticPropertyName(pattern.property) };
  if (property.kind !== "normal") {
    return { ok: false, result: property };
  }
  if (object.value === null || object.value === undefined) {
    throw new TypeError("Cannot assign properties of null or undefined.");
  }
  if (!isIndexableValue(object.value)) {
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }

  context.setProperty(object.value, await context.toPropertyKey(property.value), value);
  return { ok: true };
}

async function evaluatePatternKey(
  property: AssignmentProperty,
  context: PatternContext
): Promise<{ ok: true; value: string | number } | { ok: false; result: AsyncEvaluationResult }> {
  return property.computed
    ? evaluateProperty(property.key, context)
    : { ok: true, value: getStaticPropertyName(property.key) };
}

async function evaluateProperty(
  property: MemberExpression["property"],
  context: PatternContext
): Promise<{ ok: true; value: string | number } | { ok: false; result: AsyncEvaluationResult }> {
  const result = await context.evaluate(property);
  if (result.kind !== "normal") {
    return { ok: false, result };
  }
  return { ok: true, value: await context.toPropertyKey(result.value) };
}

function getStaticPropertyName(property: MemberExpression["property"]): string | number {
  if (property.type === "Identifier") {
    return property.name;
  }
  if (property.type === "StringLiteral" || property.type === "NumericLiteral") {
    return property.value;
  }
  throw new TypeError(`Unsupported static property node '${property.type}'.`);
}

function getArrayPatternValues(value: unknown): SandboxArray {
  if (Array.isArray(value)) {
    return value as SandboxArray;
  }
  if (typeof value === "string") {
    return Array.from(value);
  }
  if (isSandboxMap(value)) {
    return Array.from(value.entries, ([key, entry]) => [key, entry] as SandboxArray);
  }
  if (isSandboxSet(value)) {
    return [...value.values];
  }
  if (isIterableValue(value)) {
    throw new TypeError(
      `Array destructuring declarations support only arrays and strings; received ${describeRuntimeValue(value)}.`
    );
  }
  throw new TypeError("Array destructuring declarations require an array or string iterable.");
}

function isIterableValue(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function"
  );
}

function describeRuntimeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return value.constructor?.name ?? "Object";
  return typeof value;
}

function copyObjectRestValue(
  value: Exclude<SandboxValue, null | undefined>,
  excludedKeys: ReadonlySet<string>
): SandboxObject {
  const rest = Object.create(null) as SandboxObject;
  for (const [key, entryValue] of ownEnumerableSandboxEntries(value, excludedKeys)) {
    defineProperty(rest, key, entryValue);
  }
  return rest;
}

function isIndexableValue(value: SandboxValue): value is SandboxArray | SandboxObject {
  return typeof value === "object" && value !== null;
}

function defineProperty(
  target: SandboxArray | SandboxObject,
  key: string,
  value: SandboxValue
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
