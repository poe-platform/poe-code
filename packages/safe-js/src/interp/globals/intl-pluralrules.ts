import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { readPropertyDescriptor } from "../accessors.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { createSandboxPluralRules, selectPlural, pluralRulesState } from "../intl-pluralrules.js";
import { numberFormatValue } from "../intl-numberformat.js";
import { readIntlDigitOptions } from "../intl-digit-options.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure } from "../values.js";

const supportedLocalesOf = Intl.PluralRules.supportedLocalesOf;
const optionTypes = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["type", ["cardinal", "ordinal"]]
] as const;

export function createPluralRulesConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "PluralRules", length: 0,
    call: () => { throw new TypeError("Constructor PluralRules requires 'new'."); },
    construct: async ([input, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.PluralRules", prototype);
      let locales: string[] = [];
      const converted: Record<string, string | number | boolean> = Object.create(null);
      const release = retainValues(budget, () => [selected, locales, converted]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        const source = intlOptionsObject(options, budget);
        for (const [key, type] of optionTypes) {
          const raw = await readIntlProperty(source, key, budget, context);
          if (raw !== undefined) converted[key] = await convertIntlOption(raw, key, type, budget, context) as string;
        }
        Object.assign(converted, await readIntlDigitOptions(source, { minimum: 0, maximum: 3, notation: "standard" }, budget, context));
        const value = createSandboxPluralRules(locales, converted);
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
    [Symbol.toStringTag]: { value: "Intl.PluralRules", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => {
        const options = pluralRulesState(context?.thisValue).options;
        return allocateProducedSandboxValue({ ...options, pluralCategories: [...options.pluralCategories as string[]] }, budget);
      }
    }), writable: true, configurable: true }
  });
  for (const method of ["select", "selectRange"] as const) {
    const range = method === "selectRange";
    Object.defineProperty(prototype, method, { value: createSandboxClosure({
      guest: true, sandbox: true, name: method, length: range ? 2 : 1,
      call: async ([first, second], context) => {
        const receiver = context?.thisValue;
        pluralRulesState(receiver);
        if (range && (first === undefined || second === undefined)) throw new TypeError("PluralRules range requires both values.");
        const inputs: Array<string | number | bigint> = [];
        const release = retainValues(budget, () => [receiver, first, second, inputs]);
        try {
          inputs.push(await numberFormatValue(first, budget, context));
          if (range) inputs.push(await numberFormatValue(second, budget, context));
          return allocateProducedSandboxValue(selectPlural(receiver, inputs), budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  }
  return constructor;
}
