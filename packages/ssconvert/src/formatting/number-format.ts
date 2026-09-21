import type { CellValue } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { error, numeric } from "../formulas/values.js";
import { boundedText, unsupported } from "../formulas/functions/common.js";
import { FormatSyntaxError, parseFormatSections, selectFormatSection } from "./sections.js";
import { numericFormat, scanFormat } from "./numeric.js";
import { formattingLocale, localizedValueText, type FormattingLocaleProfile } from "./locale.js";

export interface FormatHost {
  readonly book: { readonly dateSystem?: "1900" | "1904" };
  readonly context: CapabilityContext;
  readonly unicodeMinus?: boolean;
  readonly locale?: FormattingLocaleProfile;
  tick(): void;
}

export function rounded(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  if (scale === 0) return 0;
  if (decimals >= 0 && Number.isInteger(value)) return value;
  if (!Number.isFinite(Math.abs(value) * scale)) return value;
  return Math.sign(value) * Math.floor(Math.abs(value) * scale + .5) / scale;
}
export function fixedNumber(value: number, decimals: number, grouping: boolean, decimalShift = 0): string {
  // Decimal printf rounds the binary64 input once. Pre-rounding with a
  // multiplication loses which side of a decimal halfway point it occupies.
  const number = decimals < 0 ? rounded(value, decimals) : value;
  const count = Math.max(0, decimals);
  // JS toFixed caps at 100. For longer precision, round the exact binary64
  // rational once rather than padding a value already rounded to 100 places.
  let text = Math.abs(number).toFixed(Math.min(count, 100));
  if (count > 100 || decimalShift !== 0) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(number));
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
    const precision = count + decimalShift;
    const shift = (exponent ? exponent - 1023 - 52 : -1074) + precision;
    let integer = mantissa * 5n ** BigInt(Math.max(0, precision));
    let divisor = 5n ** BigInt(Math.max(0, -precision));
    if (shift >= 0) integer <<= BigInt(shift);
    else divisor <<= BigInt(-shift);
    integer = (integer * 2n + divisor) / (divisor * 2n);
    const digits = integer.toString().padStart(count + 1, "0");
    text = count ? digits.slice(0, -count) + "." + digits.slice(-count) : digits;
  } else if (text.includes("e")) {
    // All binary64 values at this magnitude are integers. Shortest exponent
    // digits do not describe their exact decimal integer for printf-style F.
    text = BigInt(Math.abs(number)).toString();
    if (count) text += "." + "0".repeat(count);
  }
  if (grouping) {
    const dot = text.indexOf("."), stop = dot < 0 ? text.length : dot;
    let grouped = "";
    for (let i = 0; i < stop; i++) { if (i && (stop - i) % 3 === 0) grouped += ","; grouped += text[i]; }
    text = grouped + text.slice(stop);
  }
  return (number < 0 && Number(text.split(",").join("")) !== 0 ? "-" : "") + text;
}
function nextPositiveFloat(value: number): number {
  if (!value || !Number.isFinite(value)) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

// Port of GOffice's bounded convergent selection (not a nearest-denominator search).
function fractionFormat(value: number, pattern: string, host: FormatHost): CellValue | undefined {
  const slash = pattern.indexOf("/");
  if (slash < 0 || !Array.from(pattern).every(c => "0123456789#? /".includes(c))) return undefined;
  if (slash !== pattern.lastIndexOf("/")) return error("#VALUE!");
  const left = pattern.slice(0, slash).trimEnd(), right = pattern.slice(slash + 1);
  const boundary = left.lastIndexOf(" "), mixed = boundary > 0;
  const wholePattern = mixed ? left.slice(0, boundary) : "", numeratorPattern = mixed ? left.slice(boundary + 1) : left;
  const denominatorPattern = right.trim(), separator = right.slice(0, right.length - right.trimStart().length);
  if (!numeratorPattern || !denominatorPattern || !Array.from(numeratorPattern + wholePattern).every(c => "0#?".includes(c))) unsupported(`TEXT fraction format ${pattern}`);
  const explicit = Array.from(denominatorPattern).some(c => c >= "1" && c <= "9");
  if (!explicit && !Array.from(denominatorPattern).every(c => "0#?".includes(c))) unsupported(`TEXT fraction denominator ${pattern}`);
  if (explicit && !Array.from(denominatorPattern).every(c => c >= "0" && c <= "9")) return error("#VALUE!");
  const absolute = Math.abs(value), adjusted = Number.isInteger(absolute) ? absolute : nextPositiveFloat(absolute);
  let whole = Math.floor(adjusted), numerator: number, denominator: number;
  const fractional = adjusted - whole;
  if (explicit) { denominator = Number(denominatorPattern); numerator = Math.floor(fractional * denominator + .5); }
  else {
    const maximum = Math.min(2147483647, 10 ** Math.min(10, denominatorPattern.length) - 1);
    let n1 = 0, d1 = 1, n2 = 1, d2 = 0, x = fractional, y = 1;
    do {
      host.tick(); const quotient = Math.floor(x / y), remainder = x - quotient * y;
      if (n2 && quotient > (2147483647 - n1) / n2 || d2 && quotient > (2147483647 - d1) / d2 || quotient * d2 + d1 > maximum) break;
      const n3 = quotient * n2 + n1, d3 = quotient * d2 + d1;
      x = y; y = remainder; n1 = n2; n2 = n3; d1 = d2; d2 = d3;
    } while (y > 1e-10);
    numerator = n2; denominator = d2;
  }
  if (adjusted - absolute >= 1 / denominator) unsupported("TEXT fraction epsilon boundary");
  if (mixed && numerator === denominator) { whole++; numerator = 0; }
  if (!mixed) numerator += denominator * whole;
  if (![whole, numerator, denominator].every(Number.isSafeInteger) || !denominator) unsupported("TEXT fraction binary64 boundary");
  const digits = (number: number, template: string): string => {
    let source = number.toString(), result = "";
    for (let index = template.length - 1; index >= 0; index--) {
      host.tick(); const c = template[index]!;
      if (source) { result = source.at(-1) + result; source = source.slice(0, -1); }
      else if (c === "0") result = "0" + result;
      else if (c === "?") result = " " + result;
    }
    return source + result;
  };
  let fraction = digits(numerator, numeratorPattern) + pattern.slice(left.length, slash) + "/" + separator + (explicit ? denominatorPattern : digits(denominator, denominatorPattern));
  const blank = mixed && numerator === 0 && !numeratorPattern.includes("0");
  if (blank) fraction = " ".repeat(fraction.length);
  const wholeText = mixed && (whole || blank || wholePattern.includes("0")) ? digits(whole, wholePattern) + " " : "";
  return boundedText((value < 0 ? host.unicodeMinus ? "−" : "-" : "") + wholeText + fraction + right.slice(right.trimEnd().length), host);
}

function specialNumericFormat(value: number, pattern: string, host: FormatHost): CellValue | undefined {
  const fraction = fractionFormat(value, pattern, host); if (fraction) return fraction;
  const upper = pattern.toUpperCase(), exponentPosition = upper.indexOf("E");
  if (exponentPosition >= 0 && Array.from(pattern.slice(0, exponentPosition)).every(c => "0#.".includes(c))) {
    const mantissa = pattern.slice(0, exponentPosition), exponentPattern = pattern.slice(exponentPosition + 1);
    if (!["+", "-"].includes(exponentPattern[0] ?? "") || !exponentPattern.slice(1) || !Array.from(exponentPattern.slice(1)).every(c => c === "0")) return error("#VALUE!");
    const dot = mantissa.indexOf("."), width = dot < 0 ? mantissa.length : dot, decimals = dot < 0 ? 0 : mantissa.length - dot - 1;
    if (width < 1) unsupported(`TEXT scientific format ${pattern}`);
    // log10 can round a value just below a decimal power up to that power.
    // Seventeen significant digits distinguish every binary64 neighbour.
    let exponent = value ? Math.floor(Number(value.toExponential(16).split("e")[1]) / width) * width : 0;
    let scaled = value / 10 ** exponent;
    if (exponent < -308) {
      const [mantissa, power] = value.toExponential(16).split("e");
      scaled = Number(mantissa) * 10 ** (Number(power) - exponent);
    }
    if (!Number.isFinite(scaled)) unsupported("TEXT scientific subnormal boundary");
    let exact = fixedNumber(value, decimals % 256, false, -exponent);
    if (exact.split(".")[0]!.replace("-", "").length > width) {
      exponent += width; scaled /= 10 ** width;
      exact = fixedNumber(value, decimals % 256, false, -exponent);
    }
    const formatted = numericFormat(scaled, mantissa, host, exact.startsWith("-") ? exact.slice(1) : exact);
    if (formatted.kind !== "string") return formatted;
    return boundedText(formatted.value + "E" + (exponent < 0 ? host.unicodeMinus ? "−" : "-" : exponentPattern[0] === "+" ? "+" : "") + Math.abs(exponent).toString().padStart(exponentPattern.length - 1, "0"), host);
  }
  const tokens: { text: string; literal: boolean; escaped?: boolean }[] = [];
  let dateFormat = false, fractionDigits = 0;
  for (let index = 0; index < pattern.length;) {
    host.tick(); const c = pattern[index]!;
    if (c === '"') {
      const end = pattern.indexOf('"', index + 1); if (end < 0) return error("#VALUE!");
      tokens.push({ text: pattern.slice(index + 1, end), literal: true, escaped: true }); index = end + 1;
    } else if (c === "\\") { tokens.push({ text: pattern[index + 1] ?? "", literal: true, escaped: true }); index += 2; }
    else if (pattern.slice(index, index + 5).toUpperCase() === "AM/PM" || pattern.slice(index, index + 3).toUpperCase() === "A/P") {
      const count = pattern.slice(index, index + 5).toUpperCase() === "AM/PM" ? 5 : 3;
      tokens.push({ text: pattern.slice(index, index + count), literal: false }); index += count; dateFormat = true;
    } else if (c === "[") {
      const end = pattern.indexOf("]", index + 1), unit = pattern[index + 1]?.toLowerCase();
      if (end > index + 1 && unit && "hms".includes(unit) && Array.from(pattern.slice(index + 1, end)).every(letter => letter.toLowerCase() === unit)) {
        tokens.push({ text: pattern.slice(index, end + 1).toLowerCase(), literal: false }); index = end + 1; dateFormat = true;
      } else { tokens.push({ text: c, literal: true }); index++; }
    } else if (c === "." && pattern[index + 1] === "0") {
      const from = index++; while (pattern[index] === "0") index++;
      tokens.push({ text: pattern.slice(from, index), literal: false }); fractionDigits = Math.max(fractionDigits, index - from - 1);
    } else if ("ymdhs".includes(c.toLowerCase())) {
      const from = index; while (index < pattern.length && pattern[index]!.toLowerCase() === c.toLowerCase()) index++;
      tokens.push({ text: pattern.slice(from, index).toLowerCase(), literal: false }); dateFormat = true;
    } else { tokens.push({ text: c, literal: true }); index++; }
  }
  if (!dateFormat) return undefined;
  if (tokens.some(token => token.literal && !token.escaped && Array.from(token.text).some(c => "[]_*?@Ee0#".includes(c)))) unsupported(`TEXT date format ${pattern}`);
  const elapsed = tokens.filter(token => !token.literal && token.text.startsWith("["));
  const ampm = tokens.some(token => !token.literal && ["AM/PM", "A/P"].includes(token.text.toUpperCase()));
  if (fractionDigits > 3 || elapsed.length > 1 || elapsed.length && ampm) return error("#VALUE!");
  const unit = elapsed[0]?.text[1], scale = 10 ** fractionDigits;
  const roundedUnits = Math.sign(value) * Math.round(nextPositiveFloat(Math.abs(value)) * (86400 * scale));
  const seconds = Math.floor(roundedUnits / scale), clock = (seconds % 86400 + 86400) % 86400;
  let hasDate = false, minuteContext = false, triggerMinutes = true;
  for (let index = 0; index < tokens.length; index++) {
    host.tick(); const token = tokens[index]!; if (token.literal) continue;
    const c = token.text[0]!;
    if ("yd".includes(c)) hasDate = true;
    else if (c === "h" || token.text.startsWith("[h")) minuteContext = true;
    else if (c === "s" || token.text.startsWith("[s")) { if (triggerMinutes) minuteContext = true; triggerMinutes = false; }
    else if (token.text.startsWith("[m")) minuteContext = false;
    else if (c === "m") {
      const next = tokens.slice(index + 1).find(item => !item.literal)?.text[0];
      if (token.text.length <= 2 && (minuteContext || next === "s")) { minuteContext = false; triggerMinutes = false; }
      else hasDate = true;
    }
  }
  const use1904 = host.book.dateSystem === "1904", serial = Math.floor(seconds / 86400);
  if (!Number.isSafeInteger(roundedUnits) || hasDate && !use1904 && serial === 60) return error("#VALUE!");
  const date = new Date(Date.UTC(use1904 ? 1904 : 1899, use1904 ? 0 : 11, use1904 ? 1 : 31) + (serial - (!use1904 && serial > 60 ? 1 : 0)) * 86400000);
  if (hasDate && (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 || !Number.isFinite(date.getTime()))) return error("#VALUE!");
  const profile = host.locale ?? formattingLocale(host.context.environment.locale);
  const months = profile.months, weekdays = profile.weekdays;
  const absoluteSeconds = Math.floor(Math.abs(roundedUnits) / scale);
  const hour = unit === "h" ? Math.floor(absoluteSeconds / 3600) : Math.floor(clock / 3600);
  const minute = unit === "m" ? Math.floor(absoluteSeconds / 60) : Math.floor((unit ? absoluteSeconds : clock) / 60) % 60;
  const second = unit === "s" ? absoluteSeconds : (unit ? absoluteSeconds : clock) % 60;
  let result = "", minutes = false, secondsTriggerMinutes = true;
  for (let index = 0; index < tokens.length; index++) {
    host.tick(); const token = tokens[index]!;
    if (token.literal) { result += token.text; continue; }
    if (token.text.startsWith(".")) {
      const count = token.text.length - 1;
      const fraction = unit ? Math.abs(roundedUnits) % scale : (roundedUnits % scale + scale) % scale;
      result += profile.decimal + fraction.toString().padStart(fractionDigits, "0").slice(0, count); continue;
    }
    if (["AM/PM", "A/P"].includes(token.text.toUpperCase())) {
      const pm = hour >= 12;
      result += token.text.length === 5 ? pm ? "PM" : "AM" : token.text[pm ? 2 : 0]; continue;
    }
    const elapsedToken = token.text.startsWith("["), c = elapsedToken ? token.text[1]! : token.text[0]!, count = elapsedToken ? token.text.length - 2 : token.text.length;
    let number: number;
    if (elapsedToken) {
      number = c === "h" ? hour : c === "m" ? minute : second;
      result += (roundedUnits < 0 && absoluteSeconds > 0 ? host.unicodeMinus ? "−" : "-" : "") + number.toString().padStart(count, "0");
      minutes = c === "h" || c === "s" && secondsTriggerMinutes;
      if (c === "s") secondsTriggerMinutes = false;
      continue;
    }
    if (c === "y") number = count <= 2 ? date.getUTCFullYear() % 100 : date.getUTCFullYear();
    else if (c === "d") {
      if (count > 2) { result += count === 3 ? profile.shortWeekdays[date.getUTCDay()]! : weekdays[date.getUTCDay()]!; continue; }
      number = date.getUTCDate();
    } else if (c === "h") { number = ampm ? hour % 12 || 12 : hour; minutes = true; }
    else if (c === "s") { number = second; if (secondsTriggerMinutes) { minutes = true; secondsTriggerMinutes = false; } }
    else {
      const next = tokens.slice(index + 1).find(item => !item.literal)?.text[0];
      if (count <= 2 && (minutes || next === "s")) { number = minute; secondsTriggerMinutes = false; }
      else if (count > 2) {
        const month = months[date.getUTCMonth()]!;
        result += count === 3 ? month.slice(0, 3) : count === 5 ? month[0] : month; continue;
      } else number = date.getUTCMonth() + 1;
      minutes = false;
    }
    result += number.toString().padStart(c === "y" ? count <= 2 ? 2 : 1 : count === 1 ? 1 : 2, "0");
  }
  return boundedText(result, host);
}

/** The supported format grammar is explicit; unimplemented format features remain blockers. */
function generalText(value: CellValue, host: FormatHost): string {
  const text = localizedValueText(value, host.locale ?? formattingLocale(host.context.environment.locale));
  if (!host.unicodeMinus || value.kind !== "number") return text;
  const exponent = text.indexOf("E-");
  const localized = exponent < 0 ? text : text.slice(0, exponent + 1) + "−" + text.slice(exponent + 2);
  return localized.startsWith("-") ? "−" + localized.slice(1) : localized;
}

export function formatText(value: CellValue, pattern: string, host: FormatHost): CellValue {
  formattingLocale(host.context.environment.locale);
  if (value.kind === "boolean" || value.kind === "error") return boundedText(localizedValueText(value, host.locale ?? formattingLocale(host.context.environment.locale)), host);
  if (pattern.toLowerCase() === "general") return boundedText(generalText(value, host), host);
  const n = numeric(value) ?? 0;
  let sections;
  try { sections = parseFormatSections(pattern, host); }
  catch (failure) { if (failure instanceof FormatSyntaxError) return error("#VALUE!"); throw failure; }
  if (value.kind === "string") {
    for (const section of sections) {
      const tokens = scanFormat(section.pattern, host);
      if (tokens.some(token => !token.literal && token.text === "@")) {
        let text = "";
        for (const token of tokens) {
          host.tick(); text += !token.literal && token.text === "@" ? value.value : token.text;
        }
        return boundedText(text, host);
      }
    }
    return boundedText(sections.length === 4 && sections[3]!.pattern === "" ? "" : value.value, host);
  }
  const selected = selectFormatSection(sections, n), section = selected.section.pattern;
  const amount = selected.magnitude ? Math.abs(n) : n;
  const sectionTokens = scanFormat(section, host);
  if (sectionTokens.some(token => !token.literal && token.text === "@")
    && !sectionTokens.some(token => !token.literal && "0#?".includes(token.text)))
    return boundedText(generalText({ kind: "number", value: amount }, host), host);
  if (section.toLowerCase() === "general") return boundedText(generalText({ kind: "number", value: amount }, host), host);
  const special = specialNumericFormat(amount, section, host);
  if (special) return special;
  return numericFormat(amount, section, host);
}
