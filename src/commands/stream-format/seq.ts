import type { CommandDefinition } from "../../contracts/index.js";
import { UsageError } from "../internal.js";
import { command, type Session, type StreamFormatLimits } from "./shared.js";

interface Decimal { readonly coefficient: bigint; readonly scale: number; readonly precision: number }
interface Format { readonly prefix: string; readonly suffix: string; readonly flags: string; readonly width: number; readonly precision: number; readonly kind: string }

function decimal(text: string, session: Session): Decimal {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(text.trim());
  if (!match) throw new UsageError(`invalid decimal argument: '${text}'`);
  const fraction = match[3] ?? match[4] ?? "";
  const digits = (match[2] ?? "0") + fraction;
  const exponent = Number(match[5] ?? 0);
  session.check(digits.length, session.limits.maxNumericDigits, "numeric digit");
  session.check(Math.abs(exponent), session.limits.maxNumericDigits, "numeric exponent");
  const scale = fraction.length - exponent;
  session.check(Math.max(digits.length, digits.length - scale, scale), session.limits.maxNumericDigits, "numeric digit");
  return { coefficient: BigInt((match[1] === "-" ? "-" : "") + digits), scale, precision: Math.max(0, scale) };
}

function rounded(coefficient: bigint, scale: number, precision: number): bigint {
  if (precision >= scale) return coefficient * 10n ** BigInt(precision - scale);
  const divisor = 10n ** BigInt(scale - precision);
  const quotient = coefficient / divisor;
  const remainder = coefficient % divisor;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  return quotient + (twice > divisor || twice === divisor && quotient % 2n !== 0n ? coefficient < 0n ? -1n : 1n : 0n);
}

function fixed(coefficient: bigint, scale: number, precision: number): string {
  const value = rounded(coefficient, scale, precision);
  const negative = coefficient < 0n;
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, "0");
  return (negative ? "-" : "") + (precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits);
}

function exponentOf(coefficient: bigint, scale: number): number {
  return coefficient === 0n ? 0 : (coefficient < 0n ? -coefficient : coefficient).toString().length - scale - 1;
}

function formatted(coefficient: bigint, scale: number, format: Format): string {
  const kind = format.kind.toLowerCase();
  let precision = format.precision;
  let exponent = exponentOf(coefficient, scale);
  let text: string;
  if (kind === "f") text = fixed(coefficient, scale, precision);
  else {
    if (kind === "g") precision = Math.max(1, precision);
    const significant = kind === "g" ? precision : precision + 1;
    const significantScale = significant - exponent - 1;
    const value = rounded(coefficient, scale, significantScale);
    exponent = exponentOf(value, significantScale);
    if (kind === "e" || exponent < -4 || exponent >= precision) {
      text = fixed(value, significantScale + exponent, significant - 1);
      if (kind === "g" && !format.flags.includes("#") && text.includes(".")) text = text.replace(/\.?0+$/u, "");
      if (format.flags.includes("#") && !text.includes(".")) text += ".";
      text += `e${exponent < 0 ? "-" : "+"}${Math.abs(exponent).toString().padStart(2, "0")}`;
    } else {
      text = fixed(value, significantScale, Math.max(0, precision - exponent - 1));
      if (!format.flags.includes("#") && text.includes(".")) text = text.replace(/\.?0+$/u, "");
    }
  }
  if (format.flags.includes("#") && !text.includes(".") && !text.includes("e")) text += ".";
  if (coefficient >= 0n) text = (format.flags.includes("+") ? "+" : format.flags.includes(" ") ? " " : "") + text;
  if (format.kind === format.kind.toUpperCase()) text = text.toUpperCase();
  if (format.flags.includes("-")) text = text.padEnd(format.width, " ");
  else if (format.flags.includes("0")) {
    const sign = /^[+ -]/u.test(text) ? text[0]! : "";
    text = sign + text.slice(sign.length).padStart(Math.max(0, format.width - sign.length), "0");
  } else text = text.padStart(format.width, " ");
  return format.prefix + text + format.suffix;
}

function parseFormat(text: string, session: Session): Format {
  let literal = "", result: Format | undefined;
  for (let offset = 0; offset < text.length; offset++) {
    if (text[offset] !== "%") { literal += text[offset]; continue; }
    if (text[offset + 1] === "%") { literal += "%"; offset++; continue; }
    if (result) throw new UsageError("format must contain exactly one conversion");
    const match = /^%([-+ #0]*)(\d*)(?:\.(\d*))?L?([fFeEgG])/u.exec(text.slice(offset));
    if (!match) throw new UsageError("format requires one f, e or g conversion");
    const width = Number(match[2] || 0), precision = match[3] === undefined ? 6 : Number(match[3]);
    session.check(width, session.limits.maxRecordBytes, "format width");
    session.check(precision, session.limits.maxNumericDigits, "format precision");
    result = { prefix: literal, suffix: "", flags: match[1]!, width, precision, kind: match[4]! };
    literal = ""; offset += match[0].length - 1;
  }
  if (!result) throw new UsageError("format must contain exactly one conversion");
  return { ...result, suffix: literal };
}

export function createSeqCommand(limits: StreamFormatLimits): CommandDefinition {
  return command("seq", limits, async session => {
    const operands: string[] = [];
    let separator = "\n", equalWidth = false, formatText: string | undefined, ended = false;
    const args = session.context.args;
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!;
      if (ended || !argument.startsWith("-") || /^-[\d.]/u.test(argument)) { operands.push(argument); continue; }
      if (argument === "--") { ended = true; continue; }
      if (argument.startsWith("--")) {
        const equals = argument.indexOf("=");
        const key = argument.slice(2, equals < 0 ? undefined : equals);
        if (key === "equal-width" && equals < 0) equalWidth = true;
        else if (key === "separator" || key === "format") {
          const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
          if (value === undefined) throw new UsageError(`option '--${key}' requires an argument`);
          if (key === "separator") separator = value; else formatText = value;
        } else throw new UsageError(`unrecognized option '${argument}'`);
      } else {
        for (let offset = 1; offset < argument.length; offset++) {
          const key = argument[offset]!;
          if (key === "w") equalWidth = true;
          else if (key === "s" || key === "f") {
            const value = argument.slice(offset + 1) || args[++index];
            if (value === undefined) throw new UsageError(`option '-${key}' requires an argument`);
            if (key === "s") separator = value; else formatText = value;
            break;
          } else throw new UsageError(`invalid option -- '${key}'`);
        }
      }
    }
    if (!operands.length || operands.length > 3) throw new UsageError("expected one to three numeric operands");
    if (equalWidth && formatText !== undefined) throw new UsageError("format string may not be specified when printing equal width strings");
    const first = decimal(operands.length === 1 ? "1" : operands[0]!, session);
    const increment = decimal(operands.length === 3 ? operands[1]! : "1", session);
    const last = decimal(operands.at(-1)!, session);
    if (increment.coefficient === 0n) throw new UsageError("invalid Zero increment value");
    const scale = Math.max(0, first.scale, increment.scale, last.scale);
    const align = (value: Decimal): bigint => {
      session.check(value.coefficient.toString().length + scale - value.scale, limits.maxNumericDigits + 1, "numeric digit");
      return value.coefficient * 10n ** BigInt(scale - value.scale);
    };
    let current = align(first);
    const step = align(increment), finish = align(last);
    const precision = Math.max(first.precision, increment.precision);
    const format = formatText === undefined ? undefined : parseFormat(formatText, session);
    const width = equalWidth ? Math.max(fixed(current, scale, precision).length, fixed(finish, scale, precision).length) : 0;
    let written = false;
    while (step > 0n ? current <= finish : current >= finish) {
      await session.step();
      let text = format ? formatted(current, scale, format) : fixed(current, scale, precision);
      if (equalWidth) text = text.startsWith("-") ? "-" + text.slice(1).padStart(width - 1, "0") : text.padStart(width, "0");
      session.check(Buffer.byteLength(text), limits.maxRecordBytes, "record");
      await session.text((written ? separator : "") + text);
      written = true;
      current += step;
    }
    if (written) await session.text("\n");
  });
}
