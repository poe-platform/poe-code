import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { quoteFormulaString } from "../formulas/serialization.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffErrors } from "./biff-formulas.js";
import { BiffStrings } from "./biff-strings.js";

/** Auxiliary payloads follow the token stream in token encounter order.
 * Arrays: Gnumeric 1.12.61 plugins/excel/ms-formula-read.c; cached areas: MS-XLS 2.5.198.61. */
export function biffFormulaExtras(parts: readonly Binary[], revision: number, codepage: number, context: CapabilityContext,
  accountWork?: (amount: number) => void): { readArray(): string; readMemory(): void } {
  const cursor = new BiffStrings(parts, context, codepage);
  const number = new Uint8Array(8), view = new DataView(number.buffer);
  const encoder = new TextEncoder();
  const workLimit = context.limits.workbookWork ?? context.limits.inputBytes * 8;
  const textLimit = context.limits.workbookTextBytes ?? context.limits.inputBytes;
  let work = 0, textBytes = 0;
  const readArray = () => {
    context.signal.throwIfAborted();
    const width = cursor.byte(), height = cursor.word();
    const columns = revision >= 8 ? width + 1 : width || 256;
    const rows = revision >= 8 ? height + 1 : height || 1;
    work += columns * rows;
    if (work > workLimit) throw new SsconvertError("resource-limit", "ssconvert BIFF array work limit exceeded");
    accountWork?.(columns * rows);
    const chunks: string[] = [];
    const append = (text: string) => {
      textBytes += encoder.encode(text).length;
      if (textBytes > textLimit) throw new SsconvertError("resource-limit", "ssconvert BIFF array text limit exceeded");
      chunks.push(text);
    };
    append("{");
    for (let row = 0; row < rows; row++) {
      if (row) append(";");
      for (let column = 0; column < columns; column++) {
        context.signal.throwIfAborted();
        if (column) append(",");
        const kind = cursor.byte();
        if (kind === 2) {
          const length = revision >= 8 ? cursor.word() : cursor.byte();
          const value = revision >= 8 ? cursor.unicode(length).text : cursor.legacy(length);
          append(quoteFormulaString(value, '"', gnumericGrammar));
        } else {
          if (![0, 1, 4, 16].includes(kind)) invalidBiff("invalid array value type");
          for (let i = 0; i < 8; i++) number[i] = cursor.byte();
          if (kind === 1) {
            const value = view.getFloat64(0, true);
            if (!Number.isFinite(value)) invalidBiff("nonfinite array number");
            append(String(value));
          } else append(kind === 0 ? "" : kind === 4 ? number[0] ? "TRUE" : "FALSE" : biffErrors[number[0]!] ?? '#"#UNKNOWN!"');
        }
      }
    }
    append("}");
    return chunks.join("");
  };
  const readMemory = () => {
    context.signal.throwIfAborted();
    const count = cursor.word();
    work += count * 8;
    if (work > workLimit) throw new SsconvertError("resource-limit", "ssconvert BIFF cached area work limit exceeded");
    accountWork?.(count * 8);
    // These absolute ranges are an evaluation cache, not formula operands.
    // Consume them without allocating a second reference model.
    for (let area = 0; area < count; area++) {
      context.signal.throwIfAborted();
      for (let byte = 0; byte < 8; byte++) cursor.byte();
    }
  };
  return { readArray, readMemory };
}
