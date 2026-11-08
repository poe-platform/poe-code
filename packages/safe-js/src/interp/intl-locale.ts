import type { Budget } from "./budget.js";
import { convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "./intl-options.js";
import { sandboxString } from "./string-coercion.js";
import type { SandboxCallContext, SandboxObject, SandboxValue } from "./values.js";

const NativeLocale = Intl.Locale;
const nativeToString = NativeLocale.prototype.toString;
const nativeDescriptors = Object.getOwnPropertyDescriptors(NativeLocale.prototype);
const locales = new WeakMap<object, Intl.Locale>();

export function isSandboxLocale(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && locales.has(value);
}

export function createSandboxLocale(tag: string): SandboxObject {
  const native = new NativeLocale(tag);
  const value = Object.create(null) as SandboxObject;
  locales.set(value, native);
  return value;
}

export function localeTag(value: unknown): string {
  if (!isSandboxLocale(value)) throw new TypeError("Intl.Locale requires a Locale receiver.");
  return Reflect.apply(nativeToString, locales.get(value), []);
}

export function localeVariants(tag: string): string | undefined {
  const native = new NativeLocale(tag);
  const count = 1 + Number(native.script !== undefined) + Number(native.region !== undefined);
  return native.baseName.split("-").slice(count).join("-") || undefined;
}

// Only canonical primitive tags enter native ICU. Guest objects never do.
export function localeMember(value: unknown, name: string): SandboxValue {
  const tag = localeTag(value);
  if (name === "language") return tag.split("-", 1)[0];
  if (name === "variants") return localeVariants(tag);
  if (name === "firstDayOfWeek") return unicodeKeywords(tag).keywords.get("fw");
  const native = locales.get(value as object)!;
  const descriptor = nativeDescriptors[name] ?? nativeDescriptors[name.slice(3, 4).toLowerCase() + name.slice(4)];
  const result = Reflect.apply(descriptor.get ?? descriptor.value, native, []);
  if (name === "maximize" || name === "minimize")
    return Reflect.apply(nativeToString, result, []);
  if (name === "getWeekInfo") {
    const info = result as { firstDay: number; weekend: number[] };
    return { firstDay: info.firstDay, weekend: info.weekend };
  }
  return result as SandboxValue;
}

function unicodeKeywords(tag: string): { parts: string[]; start: number; end: number; attributes: string[]; keywords: Map<string, string> } {
  const parts = tag.split("-");
  const privateUse = parts.indexOf("x");
  let start = parts.indexOf("u");
  if (privateUse !== -1 && start > privateUse) start = -1;
  let end = start === -1 ? (privateUse === -1 ? parts.length : privateUse) : start + 1;
  if (start !== -1) while (end < parts.length && parts[end].length !== 1) end++;
  const attributes: string[] = [];
  const keywords = new Map<string, string>();
  let index = start + 1;
  if (start !== -1) {
    while (index < end && parts[index].length > 2) attributes.push(parts[index++]);
    while (index < end) {
      const key = parts[index++];
      const values: string[] = [];
      while (index < end && parts[index].length > 2) values.push(parts[index++]);
      keywords.set(key, values.join("-"));
    }
  }
  return { parts, start, end, attributes, keywords };
}

export async function buildLocaleTag(input: SandboxValue, optionsInput: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string> {
  if (typeof input !== "string" && (typeof input !== "object" || input === null))
    throw new TypeError("Locale tag must be a string or object.");
  const tag = isSandboxLocale(input) ? localeTag(input) : await sandboxString(input, budget, context);
  const options = intlOptionsObject(optionsInput, budget);
  budget.visitNode(tag.length);
  const native = new NativeLocale(tag);
  const canonical = Reflect.apply(nativeToString, native, []) as string;
  const base: Record<string, string | undefined> = {
    language: canonical.split("-", 1)[0], script: native.script, region: native.region, variants: localeVariants(canonical)
  };
  for (const key of Object.keys(base)) {
    const value = await readIntlProperty(options, key, budget, context);
    if (value === undefined) continue;
    const text = await sandboxString(value, budget, context);
    budget.visitNode(text.length);
    if (key === "variants") {
      const parts = text.toLowerCase().split("-");
      if (new Set(parts).size !== parts.length || !parts.every(part =>
        (part.length >= 5 && part.length <= 8 || part.length === 4 && part[0] >= "0" && part[0] <= "9") &&
        [...part].every(char => char >= "a" && char <= "z" || char >= "0" && char <= "9")))
        throw new RangeError("Invalid variants option.");
    } else {
      // One converted option at a time preserves validation/getter ordering.
      new NativeLocale("und", { [key]: text });
    }
    base[key] = text;
  }
  const updated = Object.values(base).filter(value => value !== undefined).join("-") + canonical.slice(native.baseName.length);
  const extension = unicodeKeywords(updated);
  const optionTypes: Array<[string, string, IntlOptionType]> = [
    ["calendar", "ca", "unicodeType"], ["collation", "co", "unicodeType"],
    ["firstDayOfWeek", "fw", "unicodeType"], ["hourCycle", "hc", ["h11", "h12", "h23", "h24"]],
    ["caseFirst", "kf", ["upper", "lower", "false"]], ["numeric", "kn", "boolean"],
    ["numberingSystem", "nu", "unicodeType"]
  ];
  for (const [key, extensionKey, type] of optionTypes) {
    let value = await readIntlProperty(options, key, budget, context);
    if (value === undefined) continue;
    if (key === "firstDayOfWeek") {
      const text = await sandboxString(value, budget, context);
      const weekdays: Record<string, string> = { "0": "sun", "1": "mon", "2": "tue", "3": "wed", "4": "thu", "5": "fri", "6": "sat", "7": "sun" };
      value = Object.hasOwn(weekdays, text) ? weekdays[text] : text;
    }
    extension.keywords.set(extensionKey, String(await convertIntlOption(value, key, type, budget, context)));
  }
  const { parts, start, end, attributes, keywords } = extension;
  if (keywords.size > 0 || attributes.length > 0) {
    const sequence = ["u", ...attributes];
    for (const [key, value] of keywords) sequence.push(key, ...value.split("-").filter(Boolean));
    parts.splice(start === -1 ? end : start, start === -1 ? 0 : end - start, ...sequence);
  }
  const result = new NativeLocale(parts.join("-"));
  return budget.allocateString(Reflect.apply(nativeToString, result, []));
}
