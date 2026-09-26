import type { CellValue } from "../workbook.js";
import { error } from "../formulas/values.js";
import { boundedText, unsupported } from "../formulas/functions/common.js";
import { fixedNumber, type FormatHost } from "./number-format.js";

export interface FormatToken { readonly text: string; readonly literal: boolean }
export function scanFormat(pattern: string, host: FormatHost): readonly FormatToken[] {
  const tokens: FormatToken[] = [];
  for (let index = 0; index < pattern.length; index++) {
    host.tick(); const c = pattern[index]!;
    if (c === '"') {
      let text = "";
      while (++index < pattern.length && pattern[index] !== '"') { host.tick(); text += pattern[index]; }
      tokens.push({ text, literal: true });
    } else if (c === "\\") tokens.push({ text: pattern[++index] ?? "", literal: true });
    else tokens.push({ text: c, literal: false });
  }
  return tokens;
}

/** Fill digit placeholders from right to left, retaining embedded literals. */
export function numericFormat(value: number, pattern: string, host: FormatHost, exactFixed?: string): CellValue {
  const tokens = scanFormat(pattern, host);
  const isDigit = (token: FormatToken) => !token.literal && "0#?".includes(token.text);
  const decimal = tokens.findIndex(token => !token.literal && token.text === ".");
  if (tokens.filter(token => !token.literal && token.text === ".").length > 1) return error("#VALUE!");
  const whole: number[] = [], fraction: number[] = [];
  let percent = 0;
  for (const [index, token] of tokens.entries()) {
    host.tick();
    if (isDigit(token)) (decimal >= 0 && index > decimal ? fraction : whole).push(index);
    else if (!token.literal && token.text === "%") percent++;
    else if (!token.literal && "[]_*/@EeDdMmYyHhSs".includes(token.text)) unsupported(`TEXT format ${pattern}`);
  }
  if (!whole.length && !fraction.length) return boundedText(tokens.map(token => token.text).join(""), host);
  const lastWhole = whole.at(-1) ?? -1, lastDigit = fraction.at(-1) ?? lastWhole;
  let scaling = 0, grouping = false;
  for (const [index, token] of tokens.entries()) {
    if (token.literal || token.text !== ",") continue;
    if (index > lastDigit || index > lastWhole && (decimal < 0 || index < decimal)) scaling++;
    else if (index < lastWhole) grouping = true;
  }
  const amount = value * 100 ** percent / 1000 ** scaling;
  if (!Number.isFinite(amount)) return error("#VALUE!");
  // GOffice's OP_NUM_PRINTF_F precision operand is one unsigned byte.
  // Placeholder emission still retains the complete requested width.
  const fixed = exactFixed ?? fixedNumber(Math.abs(amount), fraction.length % 256, false), parts = fixed.split(".");
  let integer = parts[0]!;
  if (integer === "0" && decimal >= 0 && !whole.some(index => tokens[index]!.text === "0")) integer = "";
  const replacements = new Map<number, string>();
  let digits = 0;
  for (let position = whole.length - 1; position >= 0; position--) {
    host.tick(); const index = whole[position]!, template = tokens[index]!.text;
    let text = integer ? integer.at(-1)! : template === "0" ? "0" : template === "?" ? " " : "";
    if (integer) integer = integer.slice(0, -1);
    if (text && text !== " ") {
      if (grouping && digits && digits % 3 === 0) text += host.locale?.thousand ?? ",";
      digits++;
    }
    replacements.set(index, text);
  }
  let overflow = "";
  for (let index = integer.length - 1; index >= 0; index--) {
    host.tick(); if (grouping && digits && digits % 3 === 0) overflow = (host.locale?.thousand ?? ",") + overflow;
    overflow = integer[index] + overflow; digits++;
  }
  if (whole.length) replacements.set(whole[0]!, overflow + replacements.get(whole[0]!));
  const decimalDigits = parts[1] ?? "";
  let significant = decimalDigits.length;
  while (significant > 0 && decimalDigits[significant - 1] === "0") significant--;
  for (let index = 0; index < fraction.length; index++) {
    host.tick(); const position = fraction[index]!, template = tokens[position]!.text;
    replacements.set(position, index < significant ? decimalDigits[index]! : template === "0" ? "0" : template === "?" ? " " : "");
  }
  let result = amount < 0 && Number(fixed) !== 0 ? host.unicodeMinus ? "−" : "-" : "";
  for (const [index, token] of tokens.entries()) {
    host.tick();
    if (replacements.has(index)) result += replacements.get(index);
    else if (index === decimal) result += host.locale?.decimal ?? ".";
    else if (!token.literal && token.text === ",") continue;
    else result += token.text;
  }
  return boundedText(result, host);
}
