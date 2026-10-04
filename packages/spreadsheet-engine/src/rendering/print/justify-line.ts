import type {GlyphRun} from "@pdf-lib/fontkit";
import {SsconvertError} from "../../contracts.js";

/** Expand Pango print advances in 1/1024-pixel units, preserving shaping clusters. */
export function justifyPrintLine(text: string, run: GlyphRun, advances: readonly number[], remaining: number,
  tick: (amount?: number) => void): {offsets: number[]; added: number} {
  const units = Math.floor(remaining * 1024), hinted = units % 1024 === 0;
  const offsets = Array<number>(advances.length).fill(0);
  if (units <= 0) return {offsets, added: 0};
  tick(text.length + advances.length);
  const round = (value: number) => Math.floor((value + 512) / 1024) * 1024;
  const positions = run.positions as readonly {cluster?: number}[];
  const starts: number[] = [];
  let cursor = 0;
  for (const [index, glyph] of run.glyphs.entries()) {
    tick();
    const cluster = positions[index]?.cluster;
    if (cluster !== undefined) starts.push(cluster);
    else {
      // Fontkit does not expose cluster offsets. Recover only an exact logical
      // mapping; reordered or ambiguous runs must not invent cluster boundaries.
      const value = glyph.codePoints.map(point => String.fromCodePoint(point)).join("");
      if (!value || !text.startsWith(value, cursor)) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: PDF justification cluster mapping");
      starts.push(cursor);
      cursor += value.length;
    }
  }
  const spaces = advances.map((advance, index) => text[starts[index]!] === " " || text[starts[index]!] === "\u00a0" ? advance * 1024 : 0);
  const spaceWidth = spaces.reduce((sum, width) => sum + width, 0);
  let added = 0;
  if (spaceWidth > 0) {
    let consumed = 0;
    for (let index = 0; index < advances.length; index++) {
      tick();
      offsets[index] = added / 1024;
      if (!spaces[index]) continue;
      consumed += spaces[index]!;
      let adjustment = Math.floor(consumed * units / spaceWidth) - added;
      if (hinted) adjustment = round(adjustment);
      added += adjustment;
    }
  } else {
    const boundaries = new Set(Array.from(new Intl.Segmenter("und", {granularity: "grapheme"}).segment(text), part => part.index));
    const clusters: {start: number; end: number; width: number}[] = [];
    for (let index = 0; index < advances.length; index++) {
      tick();
      const previous = clusters.at(-1);
      if (previous && (starts[index] === starts[index - 1] || !boundaries.has(starts[index]!))) {
        previous.end = index + 1;
        previous.width += advances[index]!;
      } else clusters.push({start: index, end: index + 1, width: advances[index]!});
    }
    const positive = clusters.filter(cluster => cluster.width > 0);
    if (positive.length < 2) return {offsets, added: 0};
    let residual = 0, priorEnd = 0;
    for (const [index, cluster] of positive.entries()) {
      tick();
      let adjustment = Math.trunc(units / (positive.length - 1)) + residual;
      if (hinted) {const old = adjustment; adjustment = round(adjustment); residual = old - adjustment;}
      let left = Math.trunc(adjustment / 2);
      if (adjustment % 1024 === 0) left = round(left);
      for (let glyph = priorEnd; glyph < cluster.start; glyph++) {tick(); offsets[glyph] = added / 1024;}
      if (index > 0) added += left;
      for (let glyph = cluster.start; glyph < cluster.end; glyph++) {tick(); offsets[glyph] = added / 1024;}
      if (index < positive.length - 1) added += adjustment - left;
      priorEnd = cluster.end;
    }
    for (let glyph = priorEnd; glyph < offsets.length; glyph++) {tick(); offsets[glyph] = added / 1024;}
  }
  return {offsets, added: added / 1024};
}
