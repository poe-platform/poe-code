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
import { Budget, isFatalSandboxError } from "./budget.js";
import { retainValues } from "./resources.js";
import { hasOwnSandboxProperty } from "./globals/object.js";
import { acquireSandboxIterator, closeIterator, readIteratorResult, restoreSandboxIterator } from "./iteration.js";
import type { GeneratorExpressionState } from "./generator-expression-state.js";
import {
  type SandboxCallContext,
  ownEnumerableSandboxKeys,
  type SandboxArray,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

type Pattern = VariableDeclarator["id"] | AssignmentPattern | MemberExpression | RestElement;
export type AssignmentReference = { object: SandboxValue; key: PropertyKey };

export type PatternTarget = { kind: VariableDeclarationKind; initialize?: true } | { assign: true };

export type PatternContext = {
  restoredPatternState?(id: number): GeneratorExpressionState | undefined;
  withPatternState?(id: number, state: GeneratorExpressionState): PatternContext;
  prepareMemberReference?(pattern: MemberExpression): Promise<
    { ok: true; reference: AssignmentReference } | { ok: false; result: AsyncEvaluationResult }
  >;
  budget?: Budget;
  callContext?: SandboxCallContext;
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
  context: PatternContext,
  reference?: AssignmentReference
): Promise<BindPatternResult> {
  switch (pattern.type) {
    case "Identifier":
      bindIdentifier(pattern, value, target, scope);
      return { ok: true };
    case "MemberExpression":
      if ("kind" in target) {
        throw new TypeError("Destructuring declarations cannot bind to member expressions.");
      }
      return bindMemberExpression(pattern, value, context, reference);
    case "AssignmentPattern":
      return bindAssignmentPattern(pattern, value, target, scope, context, reference);
    case "ArrayPattern":
      return bindArrayPattern(pattern, value, target, scope, context);
    case "ObjectPattern":
      return bindObjectPattern(pattern, value, target, scope, context);
    case "RestElement":
      return bindPattern(pattern.argument, value, target, scope, context, reference);
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
  context: PatternContext,
  reference?: AssignmentReference
): Promise<BindPatternResult> {
  const saved = pattern.nodeId === undefined ? undefined : context.restoredPatternState?.(pattern.nodeId);
  if (saved !== undefined && saved.kind !== "pattern-source") throw new TypeError("Invalid pattern default continuation.");
  if (saved !== undefined) value = saved.value;
  else if (value === undefined) {
    const defaultValue = await context.evaluate(
      pattern.right,
      pattern.left.type === "Identifier" ? pattern.left.name : undefined
    );
    if (defaultValue.kind !== "normal") return { ok: false, result: defaultValue };
    value = defaultValue.value;
  }

  const bindingContext = pattern.nodeId === undefined ||
    (pattern.left.type !== "ArrayPattern" && pattern.left.type !== "ObjectPattern") ? context
    : context.withPatternState?.(pattern.nodeId, { kind: "pattern-source", value }) ?? context;
  const release = context.budget === undefined ? () => undefined : retainValues(context.budget, () => [value]);
  try {
    return await bindPattern(pattern.left, value, target, scope, bindingContext, reference);
  } finally {
    release();
  }
}

async function bindPatternValue(
  pattern: Pattern,
  readValue: () => Promise<{ value: SandboxValue }>,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext,
  onRead?: (value: SandboxValue, reference?: AssignmentReference) => void
): Promise<BindPatternResult> {
  let member = pattern;
  while (member.type === "AssignmentPattern" || member.type === "RestElement")
    member = member.type === "AssignmentPattern" ? member.left : member.argument;
  let reference: AssignmentReference | undefined;
  if ("assign" in target && member.type === "MemberExpression") {
    const prepared = await prepareMemberReference(member, context);
    if (!prepared.ok) return prepared;
    reference = prepared.reference;
  }
  let value: SandboxValue;
  const release =
    context.budget === undefined
      ? () => undefined
      : retainValues(context.budget, () => [reference?.object, reference?.key, value]);
  try {
    value = (await readValue()).value;
    onRead?.(value, reference);
    return await bindPattern(pattern, value, target, scope, context, reference);
  } finally {
    release();
  }
}

async function bindArrayPattern(
  pattern: ArrayPattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  const budget = context.budget ?? new Budget();
  const saved = pattern.nodeId === undefined ? undefined : context.restoredPatternState?.(pattern.nodeId);
  if (saved !== undefined && saved.kind !== "array-pattern") throw new TypeError("Invalid array pattern continuation.");
  const callContext = context.callContext ?? { stack: [], thisValue: undefined, getProperty: context.getProperty };
  const iterator = saved === undefined ? await acquireSandboxIterator(
    value,
    budget,
    context.callContext ?? {
      stack: [],
      thisValue: undefined,
      getProperty: context.getProperty
    }
  ) : "kind" in saved.iterator ? await restoreSandboxIterator(saved.iterator, budget, callContext) : saved.iterator;
  if (iterator === undefined) throw new TypeError("Array destructuring requires an iterable.");
  let done = saved?.done ?? false;
  const next = async (readValue = true): Promise<{ value: SandboxValue }> => {
    if (done) return { value: undefined };
    try {
      const result = await iterator.next();
      if ((typeof result !== "object" && typeof result !== "function") || result === null)
        throw new TypeError("Iterator result must be an object.");
      done = Boolean((await readIteratorResult(iterator, result, "done")).value);
      return done || !readValue
        ? { value: undefined }
        : await readIteratorResult(iterator, result, "value");
    } catch (error) {
      done = true;
      throw error;
    }
  };
  let retained: SandboxValue;
  let continuation: Extract<GeneratorExpressionState, { kind: "array-pattern" }> | undefined;
  const release = retainValues(budget, () => [value, iterator.retainedValue, retained,
    continuation?.current, continuation?.referenceObject, continuation?.referenceKey]);
  try {
    for (let index = saved?.index ?? 0; index < pattern.elements.length; index += 1) {
      const element = pattern.elements[index];
      if (element === null) {
        await next(false);
        continue;
      }

      const resuming = saved !== undefined && index === saved.index;
      const state: Extract<GeneratorExpressionState, { kind: "array-pattern" }> = {
        kind: "array-pattern", phase: "reference", index, done, current: undefined, iterator
      };
      if (resuming) Object.assign(state, saved, { iterator });
      continuation = state;
      const elementContext = pattern.nodeId === undefined ? context : context.withPatternState?.(pattern.nodeId, state) ?? context;
      const binding = resuming && saved.phase === "binding"
        ? await bindPattern(element, saved.current, target, scope, elementContext,
          Object.hasOwn(saved, "referenceObject") ? { object: saved.referenceObject, key: saved.referenceKey as PropertyKey } : undefined)
        : await bindPatternValue(
        element,
        async () => {
          if (element.type !== "RestElement") return next();
          const rest: SandboxValue[] = [];
          retained = rest;
          for (let entry = await next(); !done; entry = await next()) {
            budget.allocateArrayLength(rest.length + 1);
            rest.push(entry.value);
          }
          return { value: rest };
        },
        target,
        scope,
        elementContext,
        (current, reference) => {
          state.phase = "binding"; state.current = current; state.done = done;
          if (reference !== undefined) {
            state.referenceObject = reference.object; state.referenceKey = reference.key;
          }
        }
      );
      if (!binding.ok) {
        if (!done) {
          done = true;
          await closeIterator(iterator, binding.result.kind === "throw");
        }
        return binding;
      }
    }

    if (!done) {
      done = true;
      await closeIterator(iterator);
    }
    return { ok: true };
  } catch (error) {
    if (!done && !isFatalSandboxError(error)) await closeIterator(iterator, true);
    throw error;
  } finally {
    release();
  }
}

async function bindObjectPattern(
  pattern: ObjectPattern,
  value: SandboxValue,
  target: PatternTarget,
  scope: Scope,
  context: PatternContext
): Promise<BindPatternResult> {
  if (value === undefined || value === null) {
    throw new TypeError("Object destructuring requires a non-nullish value.");
  }

  const saved = pattern.nodeId === undefined ? undefined : context.restoredPatternState?.(pattern.nodeId);
  if (saved !== undefined && saved.kind !== "object-pattern") throw new TypeError("Invalid object pattern continuation.");
  const excludedKeys = new Set<PropertyKey>(saved?.excludedKeys as PropertyKey[] | undefined);
  const excludedKeyValues = [...excludedKeys] as SandboxValue[];
  let state: Extract<GeneratorExpressionState, { kind: "object-pattern" }> | undefined;
  const release = context.budget === undefined ? () => undefined : retainValues(context.budget,
    () => [value, state?.current, state?.key, state?.referenceObject, state?.referenceKey, ...(state?.excludedKeys ?? [])]);
  try {
    for (let index = saved?.index ?? 0; index < pattern.properties.length; index++) {
      const property = pattern.properties[index];
      state = saved !== undefined && index === saved.index ? { ...saved, excludedKeys: excludedKeyValues } : {
        kind: "object-pattern", phase: property.type === "RestElement" ? "reference" : "key",
        index, excludedKeys: excludedKeyValues, key: undefined, current: undefined
      };
      const currentState = state;
      const propertyContext = pattern.nodeId === undefined ? context : context.withPatternState?.(pattern.nodeId, state) ?? context;
      if (property.type !== "RestElement" && state.phase === "key") {
        const key = await evaluatePatternKey(property, propertyContext);
        if (!key.ok) return key;
        state.key = typeof key.value === "symbol" ? key.value : String(key.value);
        if (!excludedKeys.has(state.key)) excludedKeyValues.push(state.key);
        excludedKeys.add(state.key);
        state.phase = "reference";
      }
      const element = property.type === "RestElement" ? property : property.value;
      const binding = state.phase === "binding"
        ? await bindPattern(element, state.current, target, scope, propertyContext,
          Object.hasOwn(state, "referenceObject") ? { object: state.referenceObject, key: state.referenceKey as PropertyKey } : undefined)
        : await bindPatternValue(element,
          async () => ({ value: property.type === "RestElement"
            ? await copyObjectRestValue(value, excludedKeys, propertyContext)
            : await propertyContext.getProperty(value, currentState.key as PropertyKey) }),
          target, scope, propertyContext,
          (current, reference) => {
            currentState.current = current;
            currentState.phase = "binding";
            if (reference !== undefined) {
              currentState.referenceObject = reference.object;
              currentState.referenceKey = reference.key;
            }
          });
      if (!binding.ok) return binding;
    }
    return { ok: true };
  } finally {
    release();
  }
}

async function bindMemberExpression(
  pattern: MemberExpression,
  value: SandboxValue,
  context: PatternContext,
  reference?: AssignmentReference
): Promise<BindPatternResult> {
  if (reference === undefined) {
    const prepared = await prepareMemberReference(pattern, context);
    if (!prepared.ok) return prepared;
    reference = prepared.reference;
  }
  if (reference.object === null || reference.object === undefined) {
    throw new TypeError("Cannot assign properties of null or undefined.");
  }
  if (!isIndexableValue(reference.object)) {
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }
  await context.setProperty(reference.object, reference.key, value);
  return { ok: true };
}

async function prepareMemberReference(
  pattern: MemberExpression,
  context: PatternContext
): Promise<
  { ok: true; reference: AssignmentReference } | { ok: false; result: AsyncEvaluationResult }
> {
  if (context.prepareMemberReference !== undefined) return context.prepareMemberReference(pattern);
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
  return {
    ok: true,
    reference: { object: object.value, key: await context.toPropertyKey(property.value) }
  };
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
