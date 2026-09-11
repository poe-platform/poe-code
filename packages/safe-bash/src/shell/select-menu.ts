import { shellValueBytes, type ShellValue, type ValueAllocation } from "../contracts/value.js";
import { writeText, type ByteSink } from "../contracts/index.js";
import { stringCheckpoint, type StringWork } from "./string-operations.js";

/** GNU select's column-major menu, with fixed eight-column tab stops. */
export async function selectMenu(values: readonly ShellValue[], columns: string | undefined, byteLocale: boolean, sink: ByteSink, work: StringWork, allocation: ValueAllocation): Promise<void> {
  allocation.reserve(64 + values.length * 32, 0);
  const items: { bytes: Uint8Array; width: number }[] = [];
  let maximum = 0;
  for (const value of values) {
    const bytes = shellValueBytes(value, allocation);
    allocation.reserve(bytes.length * 2 + 64, 0);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let text: string | undefined = "";
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      const end = Math.min(offset + 1024, bytes.length);
      const pending = stringCheckpoint(work, end - offset);
      if (pending) await pending;
      if (text !== undefined) try { text += decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length }); }
      catch (error) {
        if (!(error instanceof TypeError) || "code" in error && error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
        text = undefined;
      }
    }
    let width = 0;
    if (text !== undefined) for (const character of text) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const point = character.codePointAt(0)!;
      if (byteLocale && point >= 128) { width = 0; break; }
      if (point < 32 || point === 127) { width = bytes.length; break; }
      if (/[\p{Mn}\p{Me}\p{Cf}]/u.test(character)) continue;
      width += point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a || point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe19 || point >= 0xfe30 && point <= 0xfe6f || point >= 0xff00 && point <= 0xff60 || point >= 0xffe0 && point <= 0xffe6 || point >= 0x1f300 && point <= 0x1faff || point >= 0x20000 && point <= 0x3fffd) ? 2 : 1;
    }
    maximum = Math.max(maximum, byteLocale ? bytes.length : width);
    items.push({ bytes, width });
  }
  let screen = 0;
  if (columns) {
    let started = false;
    for (const character of columns) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      if (!started && " \t\r\n\v\f".includes(character)) continue;
      if (!started && character === "+") { started = true; continue; }
      if (character < "0" || character > "9") break;
      started = true;
      screen = Math.min(0x7fffffff, screen * 10 + Number(character));
    }
  }
  screen ||= 80;
  const digits = String(values.length).length;
  const cell = maximum + digits + 4;
  let rows = Math.ceil(values.length / Math.max(1, Math.floor(screen / cell)));
  if (rows === 1) rows = values.length;
  for (let row = 0; row < rows; row++) {
    let position = 0;
    for (let index = row; index < items.length; index += rows) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const item = items[index]!;
      const indexWidth = position ? digits : String(rows).length;
      await writeText(sink, `${String(index + 1).padStart(indexWidth)}) `);
      await sink.write(item.bytes);
      if (index + rows < items.length) {
        let from = position + indexWidth + 2 + item.width;
        const to = position + cell;
        while (from < to) {
          const pending = stringCheckpoint(work);
          if (pending) await pending;
          const tab = Math.floor(to / 8) > Math.floor(from / 8);
          await writeText(sink, tab ? "\t" : " ");
          from += tab ? 8 - from % 8 : 1;
        }
        position += cell;
      }
    }
    await writeText(sink, "\n");
  }
}
