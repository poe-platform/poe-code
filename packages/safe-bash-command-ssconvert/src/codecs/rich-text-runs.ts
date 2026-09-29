import { SsconvertError } from "../contracts.js";
import type { ImportedValue, RichTextRun } from "../workbook.js";

/** Resolve overlapping byte ranges while preserving the source UTF-16 units. */
export function* richTextSegments(value: string, runs: readonly RichTextRun[], charge?: (amount?: number) => void) {
  charge?.(value.length + runs.length);
  const length = new TextEncoder().encode(value).length;
  const points = [...new Set([0, length, ...runs.flatMap(run => [run.start, run.end])])].sort((a, b) => a - b);
  let byteOffset = 0, characterOffset = 0;
  const characters = points.map(point => {
    while (byteOffset < point && characterOffset < value.length) {
      const code = value.codePointAt(characterOffset)!;
      byteOffset += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
      characterOffset += code > 65535 ? 2 : 1;
    }
    if (byteOffset !== point) throw new SsconvertError("invalid-request", "Invalid rich text UTF-8 boundary");
    return characterOffset;
  });
  for (let i = 0; i + 1 < points.length; i++) {
    charge?.(runs.length);
    const start = points[i]!, end = points[i + 1]!, attributes: Record<string, ImportedValue> = {};
    for (const run of runs) if (run.start <= start && run.end >= end) {
      charge?.(Object.keys(run.attributes).length); Object.assign(attributes, run.attributes);
    }
    yield { text: value.slice(characters[i], characters[i + 1]), attributes };
  }
}
