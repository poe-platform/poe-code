import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { invalidBiff } from './biff-binary.js';
import type { BiffPropertyRange } from './biff-property-range.js';
import { biffDbcsTables } from '@poe-code/spreadsheet-engine/encoding/biff-dbcs-tables';
import { biffDecode } from './biff-strings.js';

export async function readBiffPropertyText(data: BiffPropertyRange, offset: number, codepage: number, context: CapabilityContext,
  accountText: (text: string) => string, accountWork: (amount: number) => void): Promise<{ value: string; end: number }> {
    const count = await data.u32(offset), width = codepage === 1200 ? 2 : 1, size = count * width;
    if (!count) invalidBiff("empty property string buffer");
    data.check(offset + 4, size);
    // Admit the maximum UTF-8 expansion before allocating a decoded string.
    if ((count - 1) * 3 > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property text limit exceeded");
    accountWork(size);
    const end = offset + 4 + size;
    if ((await data.read(end - width, width)).some(Boolean)) invalidBiff("unterminated property string");
    let value = "";
    const unicode = codepage === 1200 || codepage === 65001;
    const decoder = unicode ? new TextDecoder(codepage === 1200 ? "utf-16le" : "utf-8", { fatal: true, ignoreBOM: true }) : undefined;
    const multibyte = biffDbcsTables[codepage]; let lead: number | undefined;
    if (!unicode && !multibyte) biffDecode(new Uint8Array(), codepage);
    for (let at = offset + 4; at < end - width;) {
      const bytes = await data.read(at, Math.min(16384, end - width - at)); at += bytes.length;
      if (decoder) {
        try { value += decoder.decode(bytes, { stream: true }); } catch { invalidBiff("invalid property string encoding"); }
      } else if (multibyte) {
        const characters: string[] = [];
        for (const byte of bytes) {
          if (lead !== undefined) {
            const character = multibyte.double[lead]?.[byte];
            if (character === undefined || character === "\uffff") invalidBiff("invalid or truncated DBCS character");
            characters.push(character); lead = undefined;
          } else {
            const character = multibyte.single[byte]!;
            if (character === "\uffff") lead = byte; else characters.push(character);
          }
        }
        value += characters.join("");
      } else value += biffDecode(bytes, codepage);
    }
    if (lead !== undefined) invalidBiff("invalid or truncated DBCS character");
    if (decoder) try { value += decoder.decode(); } catch { invalidBiff("invalid property string encoding"); }
    return { value: accountText(value), end: width === 2 ? Math.ceil(end / 4) * 4 : end };
}
