import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { readPropertyDescriptor } from "../accessors.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { createSandboxDisplayNames, displayName, displayNamesState } from "../intl-displaynames.js";
import { sandboxString } from "../string-coercion.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure } from "../values.js";

const supportedLocalesOf = Intl.DisplayNames.supportedLocalesOf;
const optionTypes = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["style", ["long", "short", "narrow"]],
  ["type", ["language", "region", "script", "currency", "calendar", "dateTimeField"]],
  ["fallback", ["code", "none"]],
  ["languageDisplay", ["dialect", "standard"]]
] as const;

export function createDisplayNamesConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "DisplayNames", length: 2,
    call: () => { throw new TypeError("Constructor DisplayNames requires 'new'."); },
    construct: async ([input, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.DisplayNames", prototype);
      let locales: string[] = [];
      const converted: Record<string, string> = Object.create(null);
      const release = retainValues(budget, () => [selected, locales, converted]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        if (options === undefined) throw new TypeError("DisplayNames requires options.");
        const source = intlOptionsObject(options, budget);
        for (const [key, type] of optionTypes) {
          const raw = await readIntlProperty(source, key, budget, context);
          if (key === "type" && raw === undefined) throw new TypeError("DisplayNames requires a type.");
          if (raw !== undefined) converted[key] = await convertIntlOption(raw, key, type, budget, context) as string;
        }
        const value = createSandboxDisplayNames(locales, converted as unknown as Intl.DisplayNamesOptions);
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
    [Symbol.toStringTag]: { value: "Intl.DisplayNames", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...displayNamesState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true }
  });
  Object.defineProperty(prototype, "of", { value: createSandboxClosure({
      guest: true, sandbox: true, name: "of", length: 1,
      call: async ([input], context) => {
        const receiver = context?.thisValue;
        displayNamesState(receiver);
        const release = retainValues(budget, () => [receiver, input]);
        try {
          const code = await sandboxString(input, budget, context);
          budget.visitNode(code.length);
          return allocateProducedSandboxValue(displayName(receiver, code), budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  return constructor;
}
