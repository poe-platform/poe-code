import { manglePrivateName } from "../private-names.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import { ExecutionFrame } from "./execution-frame.js";
import type {CompiledClassBody} from "./class-compilation.js";
import {FrameLocals} from "./frame-locals.js";
import {compileCodeLocalLayout} from "./code-local-layout.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { LexicalCell, LexicalNamespaces } from "./lexical-frame.js";
import type { LocalNamespace } from "./module-frame.js";
import { lookupNamespace,storeNamespace } from "./namespace-lookup.js";

export interface ClassNamespaces<Value> extends LexicalNamespaces<Value> {
  readonly locals: LocalNamespace<Value>;
}

/** Class-body storage, not a constructed class object. Ordinary names first use
 * the prepared class mapping. Free names then use enclosing cells, even for
 * explicit nonlocal reads; nonlocal writes/deletes and all explicit global access
 * bypass the mapping. Method closures skip
 * class namespace entries. Owned construction cells stay separate from forwarded
 * free cells, even when both are named __class__. Class construction must populate
 * the owned cell and implement metadata/__classcell__ validation separately.
 * Guest mappings own internal metering; complete heap accounting remains pending.
 */
export class ClassFrame<Value> extends ExecutionFrame {
  readonly #declarations = new Map<string, "global" | "nonlocal">();
  readonly #owned = new Map<string, LexicalCell<Value>>();
  readonly #free = new Map<string, LexicalCell<Value>>();
  #reflectiveLocals:FrameLocals<Value>|undefined;

  constructor(readonly scope: ResolvedScope, readonly namespaces: ClassNamespaces<Value>, private readonly meter: ExecutionMeter,readonly code?:CompiledClassBody<Value>) {
    super();
    meter.checkpoint();
    if (scope.scope.kind !== "class") throw new Error("class frames require a class scope");
    for (const event of scope.scope.events) {
      meter.checkpoint();
      if (event.kind === "global" || event.kind === "nonlocal") this.#declarations.set(event.name, event.kind);
    }
    for (const name of scope.cells) {
      meter.checkpoint();
      this.#owned.set(name, { owner: scope.scope });
    }
    for (const [name, owner] of scope.free) {
      meter.checkpoint();
      const cell = namespaces.closure?.get(name);
      if (!cell || cell.owner !== owner) throw new Error(`missing or invalid closure cell: ${name}`);
      this.#free.set(name, cell);
    }
  }

  /** Explicit proxies share closure cells but do not mirror the class mapping. */
  reflectLocals():FrameLocals<Value> {
    this.meter.checkpoint();
    if(this.#reflectiveLocals===undefined){
      this.meter.checkpoint(0,96);
      this.#reflectiveLocals=new FrameLocals(compileCodeLocalLayout(this.scope,this.meter),new Map(),this.#owned,this.meter,true,[],this.#free);
    }
    return this.#reflectiveLocals;
  }

  /** Host-only cell reference for class construction, not a guest attribute. */
  get classCell(): LexicalCell<Value> | undefined { return this.#owned.get("__class__"); }

  #key(name: string): string {
    this.meter.checkpoint();
    return manglePrivateName(name, this.scope.scope.privateName);
  }

  #missingFree(name: string): never {
    throw new PythonRuntimeError("NameError", `cannot access free variable '${name}' where it is not associated with a value in enclosing scope`);
  }

  load(name: string): Value {
    const key = this.#key(name), declaration = this.#declarations.get(key);
    if (declaration !== "global") {
      const local = this.namespaces.locals.lookup(key);
      if (local !== undefined) return local.value;
      this.meter.checkpoint();
    }
    if (this.scope.bindings.get(key)?.kind === "free") {
      const cell = this.#free.get(key)!;
      return cell.content !== undefined ? cell.content.value : this.#missingFree(key);
    }
    const global=lookupNamespace(this.namespaces.globals,key,declaration!=="global"?"intrinsic":undefined);if(global!==undefined)return global.value;
    this.meter.checkpoint();
    const builtin = lookupNamespace(this.namespaces.builtins, key);
    if (builtin !== undefined) return builtin.value;
    throw new PythonRuntimeError("NameError", `name '${key}' is not defined`);
  }

  store(name: string, value: Value): void {
    const key = this.#key(name), declaration = this.#declarations.get(key);
    if (declaration === "nonlocal") this.#free.get(key)!.content = { value };
    else if (declaration === "global") storeNamespace(this.namespaces.globals,key,value);
    else this.namespaces.locals.store(key, value);
  }

  delete(name: string): void {
    const key = this.#key(name), declaration = this.#declarations.get(key);
    if (declaration === "nonlocal") {
      const cell = this.#free.get(key)!;
      if (cell.content === undefined) this.#missingFree(key);
      cell.content = undefined;
      return;
    }
    if (declaration === "global") {
      if (this.namespaces.globals.delete(key)) return;
    } else {
      try {
        if (this.namespaces.locals.delete(key)) return;
      } catch (error) {
        if (error instanceof ExecutionLimitError || !this.namespaces.locals.isGuest(error)) throw error;
      }
    }
    throw new PythonRuntimeError("NameError", `name '${key}' is not defined`);
  }

  /** Capture cell identities for a directly nested scope, never class attributes. */
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
      const cell = (owner === this.scope.scope ? this.#owned : this.#free).get(name);
      if (!cell || cell.owner !== owner) throw new Error(`missing or invalid closure cell: ${name}`);
      closure.set(name, cell);
    }
    return closure;
  }
}
