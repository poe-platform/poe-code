import type { ExecutionMeter } from "./execution-budget.js";
import { callRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Stable dictionary descriptors retain native storage and active key policies. */
export function installRuntimeDictionaryMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const [name, doc] of [
    ["get", "Return the value for key if key is in the dictionary, else default."],
    ["copy", "Return a shallow copy of the dict."],
    ["keys", "Return a set-like object providing a view on the dict's keys."],
    ["values", "Return an object providing a view on the dict's values."],
    ["items", "Return a set-like object providing a view on the dict's items."],
    ["__reversed__", "Return a reverse iterator over the dict keys."]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => runtimeDictionaryPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation, bound) {
        const payload = runtimeDictionaryPayload(receiver);
        if (payload === undefined) throw Error("dictionary method requires dictionary storage");
        return callRuntimeDictionaryMethod(payload, name, positional, keywords, values, meter, invocation, receiver, bound === true);
      }
    }));
  }
  for (const [name, doc] of [
    ["clear", "Remove all items from the dict."],
    ["pop", "D.pop(k[,d]) -> v, remove specified key and return the corresponding value.\n\nIf the key is not found, return the default if given; otherwise,\nraise a KeyError."],
    ["popitem", "Remove and return a (key, value) pair as a 2-tuple.\n\nPairs are returned in LIFO (last-in, first-out) order.\nRaises KeyError if the dict is empty."],
    ["setdefault", "Insert key with a value of default if key is not in the dictionary.\n\nReturn the value for key if key is in the dictionary, else default."],
    ["update", "D.update([E, ]**F) -> None.  Update D from mapping/iterable E and F.\nIf E is present and has a .keys() method, then does:  for k in E.keys(): D[k] = E[k]\nIf E is present and lacks a .keys() method, then does:  for k, v in E: D[k] = v\nIn either case, this is followed by: for k in F:  D[k] = F[k]"]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => runtimeDictionaryPayload(receiver) !== undefined,
      ...(name === "update" ? { boundKeywordValidation: "callee" as const } : {}),
      invoke(receiver, positional, keywords, meter, invocation, bound) {
        const payload = runtimeDictionaryPayload(receiver);
        if (payload === undefined) throw Error("dictionary method requires dictionary storage");
        const method = createRuntimeDictionaryMutationMethod(payload, name, values, meter, bound ? receiver : payload);
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}
