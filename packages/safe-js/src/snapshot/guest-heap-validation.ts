import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { getIntrinsicIdentity, listIntrinsicIdentities, resolveIntrinsicIdentity } from "../interp/intrinsics.js";
import { releaseObjectPrototype } from "../interp/object-model.js";
import { isSandboxClosure } from "../interp/values.js";

let intrinsicKinds: Map<string, boolean> | undefined;

function intrinsicCatalogue(): Map<string, boolean> {
  if (intrinsicKinds !== undefined) return intrinsicKinds;
  const budget = new Budget();
  try {
    createBuiltinBindings({ budget });
    const kinds = new Map<string, boolean>();
    for (const id of listIntrinsicIdentities(budget)) {
      const value = resolveIntrinsicIdentity(budget, id);
      if (getIntrinsicIdentity(value) === id) kinds.set(id, isSandboxClosure(value));
    }
    intrinsicKinds = kinds;
    return kinds;
  } finally { releaseObjectPrototype(budget); }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a guest heap record.");
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Reflect.ownKeys(value).some(key =>
    typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
    !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new TypeError("Invalid guest heap fields.");
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a guest heap array.");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid guest heap index.");
  return value;
}

function absent(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const node = record(value);
  return node.kind === "undefined" && Object.keys(node).length === 1;
}

export function validateGuestHeapNode(raw: unknown, heap: Record<string, unknown>): boolean {
  const node = record(raw);
  if (!["intrinsic", "guest-function", "guest-generator", "scope-frame", "guest-object"].includes(String(node.kind))) return false;
  const reference = (value: unknown, kinds?: string[]) => {
    const ref = record(value);
    fields(ref, ["kind", "id"]);
    if (ref.kind !== "ref" || integer(ref.id) < 1 || !Object.hasOwn(heap, String(ref.id))) throw new TypeError("Invalid guest heap reference.");
    const target = record(heap[String(ref.id)]);
    if (kinds !== undefined && !kinds.includes(String(target.kind))) throw new TypeError("Wrong guest heap reference kind.");
    return target;
  };
  const callable = (value: unknown) => {
    if (absent(value)) return;
    const target = reference(value, ["intrinsic", "guest-function"]);
    if (target.kind === "intrinsic" && intrinsicCatalogue().get(String(target.id)) !== true)
      throw new TypeError("Guest accessor reference is not callable.");
  };
  const state = (value: unknown) => {
    const object = record(value);
    fields(object, ["properties"], ["prototype"]);
    if (Object.hasOwn(object, "prototype") && object.prototype !== null) reference(object.prototype);
    const properties = record(object.properties);
    fields(properties, ["properties", "extensible"]);
    if (typeof properties.extensible !== "boolean") throw new TypeError("Invalid guest extensibility.");
    const keys = new Set<string>();
    for (const rawEntry of array(properties.properties)) {
      const entry = array(rawEntry);
      if (entry.length !== 2) throw new TypeError("Invalid guest property entry.");
      let key: string;
      if (typeof entry[0] === "string") key = `string:${entry[0]}`;
      else {
        const symbol = reference(entry[0], ["symbol"]);
        key = symbol.wellKnown === undefined ? `symbol:${record(entry[0]).id}` : `well-known:${symbol.wellKnown}`;
      }
      if (keys.has(key)) throw new TypeError("Duplicate guest property key.");
      keys.add(key);
      const descriptor = record(entry[1]);
      if (descriptor.kind === "data") {
        fields(descriptor, ["kind", "value", "writable", "enumerable", "configurable"]);
        if (typeof descriptor.writable !== "boolean") throw new TypeError("Invalid guest writable flag.");
      } else if (descriptor.kind === "accessor") {
        fields(descriptor, ["kind", "get", "set", "enumerable", "configurable"]);
        callable(descriptor.get);
        callable(descriptor.set);
      } else throw new TypeError("Invalid guest descriptor kind.");
      if (typeof descriptor.enumerable !== "boolean" || typeof descriptor.configurable !== "boolean") throw new TypeError("Invalid guest descriptor flags.");
    }
  };
  if (node.kind === "intrinsic") {
    fields(node, ["kind", "id"], ["state"]);
    if (typeof node.id !== "string" || !intrinsicCatalogue().has(node.id)) throw new TypeError("Unknown intrinsic identity.");
    if (Object.hasOwn(node, "state")) state(node.state);
  } else if (node.kind === "guest-object") {
    fields(node, ["kind", "state"]);
    state(node.state);
  } else if (node.kind === "guest-function") {
    fields(node, ["kind", "astNodeId", "scope", "state"], ["name", "environment"]);
    if (integer(node.astNodeId) < 1) throw new TypeError("Invalid guest AST identity.");
    reference(node.scope, ["scope-frame"]);
    if (Object.hasOwn(node, "name") && typeof node.name !== "string") throw new TypeError("Invalid guest function name.");
    if (Object.hasOwn(node, "environment")) {
      const environment = record(node.environment);
      fields(environment, [], ["homeObject", "newTarget"]);
      if (Object.hasOwn(environment, "homeObject")) reference(environment.homeObject);
      if (Object.hasOwn(environment, "newTarget")) callable(environment.newTarget);
    }
    state(node.state);
  } else if (node.kind === "guest-generator") {
    fields(node, ["kind", "state", "astNodeId", "async", "scope", "closureScope", "sent"], ["suspendedScope", "yieldNodeId", "environment", "blockScopes", "finallyCompletions", "expressionStates"]);
    if (!["start", "running", "suspended", "done"].includes(String(node.state)) || typeof node.async !== "boolean" || integer(node.astNodeId) < 1)
      throw new TypeError("Invalid generator state.");
    reference(node.scope, ["scope-frame"]);
    reference(node.closureScope, ["scope-frame"]);
    if (Object.hasOwn(node, "suspendedScope")) reference(node.suspendedScope, ["scope-frame"]);
    if (Object.hasOwn(node, "blockScopes")) {
      for (const [id, scope] of Object.entries(record(node.blockScopes))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid generator block identity.");
        reference(scope, ["scope-frame"]);
      }
    }
    if (Object.hasOwn(node, "expressionStates")) {
      for (const [id, raw] of Object.entries(record(node.expressionStates))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid expression identity.");
        const expression = record(raw);
        if (expression.kind === "binary") {
          fields(expression, ["kind", "left"]);
        } else if (expression.kind === "template") {
          fields(expression, ["kind", "prefix", "index"]);
          integer(expression.index);
          if (typeof expression.prefix !== "string") throw new TypeError("Invalid template prefix.");
        } else if (expression.kind === "object") {
          fields(expression, ["kind", "value", "index"], ["key"]);
          integer(expression.index);
          reference(expression.value, ["object", "guest-object"]);
        } else if (expression.kind === "array") {
          fields(expression, ["kind", "values", "index"]);
          integer(expression.index);
          reference(expression.values, ["array"]);
        } else if (expression.kind === "call" || expression.kind === "new" || expression.kind === "tagged") {
          fields(expression, ["kind", "callee", "thisValue", "args", "index"]);
          integer(expression.index);
          reference(expression.args, ["array"]);
        } else if (expression.kind === "array-call") {
          fields(expression, ["kind", "target", "method", "args", "index"]);
          if (typeof expression.method !== "string") throw new TypeError("Invalid array method.");
          integer(expression.index);
          reference(expression.args, ["array"]);
          reference(expression.target, ["array"]);
        } else throw new TypeError("Invalid expression continuation.");
      }
    }
    if (Object.hasOwn(node, "finallyCompletions")) {
      for (const [id, raw] of Object.entries(record(node.finallyCompletions))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid finally identity.");
        const completion = record(raw);
        fields(completion, ["kind", "hasValue", "value"], ["nodeId", "label", "span", "stackFrames"]);
        if (!["normal", "return", "throw", "break", "continue"].includes(String(completion.kind)) || typeof completion.hasValue !== "boolean")
          throw new TypeError("Invalid finally completion.");
        if (Object.hasOwn(completion, "nodeId") && integer(completion.nodeId) < 1) throw new TypeError("Invalid completion node identity.");
        if (Object.hasOwn(completion, "label") && typeof completion.label !== "string") throw new TypeError("Invalid completion label.");
        if (Object.hasOwn(completion, "stackFrames") && array(completion.stackFrames).some(value => typeof value !== "string")) throw new TypeError("Invalid completion stack.");
      }
    }
    if (Object.hasOwn(node, "yieldNodeId") && integer(node.yieldNodeId) < 1) throw new TypeError("Invalid generator yield identity.");
    if (node.state === "suspended" && (!Object.hasOwn(node, "yieldNodeId") || !Object.hasOwn(node, "suspendedScope"))) throw new TypeError("Missing suspended generator state.");
    for (const rawCompletion of array(node.sent)) {
      const completion = record(rawCompletion);
      fields(completion, ["type", "value"]);
      if (!["normal", "return", "throw"].includes(String(completion.type))) throw new TypeError("Invalid generator completion type.");
    }
    if (Object.hasOwn(node, "environment")) {
      const environment = record(node.environment);
      fields(environment, [], ["homeObject", "newTarget"]);
      if (Object.hasOwn(environment, "homeObject")) reference(environment.homeObject);
      if (Object.hasOwn(environment, "newTarget")) callable(environment.newTarget);
    }
  } else {
    fields(node, ["kind", "parent", "importMeta", "functionBoundary", "chargeData", "bindings", "cells"], ["restoredBindings"]);
    if (!absent(node.parent)) reference(node.parent, ["scope-frame"]);
    if (typeof node.functionBoundary !== "boolean" || typeof node.chargeData !== "boolean") throw new TypeError("Invalid guest frame flags.");
    const cells = array(node.cells);
    for (const rawCell of cells) {
      const cell = record(rawCell);
      if (typeof cell.initialized !== "boolean" || !["var", "let", "const"].includes(String(cell.kind))) throw new TypeError("Invalid guest binding cell.");
      fields(cell, cell.initialized ? ["kind", "initialized", "value"] : ["kind", "initialized"]);
    }
    const names = new Set<string>();
    const used = new Set<number>();
    for (const rawBinding of array(node.bindings)) {
      const binding = array(rawBinding);
      if (binding.length !== 2 || typeof binding[0] !== "string" || names.has(binding[0])) throw new TypeError("Invalid guest binding name.");
      const id = integer(binding[1]);
      if (id >= cells.length) throw new TypeError("Unknown guest binding cell.");
      names.add(binding[0]); used.add(id);
    }
    if (used.size !== cells.length) throw new TypeError("Unreferenced guest binding cell.");
    if (Object.hasOwn(node, "restoredBindings")) {
      if (!absent(node.parent)) throw new TypeError("Only root scopes own pending restored bindings.");
      const restoredNames = new Set<string>();
      for (const rawBinding of array(node.restoredBindings)) {
        const binding = array(rawBinding);
        if (binding.length !== 2 || typeof binding[0] !== "string" || restoredNames.has(binding[0])) throw new TypeError("Invalid restored binding.");
        restoredNames.add(binding[0]);
      }
    }
  }
  return true;
}

export function validateGuestScopeParents(heap: Record<string, unknown>): void {
  const finished = new Set<string>();
  for (const [id, raw] of Object.entries(heap)) {
    if (record(raw).kind !== "scope-frame" || finished.has(id)) continue;
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !finished.has(current)) {
      if (path.has(current)) throw new TypeError("Cyclic guest scope parent graph.");
      path.add(current);
      const parent: unknown = record(heap[current]).parent;
      current = absent(parent) ? undefined : String(record(parent).id);
    }
    for (const visited of path) finished.add(visited);
  }
}
