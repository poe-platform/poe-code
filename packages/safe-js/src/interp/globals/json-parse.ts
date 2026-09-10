import type { Budget } from "../budget.js";
import { readPropertyDescriptor } from "../accessors.js";
import { getSandboxPropertyDescriptor, getSandboxPrototype, setSandboxPrototype } from "../object-model.js";
import { defineDataProperty, objectProperties } from "./object-array.js";
import { guestProxyStates } from "../guest-proxy.js";
import { sandboxIsArray } from "../guest-proxy-array.js";
import { sandboxOwnKeys } from "../guest-proxy-own-keys.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { sandboxDeleteProperty } from "../guest-proxy-delete.js";
import { sandboxNumber } from "../string-coercion.js";
import { isNumericTypedArray } from "../typed-array.js";
import { retainValues } from "../resources.js";
import {
  allocateProducedSandboxValue,
  isSandboxPromise, ownEnumerableSandboxKeys,
  type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue
} from "../values.js";

type ParseRecord = {
  value: SandboxValue;
  source?: string;
  children?: Map<string, ParseRecord>;
};

export async function parseJsonWithReviver(
  text: string, reviver: SandboxClosure, budget: Budget, context?: SandboxCallContext
): Promise<SandboxValue> {
  budget.visitNode(text.length);
  // Validate the grammar natively, but capture source ourselves: supported Node
  // versions do not all provide the third native reviver argument.
  JSON.parse(text);
  const originalValues: SandboxValue[] = [];
  let position = 0;
  const root = readValue();
  const holder: SandboxObject = { "": root.value };
  const prototype = getSandboxPrototype(holder, budget);
  if (prototype !== null) setSandboxPrototype(holder, prototype, budget);
  const release = retainValues(budget, () => [holder, reviver, text, ...originalValues]);
  try {
    return await internalize(holder, "", root);
  } finally {
    release();
  }

  function skipWhitespace(): void {
    while (position < text.length && " \t\r\n".includes(text[position]!)) position++;
  }

  function readToken(): string {
    const start = position;
    if (text[position] === '"') {
      position++;
      while (text[position] !== '"') position += text[position] === "\\" ? 2 : 1;
      position++;
    } else {
      while (position < text.length && !",]} \t\r\n".includes(text[position]!)) position++;
    }
    return text.slice(start, position);
  }

  function readValue(): ParseRecord {
    budget.visitNode();
    const leave = budget.enterCall();
    try {
      skipWhitespace();
      const opening = text[position];
      if (opening !== "[" && opening !== "{") {
        const source = readToken();
        const value = JSON.parse(source) as SandboxValue;
        if (typeof value === "string") budget.allocateString(value);
        originalValues.push(value);
        return { value, source };
      }
      const array = opening === "[";
      const value: SandboxValue = array ? [] : Object.create(null) as SandboxObject;
      const prototype = getSandboxPrototype(value, budget);
      if (prototype !== null) setSandboxPrototype(value, prototype, budget);
      const children = new Map<string, ParseRecord>();
      position++;
      skipWhitespace();
      let index = 0;
      while (text[position] !== (array ? "]" : "}")) {
        let key: string;
        if (array) {
          budget.allocateArrayLength(index + 1);
          key = String(index++);
        } else {
          key = JSON.parse(readToken()) as string;
          skipWhitespace();
          position++; // colon; the native parse already validated the grammar
        }
        const child = readValue();
        children.set(key, child);
        Object.defineProperty(value, key, { value: child.value, configurable: true, enumerable: true, writable: true });
        skipWhitespace();
        if (text[position] === ",") { position++; skipWhitespace(); }
      }
      position++;
      originalValues.push(value);
      return { value, children };
    } finally { leave(); }
  }

  async function internalize(holder: SandboxValue, key: string, record?: ParseRecord): Promise<SandboxValue> {
    budget.visitNode();
    const leave = budget.enterCall();
    let value: SandboxValue;
    const callbackContext: SandboxObject = {};
    const prototype = getSandboxPrototype(callbackContext, budget);
    if (prototype !== null) setSandboxPrototype(callbackContext, prototype, budget);
    const release = retainValues(budget, () => [holder, value, callbackContext]);
    try {
      if (context?.getProperty !== undefined) value = await context.getProperty(holder, key);
      else if (typeof holder === "object" && holder !== null && guestProxyStates.has(holder)) {
        value = await sandboxGetProperty(holder, key, holder, budget, context);
      } else {
        const descriptor = getSandboxPropertyDescriptor(holder as SandboxObject, key, budget);
        value = descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, holder, context);
      }
      const original = record !== undefined && Object.is(value, record.value) ? record : undefined;
      if (original?.source !== undefined) callbackContext.source = budget.allocateString(original.source);
      if (typeof value === "object" && value !== null) {
        const proxy = guestProxyStates.has(value);
        let keys: string[];
        if (sandboxIsArray(value, budget)) {
          const number = Array.isArray(value) ? value.length : await sandboxNumber(
            await sandboxGetProperty(value, "length", value, budget, context), budget, context
          );
          const length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
          budget.allocateArrayLength(length);
          keys = Array.from({ length }, (_, index) => String(index));
        } else if (proxy) {
          keys = [];
          const ownKeys = await sandboxOwnKeys(value, budget, context);
          const releaseKeys = retainValues(budget, () => [ownKeys, keys]);
          try {
            for (const name of ownKeys) {
              budget.visitNode();
              if (typeof name !== "string") continue;
              if ((await sandboxGetOwnPropertyDescriptor(value, name, budget, context))?.enumerable) keys.push(name);
            }
          } finally { releaseKeys(); }
        } else keys = ownEnumerableSandboxKeys(value);
        budget.allocateArrayLength(keys.length);
        for (const name of keys) {
          const replacement = await internalize(value, name, original?.children?.get(name));
          if (replacement === undefined) await sandboxDeleteProperty(value, name, budget, context);
          else if (proxy || isNumericTypedArray(value)) {
            await defineDataProperty(value, name, {
              value: replacement, configurable: true, enumerable: true, writable: true
            }, budget, context, false);
          } else Reflect.defineProperty(objectProperties(value, true), name, {
              value: replacement, configurable: true, enumerable: true, writable: true
            });
          context?.reconcileData?.(value);
        }
      }
      const result = await reviver.call([key, value, callbackContext], { stack: [], thisValue: holder });
      if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) await result.synchronousPrefix;
      return allocateProducedSandboxValue(result, budget);
    } finally {
      release();
      leave();
    }
  }
}
