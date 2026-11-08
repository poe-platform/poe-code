import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { readPropertyDescriptor } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { createSandboxListFormat, formatList, listFormatState } from "../intl-listformat.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure } from "../values.js";

const supportedLocalesOf = Intl.ListFormat.supportedLocalesOf;
const optionTypes = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["type", ["conjunction", "disjunction", "unit"]],
  ["style", ["long", "short", "narrow"]]
] as const;

export function createListFormatConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "ListFormat", length: 0,
    call: () => { throw new TypeError("Constructor ListFormat requires 'new'."); },
    construct: async ([input, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.ListFormat", prototype);
      let locales: string[] = [];
      const converted: Record<string, string> = Object.create(null);
      const release = retainValues(budget, () => [selected, locales, converted]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        const source = intlOptionsObject(options, budget);
        for (const [key, type] of optionTypes) {
          const raw = await readIntlProperty(source, key, budget, context);
          if (raw !== undefined) converted[key] = await convertIntlOption(raw, key, type, budget, context) as string;
        }
        const value = createSandboxListFormat(locales, converted);
        setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
        return allocateProducedSandboxValue(value, budget);
      } finally { release(); }
    }
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype, writable: false, configurable: false });
  Object.defineProperty(properties, "supportedLocalesOf", { value: createSandboxClosure({
    guest: true, sandbox: true, name: "supportedLocalesOf", length: 1,
    call: async ([input, options], context) => {
      const locales = await canonicalizeGuestLocales(input, budget, context);
      const release = retainValues(budget, () => [locales]);
      try {
        const source = intlOptionsObject(options, budget);
        const raw = await readIntlProperty(source, "localeMatcher", budget, context);
        const matcher = raw === undefined ? undefined : await convertIntlOption(raw, "localeMatcher", ["lookup", "best fit"], budget, context);
        return allocateProducedSandboxValue(supportedLocalesOf(locales, { localeMatcher: matcher as "lookup" | "best fit" | undefined }), budget);
      } finally { release(); }
    }
  }), writable: true, configurable: true });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Intl.ListFormat", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...listFormatState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true }
  });
  for (const method of ["format", "formatToParts"] as const) {
    Object.defineProperty(prototype, method, { value: createSandboxClosure({
      guest: true, sandbox: true, name: method, length: 1,
      call: async ([input], context) => {
        const receiver = context?.thisValue;
        listFormatState(receiver);
        const strings: string[] = [];
        let iterator: SandboxIterator | undefined;
        const release = retainValues(budget, () => [receiver, strings, iterator?.retainedValue]);
        const checkpoint = createDataCheckpoint(budget, context);
        try {
          if (input !== undefined) {
            iterator = context === undefined ? getSandboxIterator(input, budget)
              : await acquireSandboxIterator(input, budget, context);
            if (iterator === undefined) throw new TypeError("ListFormat requires an iterable.");
            while (true) {
              budget.visitNode();
              const result = await iterator.next();
              if ((await readIteratorResult(iterator, result, "done")).value) break;
              const value = (await readIteratorResult(iterator, result, "value")).value;
              if (typeof value !== "string") {
                await closeIterator(iterator, true);
                throw new TypeError("ListFormat requires string elements.");
              }
              budget.visitNode(value.length);
              budget.allocateArrayLength(strings.length + 1);
              strings.push(value);
              checkpoint(strings, value.length + 1);
            }
          }
          return allocateProducedSandboxValue(formatList(receiver, strings, method === "formatToParts"), budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  }
  return constructor;
}
