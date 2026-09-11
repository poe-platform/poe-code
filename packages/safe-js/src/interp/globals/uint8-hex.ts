import type { Budget } from "../budget.js";
import { checkTypedArrayAllocation, requireUint8Array, typedArrayStorage } from "../typed-array.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject } from "../values.js";
import { materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";

const hexDigits = "0123456789abcdef";

export function installUint8Hex(budget: Budget, constructor: SandboxClosure, prototype: SandboxObject): void {
  const fromHex = createSandboxClosure({
    guest: true, sandbox: true, name: "fromHex", length: 1,
    call: ([text]) => {
      if (typeof text !== "string") throw new TypeError("Hex input must be a string.");
      if (text.length % 2 !== 0) throw new SyntaxError("Hex input must have an even length.");
      checkTypedArrayAllocation(text.length / 2, budget, 1);
      const value = new Uint8Array(text.length / 2);
      decodeHexInto(text, value, budget);
      setSandboxPrototype(value, prototype, budget);
      return value;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "fromHex", {
    value: fromHex, writable: true, configurable: true
  });
  registerIntrinsicFunction(budget, fromHex);
  Object.defineProperties(prototype, {
    toHex: {
      writable: true, configurable: true,
      value: createSandboxClosure({
        guest: true, sandbox: true, name: "toHex", length: 0,
        call: (_args, context) => {
          const value = requireUint8Array(context?.thisValue);
          const { length } = typedArrayStorage(value, true);
          budget.provisionDataUsage(length * 2)();
          let result = "";
          for (let index = 0; index < length; index++) {
            budget.visitNode();
            const byte = value[index];
            result = budget.allocateString(result + hexDigits[byte >> 4] + hexDigits[byte & 15]);
          }
          return result;
        }
      })
    },
    setFromHex: {
      writable: true, configurable: true,
      value: createSandboxClosure({
        guest: true, sandbox: true, name: "setFromHex", length: 1,
        call: ([text], context) => {
          const value = requireUint8Array(context?.thisValue);
          if (typeof text !== "string") throw new TypeError("Hex input must be a string.");
          typedArrayStorage(value, true);
          const written = decodeHexInto(text, value, budget);
          return { read: written * 2, written };
        }
      })
    }
  });
}

function decodeHexInto(text: string, value: Uint8Array<ArrayBuffer>, budget: Budget): number {
  if (text.length % 2 !== 0) throw new SyntaxError("Hex input must have an even length.");
  const length = Math.min(text.length / 2, typedArrayStorage(value).length);
  for (let index = 0; index < length; index++) {
    budget.visitNode();
    const high = hexNibble(text.charCodeAt(index * 2));
    const low = hexNibble(text.charCodeAt(index * 2 + 1));
    if (high < 0 || low < 0) throw new SyntaxError("Invalid hexadecimal digit.");
    value[index] = high * 16 + low;
  }
  return length;
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}
