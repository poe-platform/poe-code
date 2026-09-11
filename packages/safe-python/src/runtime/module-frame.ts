import type { ResolvedScope } from "../symbol-resolution.js";
import type {SourceSpan} from "../ast.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { lookupNamespace,storeNamespace,type MutableNameNamespace, type NameNamespace } from "./namespace-lookup.js";

export interface LocalNamespace<Value> {
  /** Perform guest mapping lookup. Only a missing-key exception becomes undefined;
   * other failures propagate. A wrapper preserves null/undefined guest values.
   */
  lookup(name: string): { readonly value: Value } | undefined;
  store(name: string, value: Value): void;
  /** Return false for a missing key; other guest failures may also be thrown. */
  delete(name: string): boolean;
  /** Host-only classification: never include implementation or execution faults. */
  isGuest(error: unknown): boolean;
}

export interface ModuleNamespaces<Value> {
  readonly globals: MutableNameNamespace<Value>;
  readonly builtins: NameNamespace<Value>;
  /** Omit for ordinary modules, whose locals are the global dictionary itself. */
  readonly locals?: LocalNamespace<Value>;
}

/** Name storage for an analyzed module or source compiled for exec. Separate
 * locals use guest mapping protocols; globals use backing dictionaries and
 * builtins support either backing dictionaries or protocol adapters.
 * CPython propagates descendant global declarations to module-level name access,
 * including declarations in code that is not executed. Do not apply that rule to
 * optimized function locals or class namespaces. Names are normalized source
 * identifiers, not arbitrary strings to normalize at lookup time.
 * Guest exec/auditing, builtin selection/insertion and full heap accounting remain
 * runtime responsibilities; this does not invoke host eval or exec.
 */
export class ModuleFrame<Value> {
  /** Last entered execution site, including a failing operation; host-only. */
  executionPosition:SourceSpan|undefined;
  readonly #explicitGlobals = new Set<string>();

  constructor(scope: ResolvedScope, private readonly namespaces: ModuleNamespaces<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint();
    if (scope.scope.kind !== "module") throw new Error("module frames require a module scope");
    const pending = [scope];
    while (pending.length) {
      meter.checkpoint();
      const current = pending.pop()!;
      for (const event of current.scope.events) {
        meter.checkpoint();
        if (event.kind === "global") this.#explicitGlobals.add(event.name);
      }
      for (const child of current.children) { meter.checkpoint(); pending.push(child); }
    }
  }

  load(name: string): Value {
    this.meter.checkpoint();
    if (!this.#explicitGlobals.has(name) && this.namespaces.locals) {
      const local = this.namespaces.locals.lookup(name);
      if (local !== undefined) return local.value;
      this.meter.checkpoint();
    }
    const global=lookupNamespace(this.namespaces.globals,name);if(global!==undefined)return global.value;
    this.meter.checkpoint();
    const builtin = lookupNamespace(this.namespaces.builtins, name);
    if (builtin !== undefined) return builtin.value;
    throw new PythonRuntimeError("NameError", `name '${name}' is not defined`);
  }

  store(name: string, value: Value): void {
    this.meter.checkpoint();
    if (!this.#explicitGlobals.has(name) && this.namespaces.locals) this.namespaces.locals.store(name, value);
    else storeNamespace(this.namespaces.globals,name,value);
  }

  delete(name: string): void {
    this.meter.checkpoint();
    const locals = this.namespaces.locals;
    if (!this.#explicitGlobals.has(name) && locals) {
      try {
        if (locals.delete(name)) return;
      } catch (error) {
        // DELETE_NAME replaces guest mapping failures, not just missing keys.
        if (error instanceof ExecutionLimitError || !locals.isGuest(error)) throw error;
      }
    } else if (this.namespaces.globals.delete(name)) return;
    throw new PythonRuntimeError("NameError", `name '${name}' is not defined`);
  }
}
