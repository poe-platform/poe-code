import {PythonRuntimeError} from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap, type KeyOperations} from "./ordered-key-map.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue} from "./runtime-values.js";

/** Module annotation descriptors use the visible __dict__, but initialization
 * state comes from native module storage. All hooks reenter the interpreter. */
export function installRuntimeModuleAnnotations(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, keys: KeyOperations<RuntimeValue>): void {
  const accepts = (value: RuntimeValue) => value.kind === "instance" && value.type.value.mro.includes(owner.value);
  const dictionary = (receiver: RuntimeValue, invocation: BuiltinInvocationContext | undefined) => {
    if (invocation?.attribute === undefined) throw Error("module annotations require interpreter attributes");
    const result = runtimeDictionaryPayload(invocation.attribute(receiver, "__dict__"));
    meter.checkpoint();
    if (result === undefined) throw new PythonRuntimeError("TypeError", "<module>.__dict__ is not a dictionary");
    return result.items;
  };
  owner.value.namespace.items.set(values.string("__annotations__"), values.getsetDescriptor({
    owner, name: "__annotations__", accepts,
    get(receiver, meter, invocation) {
      const items = dictionary(receiver, invocation), key = values.string("__annotations__");
      const cached = items.lookup(key);
      if (cached !== undefined) return cached.value;
      if (invocation?.attribute === undefined || invocation.truth === undefined || invocation.isCallable === undefined) throw Error("module annotations require interpreter invocation");
      let initializing = false;
      const spec = receiver.kind === "instance" ? receiver.dictionary?.items.lookup(values.string("__spec__"))?.value : undefined;
      if (spec !== undefined) {
        let flag: RuntimeValue | undefined;
        try {flag = invocation.attribute(spec, "_initializing");}
        catch (error) {if (!runtimeExceptionMatches(error, "AttributeError", invocation)) throw error;}
        if (flag !== undefined) initializing = invocation.truth(flag);
        meter.checkpoint();
      }
      const annotate = items.lookup(values.string("__annotate__"))?.value;
      let result: RuntimeValue;
      if (annotate !== undefined && invocation.isCallable(annotate)) {
        result = invocation.call(annotate, [values.integer(1)]);
        meter.checkpoint();
        if (runtimeDictionaryPayload(result) === undefined) {
          const name = diagnosticTypeName(invocation.typeName?.(result) ?? (result.kind === "none" ? "NoneType" : result.kind), meter, 100);
          throw new PythonRuntimeError("TypeError", `__annotate__ returned non-dict of type '${name}'`);
        }
      } else result = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
      if (!initializing) items.set(key, result);
      return result;
    },
    set(receiver, value, _meter, invocation) {
      const items = dictionary(receiver, invocation);
      items.set(values.string("__annotations__"), value);
      items.delete(values.string("__annotate__"));
    },
    delete(receiver, _meter, invocation) {
      const items = dictionary(receiver, invocation);
      if (!items.delete(values.string("__annotations__"))) throw new PythonRuntimeError("AttributeError", "__annotations__");
      items.delete(values.string("__annotate__"));
    }
  }));
  owner.value.namespace.items.set(values.string("__annotate__"), values.getsetDescriptor({
    owner, name: "__annotate__", accepts,
    get(receiver, _meter, invocation) {
      const items = dictionary(receiver, invocation), key = values.string("__annotate__");
      const cached = items.lookup(key);
      if (cached !== undefined) return cached.value;
      items.set(key, values.none);
      return values.none;
    },
    set(receiver, value, _meter, invocation) {
      const items = dictionary(receiver, invocation);
      if (invocation?.isCallable === undefined) throw Error("module annotations require interpreter callable checks");
      if (value.kind !== "none" && !invocation.isCallable(value)) throw new PythonRuntimeError("TypeError", "__annotate__ must be callable or None");
      items.set(values.string("__annotate__"), value);
      if (value.kind !== "none") items.delete(values.string("__annotations__"));
    },
    delete() {throw new PythonRuntimeError("TypeError", "cannot delete __annotate__ attribute");}
  }));
}
