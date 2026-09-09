import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface ExceptionMatchContext<Value, Class extends object> {
  /** Internal exception-class eligibility, not guest isinstance/issubclass.
   * This can remain true even when a customized MRO omits BaseException.
   */
  exceptionClass(value: Value): Class | undefined;
  /** Borrow internal tuple storage, including tuple subclasses; never invoke
   * guest iteration, indexing, length, or instance-check overrides.
   */
  tupleItems(value: Value): readonly Value[] | undefined;
  /** Actual internal MRO, bypassing virtual subclass and attribute hooks. */
  mro(type: Class): readonly Class[];
}

/** Validate an ordinary except target before testing the raised type's MRO.
 * A matching early tuple element does not exempt later elements from validation;
 * nested tuples are invalid. Types are opaque host identities representing guest
 * classes. Concrete object metadata and temporary-set heap accounting remain
 * adapter/runtime responsibilities; every scan is cooperatively step-metered.
 */
export function matchExceptionType<Value, Class extends object>(
  raisedType: Class, handler: Value, context: ExceptionMatchContext<Value, Class>, meter: ExecutionMeter
): boolean {
  meter.checkpoint();
  const items = context.tupleItems(handler) ?? [handler];
  const candidates = new Set<Class>();
  for (let index = 0; index < items.length; index++) {
    meter.checkpoint();
    const candidate = context.exceptionClass(items[index]);
    if (candidate === undefined) throw new PythonRuntimeError("TypeError", "catching classes that do not inherit from BaseException is not allowed");
    candidates.add(candidate);
  }
  if (!candidates.size) return false;
  meter.checkpoint();
  const mro = context.mro(raisedType);
  for (let index = 0; index < mro.length; index++) {
    meter.checkpoint();
    if (candidates.has(mro[index])) return true;
  }
  return false;
}
