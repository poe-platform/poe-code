import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import { checkTypedArrayAllocation, nativeTypedArrayView, requireUint8Array, typedArrayStorage } from "../typed-array.js";
import { typedArrayPrototypes } from "../typed-array-prototypes.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";

export function createTextEncoderGlobal(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const instances = new WeakSet<object>();
  const encoder = new TextEncoder();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "TextEncoder", length: 0,
    call: () => { throw new TypeError("TextEncoder requires new."); },
    construct: async (_args, context) => {
      let selected: SandboxValue;
      const release = retainValues(budget, () => [selected]);
      try {
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "TextEncoder", prototype);
        const result = createIntrinsicObject();
        setSandboxPrototype(result, selected, budget);
        instances.add(result);
        return allocateProducedSandboxValue(result, budget);
      } finally { release(); }
    },
  });
  const encoding = createSandboxClosure({
    guest: true, sandbox: true, name: "get encoding", length: 0,
    call: (_args, context) => {
      if (!instances.has(context?.thisValue as object)) throw new TypeError("Incompatible TextEncoder receiver.");
      return "utf-8";
    },
  });
  const methods = ["encode", "encodeInto"].map(name => createSandboxClosure({
    guest: true, sandbox: true, name, length: name === "encode" ? 0 : 2,
    call: async (args, context) => {
      const receiver = context?.thisValue;
      if (!instances.has(receiver as object)) throw new TypeError("Incompatible TextEncoder receiver.");
      const release = retainValues(budget, () => [receiver, ...args]);
      try {
        const text = budget.allocateString(await sandboxString(name === "encode" && args[0] === undefined ? "" : args[0], budget, context));
        if (name === "encodeInto") {
          const destination = requireUint8Array(args[1]);
          const { length } = typedArrayStorage(destination);
          budget.visitNode(Math.min(text.length, length));
          budget.provisionDataUsage(6)();
          const { read, written } = encoder.encodeInto(text, nativeTypedArrayView(destination) as Uint8Array);
          return { read, written };
        }
        // Count UTF-8 bytes before allocating; lone surrogates encode as U+FFFD.
        let length = 0;
        for (const point of text) {
          budget.visitNode();
          const code = point.codePointAt(0)!;
          length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        }
        checkTypedArrayAllocation(length, budget, 1);
        const bytes = encoder.encode(text);
        const bytePrototype = typedArrayPrototypes.get(budget)?.get(Uint8Array);
        if (bytePrototype !== undefined) setSandboxPrototype(bytes, bytePrototype, budget);
        return bytes;
      } finally { release(); }
    },
  }));
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    encoding: { get: accessorAdapter(encoding, "get"), enumerable: true, configurable: true },
    [Symbol.toStringTag]: { value: "TextEncoder", configurable: true },
  });
  for (const method of methods) Object.defineProperty(prototype, method.name!, { value: method, writable: true, enumerable: true, configurable: true });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerBuiltinIdentities(budget, { TextEncoder: constructor });
  for (const closure of [constructor, encoding, ...methods]) registerIntrinsicFunction(budget, closure);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
