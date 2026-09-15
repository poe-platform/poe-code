import {unicodeCanonicalName} from "./unicode-canonical-name.js";
import {codecAliasNames, codecSequenceNames} from "./unicode-codec-name-data.js";
import type {SourceMeter} from "./source.js";

/** CPython 3.14.7's codec getname lookup exposes the alias/sequence names
 * stored at pseudo characters in plane 15. Keep this separate from the public
 * canonical-name operation, which deliberately hides those internal records. */
export function unicodeCodecName(point: number, meter?: SourceMeter): string | undefined {
  meter?.checkpoint();
  const internal = codecAliasNames[point - 0xf0000] ?? codecSequenceNames[point - 0xf0200];
  if (internal === undefined) return unicodeCanonicalName(point, meter);
  meter?.checkpoint(1, 32 + internal.length * 2);
  return internal;
}
