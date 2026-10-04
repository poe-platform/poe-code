import type { PdfRetainedPage, PdfIndexStorage, PdfRect, PdfStoredTextLine } from "@poe-code/pdf-ast";
import { escapeXml } from "./text-markup.js";
export interface RawTextGeometry {
  readonly crop?: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
interface BboxOptions { readonly resolution: number; readonly bboxLayout: boolean; readonly nodiag: boolean; readonly clip: boolean; readonly signal: AbortSignal }
/** Revisit indexed geometry to format enclosing boxes without keeping word or
 * line arrays. Text remains in caller backing until its word is emitted. */
export async function* streamRawBboxPage(page: PdfRetainedPage, storage: PdfIndexStorage, geometry: RawTextGeometry,
  options: BboxOptions): AsyncGenerator<Uint8Array, boolean, void> {
  const index = await page.indexRawText(storage, { discardDiagonal: options.nodiag, clipText: options.clip, signal: options.signal });
  const encoder = new TextEncoder(), scale = options.resolution / 72; let failed = false, hasWords = false;
  function selected(box: PdfRect): PdfRect | undefined {
    const x = (box[0] + box[2]) / 2, y = (box[1] + box[3]) / 2, crop = geometry.crop;
    if (crop && !(x >= crop[0] && x <= crop[2] && y >= crop[1] && y <= crop[3])) return undefined;
    return [box[0] - geometry.offsetX, box[1] - geometry.offsetY, box[2] - geometry.offsetX, box[3] - geometry.offsetY];
  }
  function union(a: PdfRect | undefined, b: PdfRect): PdfRect { return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b; }
  async function lineBounds(line: PdfStoredTextLine): Promise<PdfRect | undefined> {
    let box: PdfRect | undefined; for await (const word of line.words()) { const kept = selected(word.bbox); if (kept) box = union(box, kept); } return box;
  }
  function coordinates(box: PdfRect) {
    return `xMin="${(box[0] * scale).toFixed(6)}" yMin="${((geometry.height - box[3]) * scale).toFixed(6)}" xMax="${(box[2] * scale).toFixed(6)}" yMax="${((geometry.height - box[1]) * scale).toFixed(6)}"`;
  }
  try {
    yield encoder.encode(`  <page width="${geometry.width.toFixed(6)}" height="${geometry.height.toFixed(6)}">\n`);
    for await (const block of index.blocks()) {
      let blockBox: PdfRect | undefined;
      for await (const line of block.lines()) { const box = await lineBounds(line); if (box) blockBox = union(blockBox, box); }
      if (!blockBox) continue;
      if (options.bboxLayout) yield encoder.encode(`    <flow>\n      <block ${coordinates(blockBox)}>\n`);
      for await (const line of block.lines()) {
        const box = await lineBounds(line); if (!box) continue;
        if (options.bboxLayout) yield encoder.encode(`        <line ${coordinates(box)}>\n`);
        for await (const word of line.words()) {
          const wordBox = selected(word.bbox); if (!wordBox) continue; hasWords = true;
          yield encoder.encode(`          <word ${coordinates(wordBox)}>`);
          for await (const text of word.text()) yield encoder.encode(escapeXml(text));
          yield encoder.encode("</word>\n");
        }
        if (options.bboxLayout) yield encoder.encode("        </line>\n");
      }
      if (options.bboxLayout) yield encoder.encode("      </block>\n    </flow>\n");
    }
    yield encoder.encode("  </page>\n"); return hasWords;
  } catch (error) { failed = true; throw error; }
  finally { await index.close().catch(error => { if (!failed) throw error; }); }
}
