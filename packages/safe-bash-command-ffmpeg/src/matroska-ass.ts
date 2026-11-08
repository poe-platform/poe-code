import { decodeAssText } from "@poe-code/mp4-ast";

/** Decode Matroska's ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text packet. */
export function decodeMatroskaAss(packet: string): string {
  let start = 0;
  for (let field = 0; field < 8; field++) {
    const comma = packet.indexOf(",", start);
    if (comma < 0) throw new Error("Invalid Matroska ASS packet");
    start = comma + 1;
  }
  return decodeAssText(packet.slice(start));
}
