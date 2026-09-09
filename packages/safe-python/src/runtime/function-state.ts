import type { CompiledFunction } from "./function-compilation.js";
import type { LexicalCell, LexicalNamespaces } from "./lexical-frame.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { NameNamespace } from "./namespace-lookup.js";

export interface FunctionCreationContext<Value> extends LexicalNamespaces<Value> {
  readonly none: Value;
  /** Adapt globals.__builtins__: actual modules use their backing dictionary;
   * other values use builtin lookup protocols. Do not validate mapping support
   * or invoke guest lookups during setup; even None may be captured until use.
   * Required only when __builtins__ is present in globals.
   */
  resolveBuiltins?(value: Value): NameNamespace<Value>;
}

/** Internal function payload, not a guest-accessible JavaScript object. Guest
 * descriptors must validate writes to special metadata, translate defaults to
 * tuple/dictionary objects and expose ordinary attributes through guest storage.
 * Those protocols and __code__ replacement are not implemented by this record.
 */
export interface FunctionState<Value> extends LexicalNamespaces<Value> {
  readonly code: CompiledFunction<Value>;
  readonly closure: ReadonlyMap<string, LexicalCell<Value>>;
  readonly defaults: ReadonlyMap<string, Value>;
  readonly attributes: Map<string, Value>;
  name: Value;
  qualifiedName: Value;
  module: Value;
  doc: Value;
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
  if (context.globals.has("__builtins__")) {
    if (context.resolveBuiltins === undefined) throw new Error("builtin namespace resolution is unavailable");
    builtins = context.resolveBuiltins(context.globals.get("__builtins__")!);
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
  const module = context.globals.has("__name__") ? context.globals.get("__name__")! : context.none;
  return {
    code, globals: context.globals, builtins, closure,
    defaults: capturedDefaults, attributes: new Map(),
    name: code.name, qualifiedName: code.qualifiedName, module,
    doc: code.docstring === undefined ? context.none : code.docstring.value
  };
}
