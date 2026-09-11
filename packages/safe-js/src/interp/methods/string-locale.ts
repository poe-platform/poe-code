import type { Budget } from "../budget.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { readCollatorOptions } from "../intl-collator.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

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

export async function compareStringLocale(value: string, args: readonly SandboxValue[], budget: Budget, context?: SandboxCallContext): Promise<number> {
  let comparison = "";
  let locales: string[] = [];
  let options: Record<string, string | boolean> = Object.create(null);
  const release = retainValues(budget, () => [value, comparison, locales, options]);
  try {
    comparison = await sandboxString(args[0], budget, context);
    const primitiveLocales = context?.getProperty === undefined &&
      (args[1] === undefined || typeof args[1] === "string");
    locales = primitiveLocales ? Intl.getCanonicalLocales(args[1] as string | undefined) : await canonicalizeGuestLocales(args[1], budget, context);
    if (primitiveLocales && args[2] === undefined) {
      budget.visitNode(value.length + comparison.length);
      return Reflect.apply(String.prototype.localeCompare, value, [comparison, locales]);
    }
    if (args[2] === null) return Reflect.apply(String.prototype.localeCompare, value, [comparison, locales, null]);
    options = await readCollatorOptions(args[2], budget, context, (key, text) => {
      Reflect.apply(String.prototype.localeCompare, "", ["", [], { [key]: text }]);
    });
    budget.visitNode(value.length + comparison.length);
    return Reflect.apply(String.prototype.localeCompare, value, [comparison, locales, options]);
  } finally { release(); }
}
