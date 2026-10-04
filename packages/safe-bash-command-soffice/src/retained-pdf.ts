import { RetainedPdf } from "./retained-pdf-storage.js";
import { retainPdfImage } from "./retained-pdf-image.js";
import { cosString, encodeWinAnsiBytes, serializeCosNodeBytes } from "@poe-code/pdf-ast";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedTextBlocks, RetainedTextSnapshot } from "./retained-blocks.js";
import type { RetainedSofficeContext } from "./retained-input.js";

/** Preserve Writer's wrapping and page layout while words, page content and
 * output objects live in caller storage, including arbitrarily long words. */
export async function retainTextPdf(storage: PagedStorage, text: RetainedTextBlocks, snapshot: RetainedTextSnapshot,
  title: string, context: RetainedSofficeContext, filterOptions?: string): Promise<{ size: number; read(): AsyncGenerator<Uint8Array> }> {
  const { signal } = context, encoder = new TextEncoder(), words = new IntegerTable(storage), pdf = new RetainedPdf(storage, context);
  let y = 720;
  const finishPage = async () => { await pdf.finishPage(); y = 720; };
  for (let block = 0; block < snapshot.count; block++) {
    signal.throwIfAborted();
    const image = await text.image?.(snapshot, block);
    if (image) {
      const retained = await retainPdfImage(storage, image, signal);
      if (retained) {
        if (y - (image.height + 12) < 54) await finishPage();
        await pdf.image(retained, {x: 54, y: y - image.height, width: image.width, height: image.height});
        y -= image.height + 12;
      }
      continue;
    }
    const table = await text.table?.(snapshot, block);
    if (table) {
      const width = 504 / table.columns;
      for (let row = 0; row < table.rows; row++) {
        signal.throwIfAborted();
        if (y - 28 < 54) await finishPage();
        const bottom = y - 22;
        await pdf.append(row === 0 ? `q\n0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w\n54 ${bottom} 504 22 re\nB\nQ\n` : `q\n0.7 0.72 0.75 RG\n0.5 w\n54 ${bottom} 504 22 re\nS\nQ\n`);
        const cells = await table.cells(row);
        for (let cell = 0; cell < cells; cell++) {
          const x = 54 + cell * width;
          if (cell) await pdf.append(`q\n0.7 0.72 0.75 RG\n0.5 w\n${x} ${bottom} m\n${x} ${y} l\nS\nQ\n`);
          await pdf.append(`q\n0 0 0 rg\nBT\n/${row === 0 ? "Heading" : "Body"} 10 Tf\n1 0 0 1 ${x + 6} ${bottom + 6} Tm\n`);
          const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
          for await (const bytes of table.streamCell(row, cell)) {
            const value = decoder.decode(bytes, { stream: true });
            if (value) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(value)))); await pdf.append(" Tj\n"); }
          }
          const tail = decoder.decode();
          if (tail) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(tail)))); await pdf.append(" Tj\n"); }
          await pdf.append("ET\nQ\n");
        }
        y = bottom; await yieldTurn(signal);
      }
      y -= 14; continue;
    }
    const heading = await text.isHeading(snapshot, block), maximum = heading ? 48 : 84, decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let position = 0, start = 0, wordBytes = 0, wordUnits = 0, count = 0;
    const finishWord = async () => {
      if (!wordBytes) return;
      await words.set(BigInt(count * 3), BigInt(start)); await words.set(BigInt(count * 3 + 1), BigInt(wordBytes));
      await words.set(BigInt(count * 3 + 2), BigInt(wordUnits)); count++; wordBytes = 0; wordUnits = 0;
    };
    const scan = async (value: string) => {
      for (const character of value) {
        const bytes = encoder.encode(character).length;
        if (!character.trim()) await finishWord();
        else { if (!wordBytes) start = position; wordBytes += bytes; wordUnits += character.length; }
        position += bytes;
      }
    };
    for await (const bytes of text.streamBlock(snapshot, block)) { await scan(decoder.decode(bytes, { stream: true })); await yieldTurn(signal); }
    await scan(decoder.decode()); await finishWord();
    let first = 0;
    do {
      let end = first, units = 0;
      while (end < count) {
        const next = Number(await words.get(BigInt(end * 3 + 2)));
        if (end > first && units + 1 + next > maximum) break;
        units += (end > first ? 1 : 0) + next; end++;
      }
      if (y - (heading ? 26 : 16) < 54) await finishPage();
      await pdf.append(`q\n${heading ? "0.1 0.15 0.28" : "0.15 0.15 0.15"} rg\nBT\n/${heading ? "Heading" : "Body"} ${heading ? 18 : 11} Tf\n1 0 0 1 54 ${y} Tm\n`);
      for (let word = first; word < end; word++) {
        if (word > first) await pdf.append("( ) Tj\n");
        const range = { start: Number(await words.get(BigInt(word * 3))), length: Number(await words.get(BigInt(word * 3 + 1))) };
        const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
        for await (const bytes of text.streamBlock(snapshot, block, range)) {
          const value = decoder.decode(bytes, { stream: true });
          if (value) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(value)))); await pdf.append(" Tj\n"); }
        }
        const tail = decoder.decode();
        if (tail) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(tail)))); await pdf.append(" Tj\n"); }
      }
      if (first === end) await pdf.append("() Tj\n");
      await pdf.append("ET\nQ\n"); y -= heading ? 24 : 15; first = end;
      await yieldTurn(signal);
    } while (first < count);
    y -= heading ? 4 : 5;
  }
  await finishPage();
  return pdf.save({title, creator: "LibreOffice 24.8 (@poe-code/pdf-ast)", filterOptions});
}
