import { ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { patchTextBytes, type PatchText } from "./patch-text.js";
import type { PatchInput } from "./unified.js";

/** Validate the grammar without materializing the optional, arbitrarily long section. */
export async function validateSection(section: PatchText, budget: Budget, message: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let first = true;
  for await (const bytes of patchTextBytes(section)) {
    const text = decoder.decode(bytes, { stream: true });
    if (text.length) {
      if (first && text[0] !== " " || /[\r\n\u2028\u2029]/u.test(text)) throw new ToolError(message);
      first = false;
    }
    budget.step(bytes.length); const pause = budget.checkpoint(); if (pause) await pause;
  }
  decoder.decode();
}

export async function unifiedHeader(input: PatchInput, index: number, budget: Budget): Promise<{ header: string; section: PatchText; invalidCoordinate?: string }> {
  if (!input.body) {
    const text = (await input.read(index))!;
    const end = text.indexOf("@@", 2);
    if (end < 0) return { header: text, section: "" };
    return { header: text.slice(0, end + 2), section: text.slice(end + 2) };
  }
  const source = await input.body(index, 0, true);
  const fields = Array.from({ length: 4 }, () => ({ value: 0, prefix: "", digits: 0 }));
  let field = 0, literal = "@@ -", literalIndex = 0, position = 0;
  const malformed = () => new ToolError("malformed unified hunk header");
  for await (const bytes of patchTextBytes(source)) {
    budget.step(bytes.length); const pause = budget.checkpoint(); if (pause) await pause;
    for (const byte of bytes) {
      position++;
      if (literalIndex < literal.length) {
        if (byte !== literal.charCodeAt(literalIndex++)) throw malformed();
        if (literalIndex === literal.length && literal === "@@") {
          const names = ["old start", "old count", "new start", "new count"];
          const invalid = fields.findIndex(value => !Number.isSafeInteger(value.value));
          const value = (index: number) => {
            const part = fields[index]!;
            // Short spellings remain unchanged; leading zeros need no retained copy.
            return !Number.isSafeInteger(part.value) ? "0" : part.digits <= 1001 ? part.prefix : String(part.value);
          };
          const header = `@@ -${value(0)}${fields[1]!.digits ? `,${value(1)}` : ""} +${value(2)}${fields[3]!.digits ? `,${value(3)}` : ""} @@`;
          return { header, section: await input.body(index, position, true),
            ...(invalid < 0 ? {} : { invalidCoordinate: `invalid ${names[invalid]}: ${fields[invalid]!.prefix}` }) };
        }
        continue;
      }
      const part = fields[field]!;
      if (byte >= 48 && byte <= 57) {
        part.digits++;
        if (part.prefix.length < 1001) part.prefix += String.fromCharCode(byte);
        part.value = part.value * 10 + (byte - 48);
        if (!Number.isSafeInteger(part.value)) part.value = Infinity;
      } else {
        if (!part.digits) throw malformed();
        if (byte === 44 && (field === 0 || field === 2)) field++;
        else if (byte === 32) {
          literal = field < 2 ? "+" : "@@"; literalIndex = 0;
          field = field < 2 ? 2 : 4;
        } else throw malformed();
      }
    }
  }
  throw malformed();
}
