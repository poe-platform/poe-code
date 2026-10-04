import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import type { SofficeSnapshot } from "./retained-input.js";
import { retainCsv } from "./retained-csv.js";

/** Keep line and cell indexes in caller backing, including arbitrarily wide tables. */
export async function retainTextTable(storage: PagedStorage, source: SofficeSnapshot, blocks: RetainedOfficeBlocks, signal: AbortSignal, markdown: boolean): Promise<void> {
  const lines = new IntegerTable(storage), cells = new IntegerTable(storage);
  let lineCount = 0, cellCount = 0, start = 0, separator = ",";
  const line = async (end: number) => {
    await lines.set(BigInt(lineCount * 2), BigInt(start));
    await lines.set(BigInt(lineCount * 2 + 1), BigInt(end - start)); lineCount++; start = end + 1;
  };
  for (let offset = 0; offset < source.size; offset += 16384) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await storage.read(source.position + offset, Math.min(16384, source.size - offset)));
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] === 9) separator = "\t";
      if (markdown && bytes[index] === 10) await line(offset + index);
    }
    await yieldTurn(signal);
  }
  if (!markdown) { await retainCsv(storage, source, blocks, signal, separator); return; }
  await line(source.size);
  const span = async (index: number): Promise<SofficeSnapshot> => ({ position: Number(await cells.get(BigInt(index * 2))), size: Number(await cells.get(BigInt(index * 2 + 1))) });
  const parse = async (index: number): Promise<{ first: number; count: number } | undefined> => {
    const offset = Number(await lines.get(BigInt(index * 2))), length = Number(await lines.get(BigInt(index * 2 + 1)));
    const decoder = new TextDecoder("utf-8", { ignoreBOM: index !== 0 }), encoder = new TextEncoder();
    let first = cellCount, count = 0, pipes = 0, firstVisible = "", lastVisible = "", slash = false;
    let position = storage.allocate(0), size = 0, trimStart = -1, trimEnd = 0, buffer = "";
    const flush = async () => { if (buffer) { await storage.append(encoder.encode(buffer)); buffer = ""; } };
    const append = async (char: string) => {
      const width = char.length === 2 ? 4 : char.charCodeAt(0) < 128 ? 1 : char.charCodeAt(0) < 2048 ? 2 : 3;
      if (char.trim()) { if (trimStart < 0) trimStart = size; trimEnd = size + width; }
      size += width; buffer += char;
      if (buffer.length >= 4096) await flush();
    };
    const finish = async () => {
      await flush();
      await cells.set(BigInt(cellCount * 2), BigInt(position + Math.max(0, trimStart)));
      await cells.set(BigInt(cellCount * 2 + 1), BigInt(trimStart < 0 ? 0 : trimEnd - trimStart)); cellCount++; count++;
      position = storage.allocate(0); size = 0; trimStart = -1; trimEnd = 0;
    };
    const consume = async (text: string) => {
      for (const char of text) {
        if (char.trim()) { if (!firstVisible) firstVisible = char; lastVisible = char; }
        if (slash) { slash = false; if (char === "|") { await append(char); continue; } await append("\\"); }
        if (char === "\\") slash = true;
        else if (char === "|") { pipes++; await finish(); }
        else await append(char);
      }
    };
    for (let at = 0; at < length; at += 16384) {
      signal.throwIfAborted();
      await consume(decoder.decode(await storage.read(source.position + offset + at, Math.min(16384, length - at)), { stream: true }));
      await yieldTurn(signal);
    }
    await consume(decoder.decode()); if (slash) await append("\\");
    await finish();
    if (!pipes) return;
    if (firstVisible === "|") { first++; count--; }
    if (lastVisible === "|" && !(await span(first + count - 1)).size) count--;
    return { first, count };
  };
  const delimiter = async (row: { first: number; count: number }): Promise<boolean> => {
    for (let cell = 0; cell < row.count; cell++) {
      const value = await span(row.first + cell);
      let dashes = 0, end = false;
      for (let offset = 0; offset < value.size; offset += 16384) {
        signal.throwIfAborted();
        const bytes = await storage.read(value.position + offset, Math.min(16384, value.size - offset));
        for (let at = 0; at < bytes.length; at++) {
          const byte = bytes[at];
          if (byte === 58 && offset + at === 0) continue;
          if (byte === 45 && !end) dashes++;
          else if (byte === 58 && dashes && !end) end = true;
          else return false;
        }
      }
      if (!dashes) return false;
    }
    return true;
  };
  let rows = 0;
  blocks.beginTable();
  const add = async (row: { first: number; count: number }, columns: number) => {
    for (let cell = 0; cell < columns; cell++) await blocks.cell(cell < row.count ? await span(row.first + cell) : { position: 0, size: 0 });
    await blocks.endRow(); rows++;
  };
  for (let index = 0; index + 1 < lineCount; index++) {
    signal.throwIfAborted();
    const header = await parse(index), rule = await parse(index + 1);
    if (!header?.count || rule?.count !== header.count || !await delimiter(rule)) continue;
    await add(header, header.count); index += 2;
    for (; index < lineCount; index++) {
      const row = await parse(index);
      if (!row) break;
      await add(row, header.count);
    }
  }
  if (rows) await blocks.endTable(true);
  else await retainCsv(storage, source, blocks, signal, separator);
}
