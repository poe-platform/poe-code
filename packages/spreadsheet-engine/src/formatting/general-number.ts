import {SsconvertError} from "../contracts.js";
import {fixedNumber} from "./number-format.js";
import {formattingLocale} from "./locale.js";

/** Native General precision selection, measured in the caller's font units. */
export function formatGeneralNumber(value: number, initial: string, width: number,
  measure: (text: string) => number, locale: string, tick: () => void, unicodeMinus = true): string {
  const decimal = formattingLocale(locale).decimal;
  const localize = (text: string) => text.split("-").join(unicodeMinus ? "−" : "-").split(".").join(decimal);
  const fits = (text: string) => {tick(); return measure(text) <= width;};
  if (Object.is(value, -0)) initial = localize("-0");
  if (fits(initial)) return initial;
  if (value === 0) return "0";
  const digits = Array.from("0123456789", digit => {tick(); return measure(digit);});
  const minDigit = Math.min(...digits), maxDigit = Math.max(...digits);
  if (!Number.isFinite(minDigit) || minDigit <= 0)
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: PDF number digit metrics");
  const signWidth = measure(localize("-")), absolute = Math.abs(value);
  const capacity = Math.trunc((width - (value <= -0.5 ? signWidth : 0)) / minDigit);
  const maxDigits = Math.min(16, capacity);
  const fixed = (precision: number) => {
    let text = fixedNumber(value, precision, false);
    if (text.includes(".")) {
      while (text.endsWith("0")) text = text.slice(0, -1);
      if (text.endsWith(".")) text = text.slice(0, -1);
    }
    return localize(text);
  };
  if (absolute >= 1e-4 && absolute < 1e15) {
    const whole = fixed(0);
    if (fits(whole)) {
      const wholeDigits = absolute >= 9.5 ? 1 + Math.floor(Math.log10(absolute + 0.5)) : 1;
      if (Number.isInteger(value) || wholeDigits === maxDigits) return whole;
      const integerDigits = absolute >= 10 ? 1 + Math.floor(Math.log10(absolute)) : 1;
      let precision = Math.max(0, maxDigits - integerDigits);
      if (capacity > 16 && Number(fixedNumber(value, precision, false)) !== value) precision++;
      for (; precision >= 0; precision--) {
        const candidate = fixed(precision);
        if (fits(candidate)) return candidate;
      }
      return whole;
    }
  }
  const scientific = (precision: number, trim: boolean) => {
    const [mantissa, power] = value.toExponential(precision).split("e");
    let text = mantissa!;
    if (trim && text.includes(".")) {
      while (text.endsWith("0")) {text = text.slice(0, -1); precision--;}
      if (text.endsWith(".")) text = text.slice(0, -1);
    }
    const exponent = Number(power);
    return {text: localize(`${text}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`), precision};
  };
  let precision = Math.trunc((width - (value < 0 ? signWidth : 0) -
    (absolute < 1 ? signWidth : measure("+")) - measure("E")) / minDigit) - 3;
  if (precision <= 0) {
    const candidate = scientific(0, false).text;
    return absolute >= 0.5 || precision === 0 && fits(candidate) ? candidate : "0";
  }
  let candidate = scientific(Math.min(precision, 14), true);
  precision = candidate.precision;
  while (true) {
    tick();
    const measured = measure(candidate.text);
    if (measured <= width) return candidate.text;
    precision -= precision > 2 && measured - maxDigit > width ? 2 : 1;
    if (precision < 0) return absolute < 0.5 ? "0" : candidate.text;
    candidate = scientific(precision, false);
  }
}
