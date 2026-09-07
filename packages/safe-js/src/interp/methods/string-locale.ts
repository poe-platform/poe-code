import type { Budget } from "../budget.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "../intl-options.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

const collatorOptions: ReadonlyArray<readonly [string, IntlOptionType]> = [
  ["usage", ["sort", "search"]],
  ["localeMatcher", ["lookup", "best fit"]],
  ["collation", "unicodeType"],
  ["numeric", "boolean"],
  ["caseFirst", ["upper", "lower", "false"]],
  ["sensitivity", ["base", "accent", "case", "variant"]],
  ["ignorePunctuation", "boolean"]
];

export async function changeStringLocaleCase(value: string, method: "toLocaleLowerCase" | "toLocaleUpperCase", args: readonly SandboxValue[], budget: Budget, context?: SandboxCallContext): Promise<string> {
  let locales: string[] = [];
  const release = retainValues(budget, () => [value, locales]);
  try {
    // Validate the entire list even when native case mapping only reads its first entry.
    locales = await canonicalizeGuestLocales(args[0], budget, context);
    budget.visitNode(value.length);
    return budget.allocateString(Reflect.apply(String.prototype[method], value, [locales]));
  } finally { release(); }
}

export async function compareStringLocale(value: string, args: readonly SandboxValue[], budget: Budget, context: SandboxCallContext): Promise<number> {
  let comparison = "";
  let locales: string[] = [];
  const options: Record<string, string | boolean> = Object.create(null);
  const release = retainValues(budget, () => [value, comparison, locales, options]);
  try {
    comparison = await sandboxString(args[0], budget, context);
    locales = await canonicalizeGuestLocales(args[1], budget, context);
    if (args[2] === null) return Reflect.apply(String.prototype.localeCompare, value, [comparison, locales, null]);
    const inputOptions = intlOptionsObject(args[2], budget);
    for (const [key, type] of collatorOptions) {
      const option = await readIntlProperty(inputOptions, key, budget, context);
      if (option !== undefined) options[key] = await convertIntlOption(option, key, type, budget, context, text => {
        Reflect.apply(String.prototype.localeCompare, "", ["", [], { [key]: text }]);
      });
    }
    budget.visitNode(value.length + comparison.length);
    return Reflect.apply(String.prototype.localeCompare, value, [comparison, locales, options]);
  } finally { release(); }
}
