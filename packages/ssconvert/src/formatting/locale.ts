import { SsconvertError } from "../contracts.js";
import type { CellValue } from "../workbook.js";
import { rendered } from "../formulas/values.js";

export interface FormattingLocaleProfile {
  readonly decimal: string;
  readonly thousand: string;
  readonly months: readonly string[];
  readonly weekdays: readonly string[];
  readonly shortWeekdays: readonly string[];
  readonly trueText: string;
  readonly falseText: string;
  readonly errors: Readonly<Record<string, string>>;
}
const english: FormattingLocaleProfile = Object.freeze({ decimal: ".", thousand: ",", trueText: "TRUE", falseText: "FALSE", errors: Object.freeze({}),
  months: Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]),
  weekdays: Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]),
  shortWeekdays: Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) });
const german: FormattingLocaleProfile = Object.freeze({ decimal: ",", thousand: ".", trueText: "WAHR", falseText: "FALSCH",
  errors: Object.freeze({ "#NUM!": "#ZAHL!", "#N/A": "#NV", "#VALUE!": "#WERT!", "#REF!": "#BEZUG!" }),
  months: Object.freeze(["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]),
  weekdays: Object.freeze(["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]),
  shortWeekdays: Object.freeze(["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]) });
/** Explicit captured profiles; no host locale or Intl lookup. */
export function formattingLocale(name: string): FormattingLocaleProfile {
  if (["C", "POSIX", "C.UTF-8", "C.utf8", "en_US", "en_US.UTF-8"].includes(name)) return english;
  if (["de_DE", "de_DE.UTF-8", "de_DE.utf8"].includes(name)) return german;
  throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: uncaptured format locale");
}

/** Only numeric representation is localized, never arbitrary literals. */
export function rawValueText(text: string, profile: FormattingLocaleProfile): string {
  return profile.decimal === "." ? text : text.split(".").join(profile.decimal);
}
export function localizedValueText(value: CellValue, profile: FormattingLocaleProfile): string {
  if (value.kind === "number") return rawValueText(rendered(value), profile);
  if (value.kind === "boolean") return value.value ? profile.trueText : profile.falseText;
  if (value.kind === "error") return profile.errors[value.value] ?? value.value;
  return rendered(value);
}
/** TEXT accepts locale spelling; SDK and stored XL formats remain canonical. */
export function canonicalTextPattern(pattern: string, profile: FormattingLocaleProfile): string {
  if (profile.decimal === ".") return pattern;
  let result = "", quoted = false, tag = false;
  for (let index = 0; index < pattern.length; index++) {
    const c = pattern[index]!;
    if (c === "\\" && !quoted) { result += c + (pattern[++index] ?? ""); continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === "[") tag = true;
    if (!quoted && c === "]") tag = false;
    result += quoted || tag ? c : c === profile.decimal ? "." : c === profile.thousand ? "," : c;
  }
  return result;
}
