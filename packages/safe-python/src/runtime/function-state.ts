import type { CompiledFunction } from "./function-compilation.js";
import type { LexicalCell, LexicalNamespaces } from "./lexical-frame.js";
import type { ExecutionMeter } from "./execution-budget.js";
import {lookupNamespace,type NameNamespace} from "./namespace-lookup.js";

export interface FunctionCreationContext<Value> extends LexicalNamespaces<Value> {
  readonly none: Value;
  /** Adapt globals.__builtins__: actual modules use their backing dictionary;
   * other values use builtin lookup protocols. Do not validate mapping support
   * or invoke guest lookups during setup; even None may be captured until use.
   * Required only when __builtins__ is present in globals.
   */
  resolveBuiltins?(value: Value): NameNamespace<Value>;
}

/** String-name view, independent of the concrete guest dictionary machinery. */
export interface FunctionAttributes<Value> extends Iterable<readonly [string, Value]> {
  readonly size: number;
  get(name: string): Value | undefined;
  has(name: string): boolean;
  set(name: string, value: Value): void;
  delete(name: string): boolean;
}

/** Internal function payload, not a guest-accessible JavaScript object. Guest
 * descriptors validate special metadata and expose ordinary guest storage.
 * Code replacement and default/closure introspection remain runtime concerns. */
export interface FunctionState<Value> extends LexicalNamespaces<Value> {
  readonly code: CompiledFunction<Value>;
  readonly closure: ReadonlyMap<string, LexicalCell<Value>>;
  readonly defaults: ReadonlyMap<string, Value>;
  /** Lazily reflected guest containers; None is distinct from unreflected. */
  positionalDefaults?: Value;
  keywordDefaults?: Value;
  attributes: FunctionAttributes<Value>;
  name: Value;
  qualifiedName: Value;
  module: Value;
  doc: Value;
  /** Source annotations are deliberately ignored. The runtime lazily publishes
   * an empty guest dictionary for introspection; no evaluator is captured. */
  annotations?: Value;
}

/** Capture a fresh function definition around reusable code. Copy default/cell
 * containers, retaining default values, cell identities, live globals and the
 * selected builtin namespace. Module metadata comes only from globals.__name__, never class or
 * exec locals, and is captured once. Resolve globals.__builtins__ once per
 * definition when present; otherwise retain the current builtin namespace.
 * No body executes here. Guest function allocation, descriptor protocols and full
 * payload/container heap accounting remain runtime responsibilities.
 */
export function createFunctionState<Value>(
  code: CompiledFunction<Value>, defaults: ReadonlyMap<string, Value>,
  context: FunctionCreationContext<Value>, meter: ExecutionMeter
): FunctionState<Value> {
  meter.checkpoint();
  let builtins = context.builtins;
  const selectedBuiltins=lookupNamespace(context.globals,"__builtins__");
  if (selectedBuiltins!==undefined) {
    if (context.resolveBuiltins === undefined) throw new Error("builtin namespace resolution is unavailable");
    builtins = context.resolveBuiltins(selectedBuiltins.value);
    meter.checkpoint();
  }
  const closure = new Map<string, LexicalCell<Value>>();
  for (const [name, owner] of code.scope.free) {
    meter.checkpoint();
    const cell = context.closure?.get(name);
    if (cell === undefined || cell.owner !== owner) throw new Error(`missing or invalid closure cell: ${name}`);
    closure.set(name, cell);
  }
  const capturedDefaults = new Map<string, Value>();
  for (const [name, value] of defaults) { meter.checkpoint(); capturedDefaults.set(name, value); }
  meter.checkpoint();
  const module=lookupNamespace(context.globals,"__name__");
  return {
    code, globals: context.globals, builtins, closure,
    defaults: capturedDefaults, attributes: new Map(),
    name: code.name, qualifiedName: code.qualifiedName, module:module===undefined?context.none:module.value,
    doc: code.docstring === undefined ? context.none : code.docstring.value
  };
}
