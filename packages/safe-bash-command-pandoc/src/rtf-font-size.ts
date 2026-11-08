import {readNumericUnit} from "./numeric-unit.js";
export class RtfFontSizeError extends RangeError {}

export async function readRtfFontSize(source: Iterable<string> | AsyncIterable<string>): Promise<number> {
  const {unit, value} = await readNumericUnit(source);
  if (unit !== "pt") throw new RtfFontSizeError("RTF font-size requires points");
  const halfPoints = value * 2;
  if (!Number.isSafeInteger(halfPoints) || halfPoints < 1 || halfPoints > 32767) throw new RtfFontSizeError("Invalid RTF font-size");
  return halfPoints;
}
