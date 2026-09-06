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
import type { Budget } from "./budget.js";
import { retainValues } from "./resources.js";
import { hasOwnSandboxProperty } from "./globals/object.js";
import { isSandboxCollectionIterator, nextCollectionIterator } from "./collection-iterator.js";
import {
  isSandboxMap,
  isSandboxSet,
  ownEnumerableSandboxKeys,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

type Pattern = VariableDeclarator["id"] | AssignmentPattern | MemberExpression | RestElement;

export type PatternTarget = { kind: VariableDeclarationKind; initialize?: true } | { assign: true };

export type PatternContext = {
  budget?: Budget;
  evaluate(node: ParseResult, inferredName?: string): Promise<AsyncEvaluationResult>;
  toPropertyKey(value: SandboxValue): string | symbol | Promise<string | symbol>;
  getProperty(value: SandboxValue, key: PropertyKey): SandboxValue | Promise<SandboxValue>;
  setProperty(target: SandboxValue, key: PropertyKey, value: SandboxValue): void | Promise<void>;
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

  const defaultValue = await context.evaluate(
    pattern.right,
    pattern.left.type === "Identifier" ? pattern.left.name : undefined
  );
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
  const iterator = isSandboxCollectionIterator(value) ? value : undefined;
  const values = iterator === undefined ? getArrayPatternValues(value) : undefined;
  let cursor = 0;
  let done = false;
  const next = async (): Promise<IteratorResult<SandboxValue>> => {
    if (iterator !== undefined) return nextCollectionIterator(iterator, context.budget);
    if (done || cursor >= values!.length) {
      done = true;
      return { done: true, value: undefined };
    }
    return { done: false, value: await context.getProperty(values!, cursor++) };
  };

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (element === null) {
      await next();
      continue;
    }

    let elementValue: SandboxValue;
    if (element.type === "RestElement") {
      const rest: SandboxValue[] = [];
      for (let entry = await next(); !entry.done; entry = await next()) {
        context.budget?.allocateArrayLength(rest.length + 1);
        rest.push(entry.value);
      }
      elementValue = rest;
    } else {
      elementValue = (await next()).value;
    }
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

  const excludedKeys = new Set<PropertyKey>();
  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      const binding = await bindPattern(
        property,
        await copyObjectRestValue(value, excludedKeys, context),
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

    excludedKeys.add(typeof key.value === "symbol" ? key.value : String(key.value));
    const binding = await bindPattern(
      property.value,
      await context.getProperty(value, key.value),
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

  await context.setProperty(object.value, await context.toPropertyKey(property.value), value);
  return { ok: true };
}

async function evaluatePatternKey(
  property: AssignmentProperty,
  context: PatternContext
): Promise<{ ok: true; value: PropertyKey } | { ok: false; result: AsyncEvaluationResult }> {
  return property.computed
    ? evaluateProperty(property.key, context)
    : { ok: true, value: getStaticPropertyName(property.key) };
}

async function evaluateProperty(
  property: MemberExpression["property"],
  context: PatternContext
): Promise<{ ok: true; value: PropertyKey } | { ok: false; result: AsyncEvaluationResult }> {
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

async function copyObjectRestValue(
  value: Exclude<SandboxValue, null | undefined>,
  excludedKeys: ReadonlySet<PropertyKey>,
  context: PatternContext
): Promise<SandboxObject> {
  const rest = Object.create(null) as SandboxObject;
  const release =
    context.budget === undefined
      ? () => undefined
      : retainValues(context.budget, () => [value, rest]);
  try {
    for (const key of ownEnumerableSandboxKeys(value, true)) {
      if (excludedKeys.has(key) || !hasOwnSandboxProperty(value, key, true)) continue;
      defineProperty(rest, key, await context.getProperty(value, key));
    }
    return rest;
  } finally {
    release();
  }
}

function isIndexableValue(value: SandboxValue): value is SandboxArray | SandboxObject {
  return typeof value === "object" && value !== null;
}

function defineProperty(
  target: SandboxArray | SandboxObject,
  key: PropertyKey,
  value: SandboxValue
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
