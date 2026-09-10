import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { getRuntimeFunctionDescriptor } from "./runtime-descriptor.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import type { NativeMethodMetadataContext } from "./runtime-native-method-metadata.js";
import type { FunctionValue, NativeDescriptorValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export type IntrinsicDescriptorKind = FunctionValue["kind"] | NativeDescriptorValue["kind"];

/** Native descriptor protocol wrappers have their own canonical defining type.
 * The wrapper performs call validation before the intrinsic receiver operation;
 * it never calls guest attributes to discover the descriptor's implementation. */
export function installRuntimeDescriptorMethods(kind: IntrinsicDescriptorKind, owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  const names = kind === "getset_descriptor" || kind === "member_descriptor" ? ["__get__", "__set__", "__delete__"] as const : ["__get__"] as const;
  for (const name of names) {
    meter.checkpoint(1, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({
      owner, name, accepts: instance => instance.kind === kind,
      invoke(instance, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (name === "__get__") {
          if (positional.length < 1) throw new PythonRuntimeError("TypeError", "__get__ expected at least 1 argument, got 0");
          if (positional.length > 2) throw new PythonRuntimeError("TypeError", `__get__ expected at most 2 arguments, got ${positional.length}`);
          const receiver = positional[0], type = positional[1] ?? values.none;
          if (instance.kind === "function") return getRuntimeFunctionDescriptor(instance, receiver, type, values, meter);
          if (instance.kind === "getset_descriptor" || instance.kind === "member_descriptor") return readRuntimeGetsetDescriptor(instance, receiver, type, meter, invocation);
          if (instance.kind === "method_descriptor" || instance.kind === "classmethod_descriptor" || instance.kind === "wrapper_descriptor") return getRuntimeMethodDescriptor(instance, receiver, type, values, meter, invocation?.actualType?.bind(invocation));
        } else {
          const count = name === "__set__" ? 2 : 1;
          if (positional.length !== count) throw new PythonRuntimeError("TypeError", name === "__set__" ? `__set__ expected 2 arguments, got ${positional.length}` : `expected 1 argument, got ${positional.length}`);
          if (instance.kind === "getset_descriptor" || instance.kind === "member_descriptor") {
            mutateRuntimeGetsetDescriptor(instance, positional[0], name === "__set__" ? { kind: "set", value: positional[1] } : { kind: "delete" }, meter, invocation);
            return values.none;
          }
        }
        throw Error("invalid intrinsic descriptor wrapper receiver");
      }
    }));
  }
}

/** Ordinary explicit protocol access, after any function dictionary shadow.
 * Native type publication/classification belongs to the execution's registry. */
export function readRuntimeDescriptorMethod(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, context?: NativeMethodMetadataContext): RuntimeValue | undefined {
  if (name !== "__get__" && name !== "__set__" && name !== "__delete__") return undefined;
  if (receiver.kind !== "function" && receiver.kind !== "method_descriptor" && receiver.kind !== "classmethod_descriptor" && receiver.kind !== "wrapper_descriptor" && receiver.kind !== "getset_descriptor" && receiver.kind !== "member_descriptor") return undefined;
  if (name !== "__get__" && receiver.kind !== "getset_descriptor" && receiver.kind !== "member_descriptor") return undefined;
  if (context?.actualType === undefined) throw Error("explicit descriptor methods require an actual type policy");
  const type = context.actualType(receiver); meter.checkpoint();
  for (const ancestor of type.value.mro) {
    meter.checkpoint();
    const found = ancestor.namespace.items.lookup(values.string(name));
    if (found === undefined) continue;
    if (found.value.kind !== "wrapper_descriptor") throw Error("intrinsic descriptor protocol wrapper is unavailable");
    return getRuntimeMethodDescriptor(found.value, receiver, type, values, meter);
  }
  return undefined;
}
