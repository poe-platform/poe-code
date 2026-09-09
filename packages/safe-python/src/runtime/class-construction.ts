import type { PreparedClass } from "./class-preparation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LexicalCell } from "./lexical-frame.js";
import { PythonRuntimeError } from "./error.js";

export interface ClassConstructionContext<Value> {
  call(metaclass: Value, name: string, bases: Value, namespace: Value, keywords: ReadonlyMap<string, Value>): Value;
  /** Actual type flag; do not invoke virtual instance checks. */
  isType(value: Value): boolean;
  /** Python string repr for the class name, including quote/escape selection. */
  reprName(name: string): string;
  /** Guest repr; failures replace the pending class-cell diagnostic. */
  repr(value: Value): string;
}

/** Complete class construction after successful body execution and namespace
 * metadata installation. Keep the original body-captured cell, not a fresh lookup
 * of namespace.__classcell__, which a metaclass may remove or replace. Only type
 * results require cell consistency; arbitrary non-type results remain permitted.
 * Guest type construction/__classcell__ propagation belong to the metaclass
 * adapter. Decorators, final binding, traceback and full allocation accounting
 * remain separate. Construction or formatting failure never rolls back effects.
 */
export function constructClass<Value>(
  name: string, bases: Value, prepared: PreparedClass<Value>, cell: LexicalCell<Value> | undefined,
  context: ClassConstructionContext<Value>, meter: ExecutionMeter
): Value {
  meter.checkpoint();
  const result = context.call(prepared.metaclass, name, bases, prepared.namespace, prepared.keywords);
  meter.checkpoint();
  if (cell === undefined || !context.isType(result)) return result;
  const content = cell.content;
  if (content === undefined) {
    meter.checkpoint();
    const nameRepr = context.reprName(name);
    meter.checkpoint();
    const resultRepr = context.repr(result);
    throw new PythonRuntimeError("RuntimeError", `__class__ not set defining ${nameRepr} as ${resultRepr}. Was __classcell__ propagated to type.__new__?`);
  }
  if (content.value !== result) {
    meter.checkpoint();
    const contentRepr = context.repr(content.value);
    meter.checkpoint();
    const nameRepr = context.reprName(name);
    meter.checkpoint();
    const resultRepr = context.repr(result);
    throw new PythonRuntimeError("TypeError", `__class__ set to ${contentRepr} defining ${nameRepr} as ${resultRepr}`);
  }
  return result;
}
