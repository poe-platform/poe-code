import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { readPropertyDescriptor } from "../accessors.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { readDurationOptions } from "../intl-duration-options.js";
import { readDurationRecord } from "../intl-duration-record.js";
import { formatDurationParts } from "../intl-duration-parts.js";
import { createSandboxDurationFormat, durationFormatState, type DurationSettings } from "../intl-durationformat.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure } from "../values.js";

const supportedLocalesOf = Intl.NumberFormat.supportedLocalesOf;

export function createDurationFormatConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "DurationFormat", length: 0,
    call: () => { throw new TypeError("Constructor DurationFormat requires 'new'."); },
    construct: async ([input, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.DurationFormat", prototype);
      let locales: string[] = [];
      let settings: DurationSettings | undefined;
      const release = retainValues(budget, () => [selected, locales, settings]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        settings = await readDurationOptions(options, locales, budget, context);
        const value = createSandboxDurationFormat(settings);
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
    [Symbol.toStringTag]: { value: "Intl.DurationFormat", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...durationFormatState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true }
  });
  for (const method of ["format", "formatToParts"] as const) {
    Object.defineProperty(prototype, method, { value: createSandboxClosure({
      guest: true, sandbox: true, name: method, length: 1,
      call: async ([input], context) => {
        const receiver = context?.thisValue;
        const { settings } = durationFormatState(receiver);
        const release = retainValues(budget, () => [receiver, input]);
        try {
          const record = await readDurationRecord(input, budget, context);
          budget.visitNode(100);
          const parts = formatDurationParts(settings, record, settings.separator);
          return allocateProducedSandboxValue(method === "format" ? parts.map(part => part.value).join("") : parts, budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  }
  return constructor;
}
