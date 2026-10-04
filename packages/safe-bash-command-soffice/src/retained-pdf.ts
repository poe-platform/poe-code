import { resolvePath } from "@poe-code/safe-fs/core";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, encodeWinAnsiBytes, serializeCosNodeBytes, serializeRetainedCosDocumentChunks, type PdfRetainedOutputObject, type PdfSerializedOutputObject } from "@poe-code/pdf-ast";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedTextBlocks, RetainedTextSnapshot } from "./retained-blocks.js";
import type { RetainedSofficeContext } from "./retained-input.js";

/** Linked bounded byte chunks tolerate metadata allocations in the same backing. */
class ByteChain {
  first = 0;
  private last = 0;
  size = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {}
  async append(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      this.signal.throwIfAborted();
      const chunk = bytes.subarray(offset, offset + 16384), pointer = this.storage.allocate(16 + chunk.length);
      const header = new Uint8Array(16); new DataView(header.buffer).setFloat64(8, chunk.length);
      await this.storage.write(pointer, header); await this.storage.write(pointer + 16, chunk);
      if (this.last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, pointer); await this.storage.write(this.last, link); }
      this.first ||= pointer; this.last = pointer; this.size += chunk.length;
    }
  }
}
async function* readChain(storage: PagedStorage, first: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  for (let pointer = first; pointer;) {
    signal.throwIfAborted();
    const header = await storage.read(pointer, 16), view = new DataView(header.buffer, header.byteOffset, 16);
    yield new Uint8Array(await storage.read(pointer + 16, view.getFloat64(8))); pointer = view.getFloat64(0);
  }
}

/** Preserve Writer's wrapping and page layout while words, page content and
 * output objects live in caller storage, including arbitrarily long words. */
export async function retainTextPdf(storage: PagedStorage, text: RetainedTextBlocks, snapshot: RetainedTextSnapshot,
  title: string, context: RetainedSofficeContext, filterOptions?: string): Promise<{ size: number; read(): AsyncGenerator<Uint8Array> }> {
  const { signal } = context, encoder = new TextEncoder(), words = new IntegerTable(storage), pages = new IntegerTable(storage);
  let page = new ByteChain(storage, signal), pageCount = 0, y = 720;
  const append = (value: string) => page.append(encoder.encode(value));
  const finishPage = async () => {
    await pages.set(BigInt(pageCount * 2), BigInt(page.first)); await pages.set(BigInt(pageCount * 2 + 1), BigInt(page.size)); pageCount++;
    page = new ByteChain(storage, signal); y = 720;
  };
  for (let block = 0; block < snapshot.count; block++) {
    signal.throwIfAborted();
    const table = await text.table?.(snapshot, block);
    if (table) {
      const width = 504 / table.columns;
      for (let row = 0; row < table.rows; row++) {
        signal.throwIfAborted();
        if (y - 28 < 54) await finishPage();
        const bottom = y - 22;
        await append(row === 0 ? `q\n0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w\n54 ${bottom} 504 22 re\nB\nQ\n` : `q\n0.7 0.72 0.75 RG\n0.5 w\n54 ${bottom} 504 22 re\nS\nQ\n`);
        const cells = await table.cells(row);
        for (let cell = 0; cell < cells; cell++) {
          const x = 54 + cell * width;
          if (cell) await append(`q\n0.7 0.72 0.75 RG\n0.5 w\n${x} ${bottom} m\n${x} ${y} l\nS\nQ\n`);
          await append(`q\n0 0 0 rg\nBT\n/${row === 0 ? "Heading" : "Body"} 10 Tf\n1 0 0 1 ${x + 6} ${bottom + 6} Tm\n`);
          const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
          for await (const bytes of table.streamCell(row, cell)) {
            const value = decoder.decode(bytes, { stream: true });
            if (value) { await page.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(value)))); await append(" Tj\n"); }
          }
          const tail = decoder.decode();
          if (tail) { await page.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(tail)))); await append(" Tj\n"); }
          await append("ET\nQ\n");
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
      await append(`q\n${heading ? "0.1 0.15 0.28" : "0.15 0.15 0.15"} rg\nBT\n/${heading ? "Heading" : "Body"} ${heading ? 18 : 11} Tf\n1 0 0 1 54 ${y} Tm\n`);
      for (let word = first; word < end; word++) {
        if (word > first) await append("( ) Tj\n");
        const range = { start: Number(await words.get(BigInt(word * 3))), length: Number(await words.get(BigInt(word * 3 + 1))) };
        const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
        for await (const bytes of text.streamBlock(snapshot, block, range)) {
          const value = decoder.decode(bytes, { stream: true });
          if (value) { await page.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(value)))); await append(" Tj\n"); }
        }
        const tail = decoder.decode();
        if (tail) { await page.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(tail)))); await append(" Tj\n"); }
      }
      if (first === end) await append("() Tj\n");
      await append("ET\nQ\n"); y -= heading ? 24 : 15; first = end;
      await yieldTurn(signal);
    } while (first < count);
    y -= heading ? 4 : 5;
  }
  await finishPage();
  let firstPage = 0, outputPages = pageCount, version = "1.7", copied = false;
  if (filterOptions?.trim().startsWith("{")) {
    try {
      const filter = JSON.parse(filterOptions) as Record<string, unknown>;
      const unwrap = (key: string) => { const value = filter[key]; return value && typeof value === "object" && "value" in value ? value.value : value; };
      const range = unwrap("PageRange"), requestedVersion = unwrap("SelectPdfVersion");
      let selectedFirst = 0, selectedCount = pageCount;
      if (typeof range === "string" && range.trim()) {
        const [startText, endText] = range.trim().split("-");
        const start = Math.max(1, Number(startText) || 1), end = Math.min(pageCount, Number(endText ?? startText) || start);
        const count = end >= start ? Math.floor(end - start) + 1 : 0;
        if (count > 0 && count < pageCount) {
          if (!Number.isInteger(start)) throw new RangeError("Invalid page index");
          selectedFirst = start - 1; selectedCount = count;
        }
      }
      firstPage = selectedFirst; outputPages = selectedCount; copied = outputPages < pageCount;
      if (requestedVersion === 15) version = "1.5";
      else if (requestedVersion === 16) version = "1.6";
      else if (requestedVersion === 20) version = "2.0";
    } catch { /* Preserve LibreOffice's invalid FilterData fallback. */ }
  }
  const object = (objectNumber: number, value: PdfRetainedOutputObject["value"]): PdfRetainedOutputObject => ({ objectNumber, generationNumber: 0, value });
  async function* kids() {
    yield encoder.encode(`<< /Type /Pages /Count ${outputPages} /Kids [`);
    for (let index = 0; index < outputPages; index++) { signal.throwIfAborted(); yield encoder.encode(`${6 + index * 2} 0 R `); }
    yield encoder.encode("] >>");
  }
  let kidsLength = 0; for await (const bytes of kids()) kidsLength += bytes.length;
  async function* objects(): AsyncGenerator<PdfRetainedOutputObject | PdfSerializedOutputObject> {
    yield object(1, cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }));
    yield { objectNumber: 2, generationNumber: 0, body: { length: kidsLength, chunks: kids() } };
    yield object(3, cosDict({ Producer: cosString("@poe-code/pdf-ast"), ...(!copied ? { Title: cosString(title), Creator: cosString("LibreOffice 24.8 (@poe-code/pdf-ast)") } : {}) }));
    for (const [index, name] of ["Helvetica", "Helvetica-Bold"].entries()) yield object(4 + index, cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(name), Encoding: cosName("WinAnsiEncoding") }));
    for (let index = 0; index < outputPages; index++) {
      yield object(6 + index * 2, cosDict({ Type: cosName("Page"), Parent: cosRef(2), MediaBox: cosArray([0, 0, 612, 792].map(value => cosNumber(value))), Resources: cosDict({ Font: cosDict({ Body: cosRef(4), Heading: cosRef(5) }) }), Contents: cosRef(7 + index * 2) }));
      yield { ...object(7 + index * 2, cosDict({})), stream: { length: Number(await pages.get(BigInt((firstPage + index) * 2 + 1))), chunks: readChain(storage, Number(await pages.get(BigInt((firstPage + index) * 2))), signal) } };
    }
  }
  const output = new ByteChain(storage, signal);
  for await (const bytes of serializeRetainedCosDocumentChunks({ objects: objects(), version, rootRef: cosRef(1), infoRef: cosRef(3), signal, chunkBytes: 16384 }, { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || context.cwd) })) await output.append(bytes);
  return { size: output.size, read: () => readChain(storage, output.first, signal) };
}
