import type { Budget } from "../budget.js";
import { readPropertyDescriptor } from "../accessors.js";
import { getSandboxPropertyDescriptor, isGuestClosure, materializeFunctionProperties } from "../object-model.js";
import { retainValues } from "../resources.js";
import {
  allocateProducedSandboxValue, getRegexProperties,
  isSandboxPromise, isSandboxRegex, ownEnumerableSandboxKeys,
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
    const release = retainValues(budget, () => [holder, value, callbackContext]);
    try {
      if (context?.getProperty !== undefined) value = await context.getProperty(holder, key);
      else {
        const descriptor = getSandboxPropertyDescriptor(holder as SandboxObject, key, budget);
        value = descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, holder, context);
      }
      const original = record !== undefined && Object.is(value, record.value) ? record : undefined;
      if (original?.source !== undefined) callbackContext.source = budget.allocateString(original.source);
      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) budget.allocateArrayLength(value.length);
        const keys = Array.isArray(value)
          ? Array.from({ length: value.length }, (_, index) => String(index))
          : ownEnumerableSandboxKeys(value);
        budget.allocateArrayLength(keys.length);
        for (const name of keys) {
          const replacement = await internalize(value, name, original?.children?.get(name));
          const properties = isGuestClosure(value) ? materializeFunctionProperties(value)
            : isSandboxRegex(value) ? getRegexProperties(value) : value;
          if (replacement === undefined) Reflect.deleteProperty(properties, name);
          else Reflect.defineProperty(properties, name, {
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
