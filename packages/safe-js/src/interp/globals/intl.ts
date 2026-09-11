import type { Budget } from "../budget.js";
import { createLocaleConstructor } from "./intl-locale.js";
import { createCollatorConstructor } from "./intl-collator.js";
import { createNumberFormatConstructor } from "./intl-numberformat.js";
import { createListFormatConstructor } from "./intl-listformat.js";
import { createRelativeTimeFormatConstructor } from "./intl-relativetimeformat.js";
import { createDisplayNamesConstructor } from "./intl-displaynames.js";
import { createDateTimeFormatConstructor } from "./intl-datetimeformat.js";
import { createPluralRulesConstructor } from "./intl-pluralrules.js";
import { createSegmenterConstructor } from "./intl-segmenter.js";
import { createDurationFormatConstructor } from "./intl-durationformat.js";
import { retainedAccessorClosures } from "../accessors.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, registerIntrinsicFunction, registerIntrinsicObject } from "../object-model.js";
import { sandboxString } from "../string-coercion.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxObject, type SandboxValue } from "../values.js";

const supportedValuesOf = Intl.supportedValuesOf;

export function createIntlGlobal(budget: Budget, now: ReturnType<typeof createSandboxClosure>): SandboxObject {
  const methods: Record<string, (args: readonly SandboxValue[], context?: SandboxCallContext) => Promise<SandboxValue>> = {
    getCanonicalLocales: async ([locales], context) =>
      allocateProducedSandboxValue(await canonicalizeGuestLocales(locales, budget, context), budget),
    supportedValuesOf: async ([key], context) => {
      const text = await sandboxString(key, budget, context);
      budget.visitNode(text.length);
      const values = supportedValuesOf(text as Parameters<typeof supportedValuesOf>[0]);
      return allocateProducedSandboxValue(text === "unit" ? [...new Set([...values, "microsecond", "nanosecond"])].sort() : values, budget);
    }
  };
  const intl = createIntrinsicObject();
  const locale = createLocaleConstructor(budget);
  const collator = createCollatorConstructor(budget);
  const numberFormat = createNumberFormatConstructor(budget);
  const listFormat = createListFormatConstructor(budget);
  const relativeTimeFormat = createRelativeTimeFormatConstructor(budget);
  const displayNames = createDisplayNamesConstructor(budget);
  const dateTimeFormat = createDateTimeFormatConstructor(budget, now);
  const pluralRules = createPluralRulesConstructor(budget);
  const segmenter = createSegmenterConstructor(budget);
  const durationFormat = createDurationFormatConstructor(budget);
  Object.defineProperty(intl, "Locale", { value: locale, writable: true, configurable: true });
  Object.defineProperty(intl, "Collator", { value: collator, writable: true, configurable: true });
  Object.defineProperty(intl, "NumberFormat", { value: numberFormat, writable: true, configurable: true });
  Object.defineProperty(intl, "ListFormat", { value: listFormat, writable: true, configurable: true });
  Object.defineProperty(intl, "RelativeTimeFormat", { value: relativeTimeFormat, writable: true, configurable: true });
  Object.defineProperty(intl, "DisplayNames", { value: displayNames, writable: true, configurable: true });
  Object.defineProperty(intl, "DateTimeFormat", { value: dateTimeFormat, writable: true, configurable: true });
  Object.defineProperty(intl, "PluralRules", { value: pluralRules, writable: true, configurable: true });
  Object.defineProperty(intl, "Segmenter", { value: segmenter, writable: true, configurable: true });
  Object.defineProperty(intl, "DurationFormat", { value: durationFormat, writable: true, configurable: true });
  for (const [name, call] of Object.entries(methods)) {
    const closure = createSandboxClosure({ guest: true, sandbox: true, name, length: 1, call });
    Object.defineProperty(intl, name, { value: closure, writable: true, configurable: true });
  }
  Object.defineProperty(intl, Symbol.toStringTag, { value: "Intl", configurable: true });
  registerBuiltinIdentities(budget, { Intl: intl });
  for (const constructor of [locale, collator, numberFormat, listFormat, relativeTimeFormat, displayNames, dateTimeFormat, pluralRules, segmenter, durationFormat]) {
    const prototype = constructor.properties!.prototype as SandboxObject;
    for (const owner of [prototype, constructor.properties!])
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(owner)))
        for (const closure of [descriptor.value, ...retainedAccessorClosures(descriptor)])
          if (isSandboxClosure(closure)) registerIntrinsicFunction(budget, closure);
    registerIntrinsicObject(budget, prototype);
  }
  for (const name of Object.keys(methods)) registerIntrinsicFunction(budget, intl[name] as ReturnType<typeof createSandboxClosure>);
  registerIntrinsicObject(budget, intl);
  return intl;
}
