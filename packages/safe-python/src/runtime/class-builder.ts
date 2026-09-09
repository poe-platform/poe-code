import { resolveClassBases, type ClassBasesContext } from "./class-bases.js";
import { prepareClass, type ClassPreparationContext } from "./class-preparation.js";
import { constructClass, type ClassConstructionContext } from "./class-construction.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LexicalCell } from "./lexical-frame.js";
import { PythonRuntimeError } from "./error.js";

export interface ClassBuilderContext<Value, Key = string> {
  /** Internal Python function flag, not a generic callability test. */
  isFunction(value: Value): boolean;
  /** Internal string flag, including subclasses; never invoke str(). */
  isString(value: Value): boolean;
  readonly bases: ClassBasesContext<Value>;
  readonly preparation: ClassPreparationContext<Value, Value, Key>;
  /** Run the function with the prepared locals namespace. Return its captured
   * class cell, or undefined for a non-cell body result. This is not an ordinary
   * function invocation: honor the body's code flags when selecting locals (an
   * explicitly supplied ordinary function can still have optimized locals).
   * Frame metadata, closure
   * handling, call-stack restoration and guest protocols belong to this adapter.
   */
  executeBody(body: Value, namespace: Value): LexicalCell<Value> | undefined;
  /** Ordinary mapping assignment to __orig_bases__, including guest effects. */
  storeOriginalBases(namespace: Value, original: Value): void;
  readonly construction: ClassConstructionContext<Value, Value, Key>;
}

/** Builtin __build_class__ lifecycle after argument collection. Validation occurs
 * before base protocols. Successful body execution precedes __orig_bases__ storage,
 * which overwrites a body-defined value only when base resolution changed the tuple.
 * No stage rolls back earlier guest effects. Decorators/binding belong to the class
 * statement. The original guest name (including string subclass identity) flows
 * through every stage. Concrete values, body frames and complete heap accounting
 * still require integration.
 */
export function buildClass<Value, Key = string>(
  positional: readonly Value[], keywords: ReadonlyMap<Key, Value>,
  context: ClassBuilderContext<Value, Key>, meter: ExecutionMeter
): Value {
  meter.checkpoint();
  if (positional.length < 2) throw new PythonRuntimeError("TypeError", "__build_class__: not enough arguments");
  if (!context.isFunction(positional[0])) throw new PythonRuntimeError("TypeError", "__build_class__: func must be a function");
  meter.checkpoint();
  const name = positional[1];
  if (!context.isString(name)) throw new PythonRuntimeError("TypeError", "__build_class__: name is not a string");
  const items: Value[] = [];
  for (let index = 2; index < positional.length; index++) { meter.checkpoint(); items.push(positional[index]); }
  meter.checkpoint();
  const original = context.bases.tuple(items);
  const resolved = resolveClassBases(original, context.bases, meter);
  const prepared = prepareClass(name, resolved.bases, keywords, context.preparation, meter);
  meter.checkpoint();
  const cell = context.executeBody(positional[0], prepared.namespace);
  if (resolved.changed) {
    meter.checkpoint();
    context.storeOriginalBases(prepared.namespace, original);
  }
  return constructClass(name, resolved.bases, prepared, cell, context.construction, meter);
}
