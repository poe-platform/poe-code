import {normalizeNfkcPoints} from "../normalization.js";
import {unicode32Normalization} from "../normalization-unicode32-data.js";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {renderQuotedPoints} from "./quoted-representation.js";
import {stringprepMapping, stringprepMask, stringprepTableBits as table} from "./stringprep-tables.js";

const prohibited = table.c12 | table.c22 | table.c3 | table.c4 | table.c5 | table.c6 | table.c7 | table.c8 | table.c9;

/** Default RFC 3491 preparation over pinned code points. The reference uses
 * Unicode 3.2 normalization/properties and Unicode 16 B2 mappings. Unassigned
 * characters are permitted. This internal kernel does not publish the mutable
 * stringprep/encodings.idna modules: their guest calls must retain live binding
 * lookup, evaluation order, suspension and exception-frame behavior.
 */
export function prepareIdnaName(input: CodePointString, meter: ExecutionMeter): CodePointString {
  let fatal = false;
  try {
    meter.checkpoint(1, 64);
    const mapped: number[] = [];
    for (const point of input) {
      meter.checkpoint();
      if (stringprepMask(point, meter) & table.b1) continue;
      for (const replacement of stringprepMapping("b2", point, meter)) {
        meter.checkpoint(1, 8);
        mapped.push(replacement);
      }
    }
    const normalized = normalizeNfkcPoints(mapped, unicode32Normalization, meter);
    meter.checkpoint(normalized.length, normalized.length * 4);
    const label = new CodePointString(Uint32Array.from(normalized), meter);
    let hasRandAL = false, firstLCat = -1, firstRandAL = false, lastRandAL = false;
    for (let index = 0; index < normalized.length; index++) {
      meter.checkpoint();
      const point = normalized[index], mask = stringprepMask(point, meter);
      if (mask & prohibited) {
        meter.checkpoint(1, 4);
        const character = new CodePointString(Uint32Array.of(point), meter);
        let representation = "";
        for (const quoted of renderQuotedPoints(character, "repr", meter)) {
          meter.checkpoint(1, 4);
          representation += String.fromCodePoint(quoted);
        }
        meter.checkpoint(1, 128 + representation.length * 2);
        throw new PythonEncodeError("idna", label, index, index + 1, `Invalid character ${representation}`);
      }
      // With immutable pinned properties the three reference scans can share
      // traversal, but prohibition must still precede every bidi error.
      const randAL = (mask & table.d1) !== 0;
      hasRandAL ||= randAL;
      if (index === 0) firstRandAL = randAL;
      lastRandAL = randAL;
      if (firstLCat < 0 && (mask & table.d2)) firstLCat = index;
    }
    if (hasRandAL) {
      const position = firstLCat >= 0 ? firstLCat : !firstRandAL ? 0 : !lastRandAL ? normalized.length - 1 : -1;
      if (position >= 0) {
        meter.checkpoint(1, 192);
        throw new PythonEncodeError("idna", label, position, position + 1, `Violation of BIDI requirement ${firstLCat >= 0 ? 2 : 3}`);
      }
    }
    return label;
  } catch (error) { fatal = error instanceof ExecutionLimitError; throw error; }
  finally { if (!fatal) meter.checkpoint(); }
}
