import type { Budget } from "../budget.js";
import { requireUint8Array, typedArrayStorage } from "../typed-array.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { getSandboxPropertyDescriptor, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";
import { retainValues } from "../resources.js";

const alphabets = {
  base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
};
type ChunkMode = "loose" | "strict" | "stop-before-partial";

export function installUint8Base64(budget: Budget, constructor: SandboxClosure, prototype: SandboxObject): void {
  const fromBase64 = createSandboxClosure({
    guest: true, sandbox: true, name: "fromBase64", length: 1,
    call: async ([text, options], context) => {
      if (typeof text !== "string") throw new TypeError("Base64 input must be a string.");
      const release = retainValues(budget, () => [text, options]);
      try {
        const { alphabet, mode } = await base64Options(options, false, budget, context);
        const result = decodeBase64(text, alphabet, mode, budget);
        if (result.error !== undefined) throw result.error;
        budget.provisionDataUsage(result.bytes.length * 2 + 3)();
        const value = new Uint8Array(result.bytes);
        setSandboxPrototype(value, prototype, budget);
        return value;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "fromBase64", {
    value: fromBase64, writable: true, configurable: true
  });
  registerIntrinsicFunction(budget, fromBase64);
  Object.defineProperties(prototype, {
    toBase64: {
      writable: true, configurable: true,
      value: createSandboxClosure({
        guest: true, sandbox: true, name: "toBase64", length: 0,
        call: async ([options], context) => {
          const value = requireUint8Array(context?.thisValue);
          const release = retainValues(budget, () => [value, options]);
          try {
            const { alphabet, omitPadding } = await base64Options(options, true, budget, context);
            const { length } = typedArrayStorage(value, true);
            budget.provisionDataUsage(omitPadding ? Math.ceil(length * 4 / 3) : Math.ceil(length / 3) * 4)();
            let result = "";
            for (let index = 0; index < length; index += 3) {
              budget.visitNode();
              const a = value[index], b = value[index + 1] ?? 0, c = value[index + 2] ?? 0;
              const chunk = alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
                + (index + 1 < length ? alphabet[((b & 15) << 2) | (c >> 6)] : omitPadding ? "" : "=")
                + (index + 2 < length ? alphabet[c & 63] : omitPadding ? "" : "=");
              result = budget.allocateString(result + chunk);
            }
            return result;
          } finally { release(); }
        }
      })
    },
    setFromBase64: {
      writable: true, configurable: true,
      value: createSandboxClosure({
        guest: true, sandbox: true, name: "setFromBase64", length: 1,
        call: async ([text, options], context) => {
          const value = requireUint8Array(context?.thisValue);
          if (typeof text !== "string") throw new TypeError("Base64 input must be a string.");
          const release = retainValues(budget, () => [value, text, options]);
          try {
            const { alphabet, mode } = await base64Options(options, false, budget, context);
            const { length } = typedArrayStorage(value, true);
            const result = decodeBase64(text, alphabet, mode, budget, length);
            for (let index = 0; index < result.bytes.length; index++) value[index] = result.bytes[index];
            if (result.error !== undefined) throw result.error;
            return { read: result.read, written: result.bytes.length };
          } finally { release(); }
        }
      })
    }
  });
}

async function base64Options(options: SandboxValue, encode: boolean, budget: Budget, context?: SandboxCallContext): Promise<{ alphabet: string; omitPadding: boolean; mode: ChunkMode }> {
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError("Base64 options must be an object.");
  const read = (key: string) => {
    if (options === undefined) return undefined;
    if (context?.getProperty !== undefined) return context.getProperty(options, key);
    const descriptor = getSandboxPropertyDescriptor(options, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, options, context);
  };
  const alphabet = await read("alphabet");
  if (alphabet !== undefined && alphabet !== "base64" && alphabet !== "base64url")
    throw new TypeError("Invalid base64 alphabet.");
  const digits = alphabets[alphabet ?? "base64"];
  if (encode) return { alphabet: digits, omitPadding: Boolean(await read("omitPadding")), mode: "loose" };
  const mode = await read("lastChunkHandling");
  if (mode !== undefined && mode !== "loose" && mode !== "strict" && mode !== "stop-before-partial")
    throw new TypeError("Invalid base64 lastChunkHandling.");
  return { alphabet: digits, omitPadding: false, mode: mode ?? "loose" };
}

function decodeBase64(text: string, alphabet: string, mode: ChunkMode, budget: Budget, maxLength = Number.MAX_SAFE_INTEGER) {
  const bytes: number[] = [];
  const chunk: number[] = [];
  let read = 0, index = 0;
  const skipWhitespace = () => {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) break;
      budget.visitNode();
      index++;
    }
  };
  const append = (strict: boolean) => {
    if (strict && ((chunk.length === 2 && (chunk[1] & 15) !== 0) || (chunk.length === 3 && (chunk[2] & 3) !== 0)))
      throw new SyntaxError("Nonzero unused base64 bits.");
    const length = bytes.length + chunk.length - 1;
    budget.allocateArrayLength(length);
    budget.provisionDataUsage(length + 1)();
    bytes.push((chunk[0] << 2) | (chunk[1] >> 4));
    if (chunk.length > 2) bytes.push(((chunk[1] & 15) << 4) | (chunk[2] >> 2));
    if (chunk.length > 3) bytes.push(((chunk[2] & 3) << 6) | chunk[3]);
  };
  try {
    if (maxLength === 0) return { read, bytes };
    for (;;) {
      skipWhitespace();
      if (index === text.length) {
        if (chunk.length > 0) {
          if (mode === "stop-before-partial") return { read, bytes };
          if (mode === "strict" || chunk.length === 1) throw new SyntaxError("Incomplete base64 chunk.");
          append(false);
        }
        return { read: index, bytes };
      }
      budget.visitNode();
      const char = text[index++];
      if (char === "=") {
        if (chunk.length < 2) throw new SyntaxError("Invalid base64 padding.");
        skipWhitespace();
        if (chunk.length === 2) {
          if (index === text.length) {
            if (mode === "stop-before-partial") return { read, bytes };
            throw new SyntaxError("Incomplete base64 padding.");
          }
          if (text[index] === "=") { budget.visitNode(); index++; skipWhitespace(); }
        }
        if (index < text.length) throw new SyntaxError("Unexpected input after base64 padding.");
        append(mode === "strict");
        return { read: index, bytes };
      }
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new SyntaxError("Invalid base64 character.");
      const remaining = maxLength - bytes.length;
      if ((remaining === 1 && chunk.length === 2) || (remaining === 2 && chunk.length === 3)) return { read, bytes };
      chunk.push(digit);
      if (chunk.length === 4) {
        append(false);
        chunk.length = 0;
        read = index;
        if (bytes.length === maxLength) return { read, bytes };
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { read, bytes, error };
  }
}
