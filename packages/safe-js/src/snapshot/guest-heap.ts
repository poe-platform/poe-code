import { getClosureOrigin, getGeneratorOrigin } from "../interp/closure-origin.js";
import { getIntrinsicIdentity } from "../interp/intrinsics.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype, hasGuestObjectState, isGuestClosure, materializeFunctionProperties } from "../interp/object-model.js";
import { isLiveCapability } from "../interp/host-capabilities.js";
import { isSandboxBox } from "../interp/boxed.js";
import { isSandboxDate } from "../interp/date.js";
import { isSandboxCollectionIterator } from "../interp/collection-iterator.js";
import { isSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import { Scope, type ScopeFrame } from "../interp/scope.js";
import { isSandboxClosure, isSandboxRegex, isSandboxMap, isSandboxSet, isSandboxPromise, isSandboxGenerator, isSandboxArguments } from "../interp/values.js";
import { serializePropertyDescriptors, type PropertyDescriptorData } from "./property-descriptors.js";
import type { CompletionResult } from "../interp/exceptions.js";
import type { GeneratorExpressionState } from "../interp/generator-expression-state.js";

export type GeneratorFinallyCompletion<T> = Omit<CompletionResult, "value" | "node" | "stackFrames"> & { value: T; nodeId?: number; stackFrames?: string[] };

export type GuestObjectState<T> = {
  properties: PropertyDescriptorData<T>;
  prototype?: T;
};

export type GuestHeapNode<T> =
  | { kind: "guest-generator"; state: "start" | "running" | "suspended" | "done"; astNodeId: number;
      async: boolean; scope: T; closureScope: T; suspendedScope?: T; yieldNodeId?: number;
      blockScopes?: Record<string, T>;
      finallyCompletions?: Record<string, GeneratorFinallyCompletion<T>>;
      expressionStates?: Record<string, GeneratorExpressionState<T>>;
      sent: Array<{ type: "normal" | "return" | "throw"; value: T }>;
      environment?: { homeObject?: T; newTarget?: T } }
  | { kind: "guest-object"; state: GuestObjectState<T> }
  | { kind: "intrinsic"; id: string; state?: GuestObjectState<T> }
  | { kind: "guest-function"; astNodeId: number; scope: T; name?: string; state: GuestObjectState<T>;
      environment?: { homeObject?: T; newTarget?: T } }
  | { kind: "scope-frame"; parent: T; importMeta: T; functionBoundary: boolean; chargeData: boolean;
      bindings: Array<[string, number]>;
      cells: Array<{ kind: ScopeFrame["cells"][number]["kind"] } & (
        { initialized: false } | { initialized: true; value: T }
      )>;
      restoredBindings?: Array<[string, T]> };

// The enclosing graph serializer allocates the reference before calling this
// function, so self-referential properties and captured environments can cycle.
export function captureGuestHeapNode<T>(value: object, encode: (value: unknown) => T): GuestHeapNode<T> | undefined {
  const intrinsic = getIntrinsicIdentity(value);
  if (intrinsic !== undefined) {
    const state = captureObjectState(value, encode);
    return { kind: "intrinsic", id: intrinsic, ...(state === undefined ? {} : { state }) };
  }
  if (value instanceof Scope) {
    const frame = value.captureFrame();
    return {
      kind: "scope-frame", parent: encode(frame.parent), importMeta: encode(frame.importMeta),
      functionBoundary: frame.functionBoundary, chargeData: frame.chargeData,
      bindings: frame.bindings,
      cells: frame.cells.map(cell => cell.initialized ? { ...cell, value: encode(cell.value) } : cell),
      ...(frame.restoredBindings === undefined ? {} : {
        restoredBindings: frame.restoredBindings.map(([name, entry]) => [name, encode(entry)] as [string, T])
      })
    };
  }
  if (isSandboxGenerator(value)) {
    const origin = getGeneratorOrigin(value);
    if (origin?.node.nodeId === undefined) throw new TypeError("Generators require a captured origin for public dumps.");
    if (origin.environment?.construction !== undefined) throw new TypeError("Active class construction environments cannot yet be serialized.");
    const channel = value.channel.snapshot();
    return {
      kind: "guest-generator", state: value.state, astNodeId: origin.node.nodeId, async: value.async === true,
      scope: encode(origin.scope), closureScope: encode(origin.closureScope),
      ...(value.state !== "suspended" || origin.suspendedScope === undefined ? {} : { suspendedScope: encode(origin.suspendedScope) }),
      ...(value.state !== "suspended" || origin.blockScopes === undefined ? {} : {
        blockScopes: Object.fromEntries([...origin.blockScopes].map(([id, scope]) => [String(id), encode(scope)]))
      }),
      ...(value.state !== "suspended" || origin.finallyCompletions === undefined ? {} : {
        finallyCompletions: Object.fromEntries([...origin.finallyCompletions].map(([id, completion]) => {
          const { node, value, stackFrames, ...metadata } = completion;
          return [String(id), { ...metadata, value: encode(value), ...(node === undefined ? {} : { nodeId: node.nodeId }),
            ...(stackFrames === undefined ? {} : { stackFrames: [...stackFrames] }) }];
        }))
      }),
      ...(value.state !== "suspended" || channel.yieldNodeId === undefined ? {} : { yieldNodeId: channel.yieldNodeId }),
      ...(value.state !== "suspended" || origin.expressionStates === undefined ? {} : {
        expressionStates: Object.fromEntries([...origin.expressionStates].map(([id, expression]) => [String(id),
          expression.kind === "binary" ? { kind: "binary", left: encode(expression.left) }
            : expression.kind === "template" ? { ...expression }
            : expression.kind === "object" ? { kind: "object", value: encode(expression.value), index: expression.index,
              ...(Object.hasOwn(expression, "key") ? { key: encode(expression.key) } : {}) }
            : expression.kind === "array" ? { kind: "array", values: encode(expression.values), index: expression.index }
            : expression.kind === "array-call" ? { kind: "array-call", target: encode(expression.target), method: expression.method, args: encode(expression.args), index: expression.index }
            : { kind: expression.kind, callee: encode(expression.callee), thisValue: encode(expression.thisValue), args: encode(expression.args), index: expression.index }]))
      }),
      sent: channel.sent.map(completion => ({ type: completion.type, value: encode(completion.value) })),
      ...(origin.environment === undefined ? {} : { environment: {
        ...(origin.environment.homeObject === undefined ? {} : { homeObject: encode(origin.environment.homeObject) }),
        ...(origin.environment.newTarget === undefined ? {} : { newTarget: encode(origin.environment.newTarget) })
      } })
    };
  }
  const origin = getClosureOrigin(value);
  if (origin === undefined) {
    if (isLiveCapability(value) || isSandboxClosure(value) || isSandboxBox(value) || isSandboxDate(value) ||
        isSandboxRegex(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxPromise(value) ||
        isSandboxGenerator(value) || isSandboxArguments(value) || isSandboxCollectionIterator(value) ||
        isSandboxRegExpIterator(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if ((prototype === null || prototype === Object.prototype) && hasGuestObjectState(value))
      return { kind: "guest-object", state: captureObjectState(value, encode)! };
    return undefined;
  }
  if (origin.node.nodeId === undefined) throw new TypeError("Guest closures require an AST node identity.");
  if (origin.environment?.construction !== undefined)
    throw new TypeError("Active class construction environments cannot yet be serialized.");
  const state = captureObjectState(value, encode);
  if (state === undefined) throw new TypeError("Guest closures require a property state.");
  return {
    kind: "guest-function", astNodeId: origin.node.nodeId, scope: encode(origin.scope), state,
    ...(isSandboxClosure(value) && value.name !== undefined ? { name: value.name } : {}),
    ...(origin.environment === undefined ? {} : { environment: {
      ...(origin.environment.homeObject === undefined ? {} : { homeObject: encode(origin.environment.homeObject) }),
      ...(origin.environment.newTarget === undefined ? {} : { newTarget: encode(origin.environment.newTarget) })
    } })
  };
}

function captureObjectState<T>(value: object, encode: (value: unknown) => T): GuestObjectState<T> | undefined {
  let properties: object | undefined = value;
  if (isSandboxClosure(value)) {
    properties = value.properties;
    if (isGuestClosure(value)) properties = materializeFunctionProperties(value);
  }
  if (properties === undefined) return undefined;
  return {
    properties: serializePropertyDescriptors(properties, encode),
    ...(hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {})
  };
}
