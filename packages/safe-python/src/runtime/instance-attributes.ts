import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AttributeValue<Value> { readonly value: Value }

/** Bound descriptor slots resolved on the descriptor's TYPE, not its instance.
 * A present but non-callable guest slot must be represented by a callback that
 * raises its call error, not by an absent callback. Callback execution is owned
 * and metered by the surrounding interpreter.
 */
export interface DescriptorSlots<Instance, Value, Owner> {
  readonly get?: (instance: Instance | null, owner: Owner) => Value;
  readonly set?: (instance: Instance, value: Value) => void;
  readonly delete?: (instance: Instance) => void;
}

export interface ClassAttribute<Instance, Value, Owner> extends AttributeValue<Value> {
  readonly slots?: DescriptorSlots<Instance, Value, Owner>;
}

/** Default object lookup after class-MRO lookup. Missing-value diagnostics,
 * __getattribute__ overrides and __getattr__ fallback belong to the caller.
 */
export function readInstanceAttribute<Instance, Value, Owner>(
  instance: Instance, owner: Owner,
  attribute: ClassAttribute<Instance, Value, Owner> | undefined,
  readInstance: () => AttributeValue<Value> | undefined,
  meter?: ExecutionMeter
): AttributeValue<Value> | undefined {
  meter?.checkpoint();
  const slots = attribute?.slots;
  if (slots?.get !== undefined && (slots.set !== undefined || slots.delete !== undefined)) {
    meter?.checkpoint();
    return { value: slots.get(instance, owner) };
  }
  meter?.checkpoint();
  const stored = readInstance();
  if (stored !== undefined) return stored;
  if (slots?.get !== undefined) {
    meter?.checkpoint();
    return { value: slots.get(instance, owner) };
  }
  return attribute === undefined ? undefined : { value: attribute.value };
}

export function writeInstanceAttribute<Instance, Value, Owner>(
  instance: Instance, attribute: ClassAttribute<Instance, Value, Owner> | undefined,
  value: Value, writeInstance: (value: Value) => void, meter?: ExecutionMeter
): void {
  meter?.checkpoint();
  const slots = attribute?.slots;
  if (slots?.set !== undefined || slots?.delete !== undefined) {
    if (slots.set === undefined) throw new PythonRuntimeError("AttributeError", "__set__");
    meter?.checkpoint();
    slots.set(instance, value);
  } else {
    meter?.checkpoint();
    writeInstance(value);
  }
}

export function deleteInstanceAttribute<Instance, Value, Owner>(
  instance: Instance, attribute: ClassAttribute<Instance, Value, Owner> | undefined,
  deleteInstance: () => void, meter?: ExecutionMeter
): void {
  meter?.checkpoint();
  const slots = attribute?.slots;
  if (slots?.set !== undefined || slots?.delete !== undefined) {
    if (slots.delete === undefined) throw new PythonRuntimeError("AttributeError", "__delete__");
    meter?.checkpoint();
    slots.delete(instance);
  } else {
    meter?.checkpoint();
    deleteInstance();
  }
}
