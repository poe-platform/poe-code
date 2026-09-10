import type { Budget } from "./budget.js";
import { registerFunctionRealm, registerRealmPrototype } from "./function-realm.js";
import { accessorClosure } from "./accessors.js";
import { wellKnownSymbols } from "./symbols.js";
import { internalSymbols } from "./internal-symbols.js";
import { isSandboxClosure } from "./values.js";
import type { SandboxObject } from "./values.js";

const identities = new WeakMap<object, string>();
const realms = new WeakMap<Budget, Map<string, object>>();
const runtimeGlobals = new WeakMap<Budget, SandboxObject>();
const runtimeEvaluators = new WeakMap<Budget, object>();
export const mutableBuiltinBindings = new WeakMap<object, ReadonlySet<string>>();
export const builtinGlobalObjects = new WeakMap<object, SandboxObject>();

// Paths encode trusted installation sites, never guest-visible function names.
// Keeping identity separate from the realm map allows completed dumps after close.
export function registerBuiltinIdentities(
  budget: Budget,
  bindings: Record<string, unknown>
): void {
  let realm = realms.get(budget);
  if (realm === undefined) realms.set(budget, realm = new Map());
  type Path = Array<string | { symbol: string }>;
  const pending: Array<[Path, unknown]> = Object.entries(bindings).map(([name, value]) => [[name], value]);
  const visited = new WeakSet<object>();
  for (let index = 0; index < pending.length; index++) {
    const [path, value] = pending[index];
    if (value === null || typeof value !== "object") continue;
    if (isSandboxClosure(value)) registerFunctionRealm(value, budget);
    if (path.length >= 2 && path.at(-1) === "prototype" && path.every(member => typeof member === "string"))
      registerRealmPrototype(budget, path.slice(0, -1).join("."), value);
    const id = JSON.stringify(path);
    const previous = realm.get(id);
    if (previous !== undefined && previous !== value)
      throw new TypeError(`Duplicate intrinsic identity: ${id}`);
    realm.set(id, value);
    if (path.length === 1 && path[0] === "globalThis") runtimeGlobals.set(budget, value as SandboxObject);
    if (path.length === 1 && path[0] === "eval") runtimeEvaluators.set(budget, value);
    if (!identities.has(value)) identities.set(value, id);
    if (visited.has(value)) continue;
    visited.add(value);
    const owner = isSandboxClosure(value) ? value.properties : value;
    if (owner === undefined) continue;
    for (const key of Reflect.ownKeys(owner)) {
      if (typeof key === "symbol" && internalSymbols.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
      const symbolName = typeof key === "symbol"
        ? Object.entries(wellKnownSymbols).find(([, symbol]) => symbol === key)?.[0]
        : undefined;
      if (typeof key === "symbol" && symbolName === undefined)
        throw new TypeError("Intrinsic symbol keys must be well-known symbols.");
      if ("value" in descriptor && (descriptor.value === null || typeof descriptor.value !== "object")) continue;
      const member = [...path, typeof key === "string" ? key : { symbol: symbolName! }];
      if ("value" in descriptor) {
        pending.push([member, descriptor.value]);
        continue;
      }
      for (const kind of ["get", "set"] as const) {
        const closure = accessorClosure(descriptor[kind]);
        if (closure !== undefined) pending.push([[...member, kind], closure]);
      }
    }
  }
}

export function getIntrinsicIdentity(value: object): string | undefined {
  return identities.get(value);
}

export function resolveIntrinsicIdentity(budget: Budget, id: string): object {
  const value = realms.get(budget)?.get(id);
  if (value === undefined) throw new TypeError(`Unknown intrinsic identity: ${id}`);
  return value;
}

export function listIntrinsicIdentities(budget: Budget): string[] {
  return [...(realms.get(budget)?.keys() ?? [])];
}

export function releaseIntrinsicIdentities(budget: Budget): void {
  realms.delete(budget);
}

// Runtime global access outlives the snapshot-resolution table when an SDK
// caller retains a guest closure. The visible globalThis binding may be changed.
export function getRealmGlobalObject(budget: Budget): SandboxObject {
  const global = runtimeGlobals.get(budget);
  if (global === undefined) throw new TypeError("Realm global object is not installed.");
  return global;
}

export function isRealmEval(value: object, budget: Budget): boolean {
  return runtimeEvaluators.get(budget) === value;
}
