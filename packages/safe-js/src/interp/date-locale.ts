import type { Budget } from "./budget.js";
import { createSandboxBox } from "./boxed.js";
import { isFloat32Array } from "./float32.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import { readPropertyDescriptor } from "./accessors.js";
import { retainValues } from "./resources.js";
import { sandboxNumber, sandboxString } from "./string-coercion.js";
import { allocateProducedSandboxValue, type SandboxCallContext, type SandboxValue } from "./values.js";

const NativeDateTimeFormat = Intl.DateTimeFormat;
const canonicalLocales = Intl.getCanonicalLocales;

// ECMA-402 CreateDateTimeFormat: resolution options, zone, components, styles.
// Read and validate each property before touching the next guest property.
const dateTimeOptions: ReadonlyArray<readonly [string, readonly string[] | "boolean" | "number" | "unicodeType" | "zone"]> = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["calendar", "unicodeType"],
  ["numberingSystem", "unicodeType"],
  ["hour12", "boolean"],
  ["hourCycle", ["h11", "h12", "h23", "h24"]],
  ["timeZone", "zone"],
  ["weekday", ["narrow", "short", "long"]],
  ["era", ["narrow", "short", "long"]],
  ["year", ["2-digit", "numeric"]],
  ["month", ["2-digit", "numeric", "narrow", "short", "long"]],
  ["day", ["2-digit", "numeric"]],
  ["dayPeriod", ["narrow", "short", "long"]],
  ["hour", ["2-digit", "numeric"]],
  ["minute", ["2-digit", "numeric"]],
  ["second", ["2-digit", "numeric"]],
  ["fractionalSecondDigits", "number"],
  ["timeZoneName", ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]],
  ["formatMatcher", ["basic", "best fit"]],
  ["dateStyle", ["full", "long", "medium", "short"]],
  ["timeStyle", ["full", "long", "medium", "short"]]
];

export async function formatDateLocale(
  name: string,
  time: number,
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  if (Number.isNaN(time)) return budget.allocateString("Invalid Date");
  const locales: string[] = [];
  const options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [locales, options]);
  const read = (value: SandboxValue, key: string): SandboxValue | Promise<SandboxValue> => {
    budget.visitNode();
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  };
  const toObject = (value: SandboxValue): SandboxValue => {
    if (value === null || value === undefined) throw new TypeError("Cannot convert null or undefined to an object.");
    if (typeof value === "object") return value;
    const box = createSandboxBox(value);
    allocateProducedSandboxValue(box, budget);
    return box;
  };
  try {
    const inputLocales = args[0];
    if (inputLocales !== undefined) {
      const list = typeof inputLocales === "string" ? [inputLocales] : toObject(inputLocales);
      const count = await sandboxNumber(await read(list, "length"), budget, context);
      const length = Number.isNaN(count) || count <= 0 ? 0 : Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER);
      for (let index = 0; index < length; index++) {
        budget.visitNode();
        const key = String(index);
        if (getSandboxPropertyDescriptor(list, key, budget) === undefined &&
            !(isFloat32Array(list) && Object.hasOwn(list, key))) continue;
        const value = await read(list, key);
        if (typeof value !== "string" && (typeof value !== "object" || value === null))
          throw new TypeError("Locale entries must be strings or objects.");
        const tag = await sandboxString(value, budget, context);
        budget.visitNode(tag.length);
        const canonical = canonicalLocales(tag)[0]!;
        budget.visitNode(locales.length);
        if (!locales.includes(canonical)) locales.push(budget.allocateString(canonical));
      }
    }
    const inputOptions = args[1] === undefined ? Object.create(null) as SandboxValue : toObject(args[1]);
    for (const [key, type] of dateTimeOptions) {
      const value = await read(inputOptions, key);
      if (value === undefined) continue;
      if (type === "boolean") options[key] = Boolean(value);
      else if (type === "number") {
        const number = await sandboxNumber(value, budget, context);
        if (!Number.isFinite(number) || number < 1 || number > 3)
          throw new RangeError("fractionalSecondDigits must be between 1 and 3.");
        options[key] = Math.floor(number);
      } else {
        const text = await sandboxString(value, budget, context);
        budget.visitNode(text.length);
        if (type === "unicodeType") {
          const valid = text.split("-").every(part => part.length >= 3 && part.length <= 8 &&
            [...part].every(char => char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char >= "0" && char <= "9"));
          if (!valid) throw new RangeError(`Invalid ${key} option.`);
        } else if (type === "zone") {
          // Validate before accessing later guest options. Only a primitive crosses into ICU.
          new NativeDateTimeFormat("en", { timeZone: text });
        } else if (!type.includes(text)) throw new RangeError(`Invalid ${key} option.`);
        options[key] = text;
      }
    }
    const date = name !== "toLocaleTimeString";
    const clock = name !== "toLocaleDateString";
    if (options.dateStyle !== undefined || options.timeStyle !== undefined) {
      if (!date && options.dateStyle !== undefined || !clock && options.timeStyle !== undefined)
        throw new TypeError("Date/time style is incompatible with this locale method.");
    } else {
      const hasDate = date && ["weekday", "year", "month", "day"].some(key => options[key] !== undefined);
      const hasTime = clock && ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"].some(key => options[key] !== undefined);
      if (!hasDate && !hasTime) {
        if (date) for (const key of ["year", "month", "day"]) options[key] = "numeric";
        if (clock) for (const key of ["hour", "minute", "second"]) options[key] = "numeric";
      }
    }
    const formatter = new NativeDateTimeFormat(locales, options as Intl.DateTimeFormatOptions);
    return budget.allocateString(formatter.format(time));
  } finally { release(); }
}
