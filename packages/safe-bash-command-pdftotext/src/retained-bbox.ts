import type { PdfRetainedPage, PdfIndexStorage, PdfRect, PdfStoredTextLine } from "@poe-code/pdf-ast";
import { escapeXml } from "./text-markup.js";
export interface RawTextGeometry {
  readonly crop?: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
interface BboxOptions { readonly tsv?: boolean; readonly raw: boolean; readonly layout: boolean; readonly colspacing?: number; readonly resolution: number; readonly bboxLayout: boolean; readonly nodiag: boolean; readonly clip: boolean; readonly signal: AbortSignal }
/** Revisit indexed geometry to format enclosing boxes without keeping word or
 * line arrays. Text remains in caller backing until its word is emitted. */
export async function* streamTextGeometryPage(page: PdfRetainedPage, storage: PdfIndexStorage, geometry: RawTextGeometry,
  options: BboxOptions): AsyncGenerator<Uint8Array, boolean, void> {
  const index = await page.indexText(storage, { mode: options.raw ? "raw" : options.layout ? "layout" : "logical", colSpacing: options.colspacing, discardDiagonal: options.nodiag, clipText: options.clip, signal: options.signal });
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
  function tsvCoordinates(box:PdfRect,precision:number){return [(box[0]*scale),((geometry.height-box[3])*scale),((box[2]-box[0])*scale),((box[3]-box[1])*scale)].map(value=>value.toFixed(precision)).join("\t");}
  const tsv=options.tsv===true;let blockIndex=0;
  try {
    if(tsv)yield encoder.encode(`1\t${page.index+1}\t0\t0\t0\t0\t0.000000\t0.000000\t${geometry.width.toFixed(6)}\t${geometry.height.toFixed(6)}\t-1\t###PAGE###\n`);
    else yield encoder.encode(`  <page width="${geometry.width.toFixed(6)}" height="${geometry.height.toFixed(6)}">\n`);
    for await (const block of index.blocks()) {
      let blockBox: PdfRect | undefined;
      for await (const line of block.lines()) { const box = await lineBounds(line); if (box) blockBox = union(blockBox, box); }
      if (!blockBox) continue;
      if(tsv)yield encoder.encode(`3\t${page.index+1}\t${blockIndex}\t${blockIndex}\t0\t0\t${tsvCoordinates(blockBox,6)}\t-1\t###FLOW###\n`);
      else if (options.bboxLayout) yield encoder.encode(`    <flow>\n      <block ${coordinates(blockBox)}>\n`);
      let lineIndex=0;
      for await (const line of block.lines()) {
        const box = await lineBounds(line); if (!box) continue;
        if(tsv)yield encoder.encode(`4\t${page.index+1}\t${blockIndex}\t${blockIndex}\t${lineIndex}\t0\t${tsvCoordinates(box,6)}\t-1\t###LINE###\n`);
        else if (options.bboxLayout) yield encoder.encode(`        <line ${coordinates(box)}>\n`);
        let wordIndex=0;
        for await (const word of line.words()) {
          const wordBox = selected(word.bbox); if (!wordBox) continue; hasWords = true;
          if(tsv)yield encoder.encode(`5\t${page.index+1}\t${blockIndex}\t${blockIndex}\t${lineIndex}\t${wordIndex}\t${tsvCoordinates(wordBox,2)}\t100\t`);
          else yield encoder.encode(`          <word ${coordinates(wordBox)}>`);
          for await (const text of word.text()) yield encoder.encode(tsv?text:escapeXml(text));
          yield encoder.encode(tsv?"\n":"</word>\n");wordIndex++;
        }
        if (!tsv&&options.bboxLayout) yield encoder.encode("        </line>\n");lineIndex++;
      }
      if (!tsv&&options.bboxLayout) yield encoder.encode("      </block>\n    </flow>\n");blockIndex++;
    }
    if(!tsv)yield encoder.encode("  </page>\n"); return hasWords;
  } catch (error) { failed = true; throw error; }
  finally { await index.close().catch(error => { if (!failed) throw error; }); }
}
