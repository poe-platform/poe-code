import { PluralRules } from "../intl-data/dist/pluralrules-engine.js";
import { pluralData } from "../intl-data/dist/pluralrules.js";

const NativePluralRules = Intl.PluralRules;

class NumberFormatPluralRules extends PluralRules {
  constructor(locales?: string | string[], options?: ConstructorParameters<typeof PluralRules>[1]) {
    const locale = new NativePluralRules(locales).resolvedOptions().locale;
    let selected = locale;
    while (!Object.hasOwn(pluralData, selected) && selected.includes("-")) selected = selected.slice(0, selected.lastIndexOf("-"));
    if (!Object.hasOwn(pluralData, selected)) throw new RangeError(`Missing plural data for ${locale}.`);
    if (!PluralRules.availableLocales.has(selected)) PluralRules.__addLocaleData(pluralData[selected]!());
    super(locale, options);
  }
}

export const numberFormatIntl = Object.freeze(Object.create(globalThis.Intl, {
  PluralRules: { value: NumberFormatPluralRules }
})) as Omit<typeof Intl, "PluralRules"> & { PluralRules: typeof NumberFormatPluralRules };
