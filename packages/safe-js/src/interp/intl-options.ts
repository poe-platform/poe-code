import type { Budget } from "./budget.js";
import { createSandboxBox } from "./boxed.js";
import { isFloat32Array } from "./float32.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import { readPropertyDescriptor } from "./accessors.js";
import { retainValues } from "./resources.js";
import { sandboxNumber, sandboxString } from "./string-coercion.js";
import { allocateProducedSandboxValue, type SandboxCallContext, type SandboxValue } from "./values.js";

const canonicalLocales = Intl.getCanonicalLocales;
export type IntlOptionType = readonly string[] | "boolean" | "unicodeType";

export function readIntlProperty(value: SandboxValue, key: string, budget: Budget, context?: SandboxCallContext): SandboxValue | Promise<SandboxValue> {
  budget.visitNode();
  if (context?.getProperty !== undefined) return context.getProperty(value, key);
  const descriptor = getSandboxPropertyDescriptor(value, key, budget);
  return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
}

export function intlOptionsObject(value: SandboxValue, budget: Budget): SandboxValue {
  if (value === undefined) return Object.create(null) as SandboxValue;
  if (value === null) throw new TypeError("Cannot convert null to an object.");
  if (typeof value === "object") return value;
  const box = createSandboxBox(value);
  allocateProducedSandboxValue(box, budget);
  return box;
}

export async function canonicalizeGuestLocales(input: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string[]> {
  const locales: string[] = [];
  if (input === undefined) return locales;
  if (input === null) return Reflect.apply(canonicalLocales, Intl, [input]);
  const release = retainValues(budget, () => [locales]);
  try {
    const list = typeof input === "string" ? [input] : intlOptionsObject(input, budget);
    const count = await sandboxNumber(await readIntlProperty(list, "length", budget, context), budget, context);
    const length = Number.isNaN(count) || count <= 0 ? 0 : Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER);
    for (let index = 0; index < length; index++) {
      budget.visitNode();
      const key = String(index);
      if (getSandboxPropertyDescriptor(list, key, budget) === undefined &&
          !(isFloat32Array(list) && Object.hasOwn(list, key))) continue;
      const value = await readIntlProperty(list, key, budget, context);
      if (typeof value !== "string" && (typeof value !== "object" || value === null))
        return Reflect.apply(canonicalLocales, Intl, [[value]]);
      const tag = await sandboxString(value, budget, context);
      budget.visitNode(tag.length);
      const canonical = canonicalLocales(tag)[0]!;
      budget.visitNode(locales.length);
      if (!locales.includes(canonical)) locales.push(budget.allocateString(canonical));
    }
    return locales;
  } finally { release(); }
}

export async function convertIntlOption(value: SandboxValue, key: string, type: IntlOptionType, budget: Budget, context?: SandboxCallContext, invalid?: (text: string) => void): Promise<string | boolean> {
  if (type === "boolean") return Boolean(value);
  const text = await sandboxString(value, budget, context);
  budget.visitNode(text.length);
  if (type === "unicodeType") {
    const valid = text.split("-").every(part => part.length >= 3 && part.length <= 8 &&
      [...part].every(char => char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char >= "0" && char <= "9"));
    if (valid) return text;
  } else if (type.includes(text)) return text;
  // A consumer can preserve its native diagnostic using only the converted primitive.
  invalid?.(text);
  throw new RangeError(`Invalid ${key} option.`);
}
