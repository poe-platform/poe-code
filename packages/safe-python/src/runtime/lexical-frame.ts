import { manglePrivateName } from "../private-names.js";
import type { SymbolScope } from "../symbol-collection.js";
import type { ResolvedBinding, ResolvedScope } from "../symbol-resolution.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { lookupNamespace,storeNamespace,type MutableNameNamespace, type NameNamespace } from "./namespace-lookup.js";
import { PythonRuntimeError } from "./error.js";
import {compileFunctionLocalLayout,type FunctionLocalLayout} from "./function-local-layout.js";
import {FrameLocals} from "./frame-locals.js";

/** Internal shared storage, never a guest-accessible JavaScript object. The
 * wrapper distinguishes an unbound cell from any valid Value, including undefined.
 */
export interface CellStorage<Value> {
  content?: { readonly value: Value };
}

/** Lexical capture adds compiler ownership; standalone guest cells need no scope. */
export interface LexicalCell<Value> extends CellStorage<Value> {
  readonly owner: SymbolScope;
}

export interface LexicalNamespaces<Value> {
  /** Backing dictionary storage; not guest mapping protocol objects. */
  readonly globals: MutableNameNamespace<Value>;
  /** The defining function's selected builtin namespace, not a fresh lookup of
   * globals.__builtins__ on each name access. Its contents/protocol remain live.
   */
  readonly builtins: NameNamespace<Value>;
  readonly closure?: ReadonlyMap<string, LexicalCell<Value>>;
}

/** Storage for analyzed optimized scopes. A fresh instance represents one call
 * or comprehension activation; shared closure cells outlive their owning frame.
 * Names are normalized identifiers and are mangled in their lexical class scope.
 * Module/class and dynamic exec namespaces have different lookup rules and are
 * intentionally separate. This is not a guest frame object or locals() proxy.
 * Step limits are enforced; complete frame/cell heap accounting remains pending.
 */
export class LexicalFrame<Value> {
  readonly #locals = new Map<string, Value>();
  readonly #cells = new Map<string, LexicalCell<Value>>();
  #reflectiveLocals:FrameLocals<Value>|undefined;

  constructor(
    readonly scope: ResolvedScope,
    private readonly namespaces: LexicalNamespaces<Value>,
    private readonly meter: ExecutionMeter,
    private readonly localLayout?:FunctionLocalLayout
  ) {
    meter.checkpoint();
    if (scope.scope.kind !== "function" && scope.scope.kind !== "lambda" && scope.scope.kind !== "comprehension")
      throw new Error("lexical frames require a function, lambda or comprehension scope");
    for (const name of scope.cells) {
      meter.checkpoint();
      this.#cells.set(name, { owner: scope.scope });
    }
    for (const [name, owner] of scope.free) {
      meter.checkpoint();
      const cell = namespaces.closure?.get(name);
      if (!cell || cell.owner !== owner) throw new Error(`missing or invalid closure cell: ${name}`);
      this.#cells.set(name, cell);
    }
  }

  /** Shared internal storage, not a cached guest f_locals proxy. Reflection is
   * lazy and normal name access does not pay its indexing/allocation costs. */
  reflectLocals():FrameLocals<Value> {
    this.meter.checkpoint();
    if(this.#reflectiveLocals===undefined)this.#reflectiveLocals=new FrameLocals(this.localLayout??compileFunctionLocalLayout(this.scope,this.meter),this.#locals,this.#cells,this.meter);
    return this.#reflectiveLocals;
  }

  #resolve(name: string): readonly [string, ResolvedBinding] {
    this.meter.checkpoint();
    const key = manglePrivateName(name, this.scope.scope.privateName);
    const binding = this.scope.bindings.get(key);
    if (!binding) throw new Error(`name was not resolved: ${key}`);
    return [key, binding];
  }

  #missing(name: string, kind: ResolvedBinding["kind"]): never {
    if (kind === "local")
      throw new PythonRuntimeError("UnboundLocalError", `cannot access local variable '${name}' where it is not associated with a value`);
    throw new PythonRuntimeError("NameError", kind === "free"
      ? `cannot access free variable '${name}' where it is not associated with a value in enclosing scope`
      : `name '${name}' is not defined`);
  }

  load(name: string): Value {
    const [key, binding] = this.#resolve(name);
    if (binding.kind === "global") {
      const global=lookupNamespace(this.namespaces.globals,key);if(global!==undefined)return global.value;
      const builtin = lookupNamespace(this.namespaces.builtins, key);
      if (builtin !== undefined) return builtin.value;
    } else {
      const cell = this.#cells.get(key);
      if (cell) {
        if (cell.content !== undefined) return cell.content.value;
      } else if (this.#locals.has(key)) return this.#locals.get(key)!;
    }
    return this.#missing(key, binding.kind);
  }

  store(name: string, value: Value): void {
    const [key, binding] = this.#resolve(name);
    if (binding.kind === "global") storeNamespace(this.namespaces.globals,key,value);
    else {
      const cell = this.#cells.get(key);
      if (cell) cell.content = { value };
      else this.#locals.set(key, value);
    }
  }

  delete(name: string): void {
    const [key, binding] = this.#resolve(name);
    if (binding.kind === "global") {
      if (this.namespaces.globals.delete(key)) return;
    } else {
      const cell = this.#cells.get(key);
      if (cell) {
        if (cell.content !== undefined) { delete cell.content; return; }
      } else if (this.#locals.delete(key)) return;
    }
    this.#missing(key, binding.kind);
  }

  /** Snapshot the cell references needed by a directly nested scope, not values.
   * Includes transitively forwarded cells even when this scope never reads them.
   */
  capture(child: ResolvedScope): ReadonlyMap<string, LexicalCell<Value>> {
    this.meter.checkpoint();
    let found = false;
    for (const candidate of this.scope.children) {
      this.meter.checkpoint();
      if (candidate === child) { found = true; break; }
    }
    if (!found) throw new Error("cannot capture an unrelated scope");
    const closure = new Map<string, LexicalCell<Value>>();
    for (const [name, owner] of child.free) {
      this.meter.checkpoint();
      const cell = this.#cells.get(name);
      if (!cell || cell.owner !== owner) throw new Error(`missing or invalid closure cell: ${name}`);
      closure.set(name, cell);
    }
    return closure;
  }
}
