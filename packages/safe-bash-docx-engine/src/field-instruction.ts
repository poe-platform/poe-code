import { DocxUsageError } from "./argument-json.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { UnsupportedEditError } from "./xml-write.js";

export function fieldInstructionTokens(instruction: string): { value: string; start: number; end: number }[] {
  const tokens: { value: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < instruction.length) {
    while (i < instruction.length && " \t\r\n".includes(instruction[i]!)) i++;
    if (i === instruction.length) break;
    const start = i, quoted = instruction[i] === '"';
    if (quoted) i++;
    const valueStart = i;
    while (i < instruction.length && (quoted ? instruction[i] !== '"' : !" \t\r\n".includes(instruction[i]!))) i++;
    const value = instruction.slice(valueStart, i);
    if (quoted) {
      if (i === instruction.length) throw new UnsupportedEditError("Malformed quoted field operand.");
      i++;
    }
    tokens.push({ value, start, end: i });
  }
  return tokens;
}

export function editFieldInstruction(instruction: string, options: DocxOperationArguments<"fields.set">): string {
  const tokens = fieldInstructionTokens(instruction), kind = tokens[0]!.value.toUpperCase();
  if (options.kind !== undefined) return fieldInstruction(options.kind, options.target, options.levels);
  if (options.target !== undefined) {
    fieldInstruction(kind, options.target, options.levels);
    const operand = tokens[1];
    if (!operand || operand.value.startsWith("\\")) throw new UnsupportedEditError("Field has no literal target operand.");
    return instruction.slice(0, operand.start) + `"${options.target}"` + instruction.slice(operand.end);
  }
  fieldInstruction(kind, undefined, options.levels);
  const switches = tokens.flatMap((token, i) => token.value === "\\o" ? [i] : []);
  if (switches.length > 1) throw new UnsupportedEditError("Ambiguous TOC level switches.");
  const value = `"${options.levels!.start}-${options.levels!.end}"`;
  if (!switches.length) return instruction + ` \\o ${value} `;
  const operand = tokens[switches[0]! + 1];
  if (!operand || operand.value.startsWith("\\")) throw new UnsupportedEditError("TOC level switch has no operand.");
  return instruction.slice(0, operand.start) + value + instruction.slice(operand.end);
}

/** Typed instruction construction; operands cannot introduce field switches. */
export function fieldInstruction(kind: string, target?: string, levels?: { readonly start: number; readonly end: number }): string {
  if (!["PAGE", "NUMPAGES", "REF", "PAGEREF", "SEQ", "TOC"].includes(kind)) throw new DocxUsageError("Unsupported field kind.");
  const needsTarget = ["REF", "PAGEREF", "SEQ"].includes(kind);
  if (needsTarget !== (target !== undefined)) throw new DocxUsageError("Field target does not match its kind.");
  if (target !== undefined && (!target || [...target].some(c => c.charCodeAt(0) < 32 || '\\"'.includes(c)))) throw new DocxUsageError("Invalid field operand.");
  if (levels !== undefined && (kind !== "TOC" || !Number.isInteger(levels.start) || !Number.isInteger(levels.end) || levels.start < 1 || levels.end > 9 || levels.start > levels.end)) throw new DocxUsageError("Invalid TOC levels.");
  return ` ${kind}${target === undefined ? "" : ` "${target}"`}${levels === undefined ? "" : ` \\o "${levels.start}-${levels.end}"`} `;
}
