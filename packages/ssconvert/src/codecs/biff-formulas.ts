import { SsconvertError } from "../contracts.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffFunctions } from "./biff-source.js";
import { biffDecode } from "./biff-strings.js";

interface Expression { text: string; precedence: number; }
export interface BiffFormulaContext {
  readonly revision: number;
  readonly codepage: number;
  readonly row: number;
  readonly column: number;
  readonly names: readonly string[];
  readonly nameSheets?: readonly (string | undefined)[];
  /** null is the legacy self-reference placeholder; undefined is an unbound link. */
  readonly externalSheets: readonly (string | readonly [string, string] | null | undefined)[];
  readonly currentSheet?: string;
  readonly localSheets?: readonly string[];
  readonly shared?: boolean;
  readonly limit: number;
}
const binaryOperators: Readonly<Record<number, readonly [string, number]>> = {
  3: ["+", 3], 4: ["-", 3], 5: ["*", 4], 6: ["/", 4], 7: ["^", 5], 8: ["&", 2],
  9: ["<", 1], 10: ["<=", 1], 11: ["=", 1], 12: [">=", 1], 13: [">", 1], 14: ["<>", 1],
  15: [" ", 7], 16: [",", 6], 17: [":", 8]
};
export const biffErrors: Readonly<Record<number, string>> = {
  0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A"
};

export function translateBiffFormula(bytes: Uint8Array, context: BiffFormulaContext): string {
  const data = new Binary(bytes), stack: Expression[] = [];
  let offset = 0, work = 0;
  const push = (text: string, precedence = 99) => {
    work += text.length;
    if (work > context.limit) throw new SsconvertError("resource-limit", "ssconvert BIFF formula work limit exceeded");
    stack.push({ text, precedence });
  };
  function nameText(index: number, fallbackSheet?: string): string {
    const name = context.names[index - 1]!;
    // NAME and self-SUPBOOK NameX select an object by index. Their optional
    // display sheet must not select a different lexical definition.
    const sheet = context.nameSheets === undefined ? fallbackSheet : context.nameSheets[index - 1];
    if (sheet !== undefined) return "'" + sheet.split("'").join("''") + "'!" + name;
    if (context.nameSheets !== undefined) for (let at = 0; at < context.names.length; at++) {
      const other = context.names[at]!;
      work += other.length + 1;
      if (work > context.limit) throw new SsconvertError("resource-limit", "ssconvert BIFF formula work limit exceeded");
      if (context.nameSheets[at] !== undefined && other.toUpperCase() === name.toUpperCase()) return "[]" + name;
    }
    return name;
  }
  const pop = (): Expression => { const value = stack.pop(); if (!value) invalidBiff("formula stack underflow"); return value; };
  const protect = (value: Expression, precedence: number) => value.precedence < precedence ? `(${value.text})` : value.text;
  const reference = (at: number, relative: boolean): string => {
    const rowBits = data.u16(at), colBits = context.revision >= 8 ? data.u16(at + 2) : data.u8(at + 2);
    const rowRelative = context.revision >= 8 ? !!(colBits & 0x8000) : !!(rowBits & 0x8000);
    const colRelative = context.revision >= 8 ? !!(colBits & 0x4000) : !!(rowBits & 0x4000);
    let row = context.revision >= 8 ? rowBits : rowBits & 0x3fff, column = colBits & 255;
    if (relative && rowRelative) row = (context.row + (context.revision >= 8 ? row >= 32768 ? row - 65536 : row : row >= 8192 ? row - 16384 : row) + 65536) % 65536;
    if (relative && colRelative) column = (context.column + (column >= 128 ? column - 256 : column) + 256) % 256;
    let letters = ""; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
    return `${colRelative ? "" : "$"}${letters}${rowRelative ? "" : "$"}${row + 1}`;
  };
  const area = (at: number, relative: boolean): string => {
    const width = context.revision >= 8 ? 2 : 1;
    const first = new Uint8Array(2 + width), last = new Uint8Array(2 + width);
    first.set(data.slice(at, 2)); first.set(data.slice(at + 4, width), 2);
    last.set(data.slice(at + 2, 2)); last.set(data.slice(at + 4 + width, width), 2);
    const refContext = { ...context };
    // Translate two Ref tokens using the same revision/relative rules.
    const token = relative ? 0x2c : 0x24;
    return translateBiffFormula(new Uint8Array([token, ...first]), refContext).slice(1) + ":" +
      translateBiffFormula(new Uint8Array([token, ...last]), refContext).slice(1);
  };
  while (offset < bytes.length) {
    const raw = data.u8(offset++), token = raw >= 0x20 ? (raw & 0x1f) | 0x20 : raw;
    if (binaryOperators[token]) {
      const [operator, precedence] = binaryOperators[token]!, right = pop(), left = pop();
      push(protect(left, precedence) + operator + protect(right, precedence + (token === 4 || token === 6 || token === 7 ? 1 : 0)), precedence);
    } else if (token === 0x12 || token === 0x13) { const value = pop(); push((token === 0x12 ? "+" : "-") + protect(value, 5), 5); }
    else if (token === 0x14) { const value = pop(); push(protect(value, 6) + "%", 6); }
    else if (token === 0x15) push("(" + pop().text + ")");
    else if (token === 0x16) push("");
    else if (token === 0x17) {
      const length = data.u8(offset++); let text: string;
      if (context.revision >= 8) {
        const flags = data.u8(offset++); if (flags > 1) invalidBiff("invalid formula string flags");
        text = flags ? new TextDecoder("utf-16le").decode(data.slice(offset, length * 2)) : biffDecode(data.slice(offset, length), 1200);
        offset += length * (flags ? 2 : 1);
      } else { text = biffDecode(data.slice(offset, length), context.codepage); offset += length; }
      push('"' + text.split('"').join('""') + '"');
    } else if (token === 0x19) {
      const flags = data.u8(offset), value = data.u16(offset + 1); offset += 3;
      if (flags & 4) { data.check(offset, (value + 1) * 2); offset += (value + 1) * 2; }
      if (flags & 16) push("SUM(" + pop().text + ")");
    } else if (token === 0x1c) push(biffErrors[data.u8(offset++)] ?? "#UNKNOWN!");
    else if (token === 0x1d) push(data.u8(offset++) ? "TRUE" : "FALSE");
    else if (token === 0x1e) { push(String(data.u16(offset))); offset += 2; }
    else if (token === 0x1f) { const value = data.f64(offset); if (!Number.isFinite(value)) invalidBiff("invalid formula number"); push(String(value)); offset += 8; }
    else if (token === 0x21 || token === 0x22) {
      const argc = token === 0x22 ? data.u8(offset++) & 0x7f : undefined;
      const index = context.revision >= 4 ? data.u16(offset) : data.u8(offset); offset += context.revision >= 4 ? 2 : 1;
      const descriptor = biffFunctions[index & 0x7fff];
      if (!descriptor || argc === undefined && descriptor[1] !== descriptor[2])
        throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: BIFF function ${index}`);
      const count = argc ?? descriptor[1]; if (count < 0 || count > stack.length) invalidBiff("invalid function argument count");
      const args = stack.splice(stack.length - count, count).map(value => value.text);
      push(descriptor[0] + "(" + args.join(",") + ")");
    } else if (token === 0x39) {
      const width = context.revision >= 8 ? 6 : 24;
      data.check(offset, width);
      const rawSheet = data.u16(offset), signedSheet = rawSheet >= 32768 ? rawSheet - 65536 : rawSheet;
      const index = data.u16(offset + (context.revision >= 8 ? 2 : 10));
      offset += width;
      if (context.revision < 8 && signedSheet >= 0)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: external BIFF workbook reference");
      const binding = context.externalSheets[context.revision >= 8 ? rawSheet : -signedSheet - 1];
      if (binding === undefined)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: external BIFF workbook reference");
      const name = context.names[index - 1];
      if (!name) { push("#REF!"); continue; }
      const sheet = binding === null ? context.nameSheets?.[index - 1] ?? context.currentSheet : typeof binding === "string" ? binding : binding[0];
      push(nameText(index, sheet));
    } else if (token === 0x23) {
      const index = data.u16(offset), width = context.revision >= 8 ? 4 : context.revision >= 5 ? 14 : 10;
      data.check(offset, width); offset += width;
      const name = context.names[index - 1]; if (!name) invalidBiff("invalid formula name index");
      push(nameText(index));
    } else if (token === 0x24 || token === 0x2c) { push(reference(offset, token === 0x2c)); offset += context.revision >= 8 ? 4 : 3; }
    else if (token === 0x25 || token === 0x2d) { push(area(offset, token === 0x2d)); offset += context.revision >= 8 ? 8 : 6; }
    else if (token === 0x2a || token === 0x2b) { const size = context.revision >= 8 ? token === 0x2a ? 4 : 8 : token === 0x2a ? 3 : 6; data.check(offset, size); offset += size; push("#REF!"); }
    else if (token === 0x3c || token === 0x3d) {
      const size = context.revision >= 8 ? token === 0x3c ? 6 : 10 : token === 0x3c ? 17 : 20;
      data.check(offset, size); offset += size; push("#REF!");
    }
    else if (token === 0x3a || token === 0x3b) {
      let sheet: (typeof context.externalSheets)[number];
      if (context.revision >= 8) { sheet = context.externalSheets[data.u16(offset)]; offset += 2; }
      else {
        const size = token === 0x3a ? 17 : 20;
        data.check(offset, size);
        const signed = (at: number) => { const value = data.u16(at); return value >= 32768 ? value - 65536 : value; };
        const index = signed(offset), firstIndex = signed(offset + 10), lastIndex = signed(offset + 12);
        if (firstIndex < 0 || lastIndex < 0) { offset += size; push("#REF!"); continue; }
        const first = context.externalSheets[Math.abs(index) - 1];
        // Standard BIFF5/7 uses zero-based physical sheet fields. Preserve the
        // older native table-index convention when that first field does not
        // agree with both the signed link and the bound workbook sheet.
        const physical = index < 0 && firstIndex === -index - 1 && typeof first === "string" && context.localSheets?.[firstIndex] === first;
        const last = physical ? context.localSheets?.[lastIndex] : index < 0 && firstIndex === lastIndex ? first : index < 0 && lastIndex === 0 ?
          context.currentSheet ?? null : context.externalSheets[lastIndex - 1];
        if (first === undefined || last === undefined || typeof first === "object" && first !== null || typeof last === "object" && last !== null)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: external BIFF workbook reference");
        sheet = first === null ? null : last === null || first === last ? first : [first, last];
        offset += 14;
      }
      if (sheet === undefined) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: external BIFF workbook reference");
      const relative = context.revision < 8 && !!context.shared;
      const ref = token === 0x3a ? reference(offset, relative) : area(offset, relative);
      offset += context.revision >= 8 ? token === 0x3a ? 4 : 8 : token === 0x3a ? 3 : 6;
      const endpoints = sheet === null ? [] : typeof sheet === "string" ? [sheet] : sheet;
      const qualifier = endpoints.map(name => "'" + name.split("'").join("''") + "'").join(":");
      push((qualifier ? qualifier + "!" : "") + ref);
    } else if (token === 0x26 || token === 0x27 || token === 0x28) { data.check(offset, 6); offset += 6; }
    else if (token === 0x29) { data.check(offset, 2); offset += 2; }
    else throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: BIFF formula token 0x${raw.toString(16)}`);
  }
  if (stack.length !== 1) invalidBiff("formula stack did not resolve");
  return "=" + stack[0]!.text;
}
