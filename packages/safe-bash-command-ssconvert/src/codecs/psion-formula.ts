// Psiconv 0.9.9 parse_formula.c; Gnumeric 1.12.61 psiconv-read.c.
// GPL-2.0-or-later. Untranslated Gnumeric functions retain cache only.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1 } from "../workbook.js";
import { psionFormulaArity } from "./psion-formula-functions.js";

export interface PsionFormulaCursor {
  readonly at: number;
  peek(): number;
  u8(): number;
  u16(): number;
  u32(): number;
  s(): number;
  shortText(): string;
  float(): number;
}
export type PsionFormula = string | { readonly reference: readonly [number, number] } |
  { readonly operator: string; readonly operands: readonly PsionFormula[] };
const corrupt = (): never => { throw new SsconvertError("io", "Error while parsing Psion file."); };

export function parsePsionFormula(c: PsionFormulaCursor): PsionFormula | undefined {
  const length = c.s(), end = c.at + length;
  type Frame = { marker?: number; stack: (PsionFormula | undefined)[]; arguments: number };
  const frames: Frame[] = [{ stack: [], arguments: 0 }];
  while (c.at < end) {
    const frame = frames[frames.length - 1]!, op = c.peek();
    if (op === 21 || op === 42 || op === 43) {
      if (frame.stack.length !== 1) corrupt();
      if (frame.marker === undefined) {
        if (c.u8() !== 21 || c.at !== end) corrupt();
        return frame.stack[0];
      }
      frame.arguments++;
      const separator = c.u8();
      if (separator === 42 && c.peek() !== 43) { frame.stack = []; continue; }
      if (separator === 42) c.u8();
      else if (separator !== 43) corrupt();
      if (c.u8() !== frame.marker || c.u16() !== frame.arguments) corrupt();
      frames.pop(); frames[frames.length - 1]!.stack.push(undefined);
      continue;
    }
    c.u8();
    const arity = psionFormulaArity[op];
    if (arity === undefined || arity === null) corrupt();
    if (arity === -1) { frames.push({ marker: op, stack: [], arguments: 0 }); continue; }
    let node: PsionFormula | undefined;
    if (op === 31) node = String(c.float());
    else if (op === 32) { const n = c.u32(); node = String(n >= 2 ** 31 ? n - 2 ** 32 : n); }
    else if (op === 37) c.u32();
    else if (op === 38) node = '"' + c.shortText().split('"').join('""') + '"';
    else if (op >= 39 && op <= 41) {
      const reference = (): PsionFormula => { const row = c.u16(), column = c.u16(); c.u8(); return { reference: [row, column] }; };
      const first = reference();
      if (op === 39) node = first;
      else { const last = reference(); if (op === 40) node = { operator: ":", operands: [first, last] }; }
    } else {
      if (frame.stack.length < arity!) corrupt();
      const operands = frame.stack.splice(frame.stack.length - arity!);
      if (operands.every((n): n is PsionFormula => n !== undefined)) {
        if (op >= 1 && op <= 10) node = { operator: ["<", "<=", ">", ">=", "<>", "=", "+", "-", "*", "/"][op - 1]!, operands };
        else if (op === 12 || op === 13) node = { operator: op === 12 ? "+" : "-", operands };
        else if (op === 18) node = operands[0];
      }
    }
    if (c.at > end) corrupt();
    frame.stack.push(node);
  }
  return corrupt();
}

export function renderPsionFormula(formula: PsionFormula, row: number, column: number,
  context: CapabilityContext, consumeOperation: () => void): string {
  const pending: PsionFormula[] = [formula], chunks: string[] = ["="];
  let length = 1;
  while (pending.length) {
    context.signal.throwIfAborted();
    consumeOperation();
    const node = pending.pop()!;
    let text: string;
    if (typeof node === "string") text = node;
    else if ("reference" in node) {
      const [r, c] = node.reference;
      const coordinate = (raw: number, base: number) => (raw & 0x3fff) * (raw & 0x8000 ? -1 : 1) + (raw & 0x4000 ? 0 : base);
      const rr = coordinate(r, row), cc = coordinate(c, column);
      if (rr < 0 || cc < 0) text = "#REF!";
      else {
        const a1 = formatA1(rr, cc); let split = 0; while (a1[split]! >= "A" && a1[split]! <= "Z") split++;
        text = (c & 0x4000 ? "$" : "") + a1.slice(0, split) + (r & 0x4000 ? "$" : "") + a1.slice(split);
      }
    } else {
      const args = node.operands;
      if (node.operator === ":") pending.push(args[1]!, ":", args[0]!);
      else if (args.length === 1) pending.push(")", args[0]!, "(", node.operator);
      else pending.push(")", args[1]!, node.operator, args[0]!, "(");
      continue;
    }
    length += text.length;
    if (length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert Psion formula length limit exceeded");
    chunks.push(text);
  }
  return chunks.join("");
}
