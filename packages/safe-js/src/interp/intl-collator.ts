import type { Budget } from "./budget.js";
import { convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "./intl-options.js";
import { retainValues } from "./resources.js";
import type { SandboxCallContext, SandboxClosure, SandboxObject, SandboxValue } from "./values.js";

const NativeCollator = Intl.Collator;
const nativeResolvedOptions = NativeCollator.prototype.resolvedOptions;
const nativeCompare = Object.getOwnPropertyDescriptor(NativeCollator.prototype, "compare")!.get!;
export type ResolvedCollatorOptions = {
  locale: string;
  usage: "sort" | "search";
  sensitivity: "base" | "accent" | "case" | "variant";
  ignorePunctuation: boolean;
  collation: string;
  numeric: boolean;
  caseFirst: "upper" | "lower" | "false";
};
const states = new WeakMap<object, { options: ResolvedCollatorOptions; native: Intl.Collator; compare?: SandboxClosure }>();
const optionTypes: ReadonlyArray<readonly [string, IntlOptionType]> = [
  ["usage", ["sort", "search"]], ["localeMatcher", ["lookup", "best fit"]],
  ["collation", "unicodeType"], ["numeric", "boolean"],
  ["caseFirst", ["upper", "lower", "false"]],
  ["sensitivity", ["base", "accent", "case", "variant"]], ["ignorePunctuation", "boolean"]
];

export async function readCollatorOptions(input: SandboxValue, budget: Budget, context?: SandboxCallContext, invalid?: (key: string, text: string) => void): Promise<Record<string, string | boolean>> {
  const source = intlOptionsObject(input, budget);
  const options: Record<string, string | boolean> = Object.create(null);
  const release = retainValues(budget, () => [source, options]);
  try {
    for (const [key, type] of optionTypes) {
      const value = await readIntlProperty(source, key, budget, context);
      if (value !== undefined) options[key] = await convertIntlOption(value, key, type, budget, context,
        text => { invalid?.(key, text); new NativeCollator([], { [key]: text }); });
    }
    return options;
  } finally { release(); }
}

export function createSandboxCollator(locales: string | string[], options: Record<string, string | boolean>): SandboxObject {
  const native = new NativeCollator(locales, options as Intl.CollatorOptions);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: Reflect.apply(nativeResolvedOptions, native, []) });
  return value;
}

export function isSandboxCollator(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function collatorState(value: unknown) {
  if (!isSandboxCollator(value)) throw new TypeError("Intl.Collator requires a Collator receiver.");
  return states.get(value)!;
}

export function compareCollatorStrings(value: unknown, first: string, second: string): number {
  const state = collatorState(value);
  const compare = Reflect.apply(nativeCompare, state.native, []);
  return Reflect.apply(compare, undefined, [first, second]);
}
