import { yieldTurn } from "../contracts/yield.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const controls: Readonly<Record<number, string>> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 27: "\\E" };

function unit(bytes: Uint8Array, offset: number, utf8: boolean): { text: string; size: number; printable: boolean } {
  const first = bytes[offset]!;
  if (first < 128) return { text: String.fromCharCode(first), size: 1, printable: first >= 32 && first < 127 };
  const size = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
  if (utf8 && size && offset + size <= bytes.length) {
    try {
      const text = decoder.decode(bytes.subarray(offset, offset + size));
      return { text, size, printable: !/[\p{Cc}\p{Cf}\p{Cn}]/u.test(text) };
    } catch (error) { if (!(error instanceof TypeError)) throw error; }
  }
  return { text: "", size: 1, printable: false };
}

/** Preserve valid printable UTF-8 units even beside invalid octets. */
export async function quotePrintf(bytes: Uint8Array, utf8: boolean, signal: AbortSignal, alternate = false): Promise<Uint8Array> {
  signal.throwIfAborted();
  let ansi = false;
  for (let offset = 0, count = 0; offset < bytes.length; count++) {
    if (count && count % 1024 === 0) await yieldTurn(signal);
    const current = unit(bytes, offset, utf8);
    if (!current.printable) ansi = true;
    offset += current.size;
  }
  if (!bytes.length) return encoder.encode("''");
  let text = ansi ? "$'" : alternate ? "'" : "";
  for (let offset = 0, count = 0; offset < bytes.length; count++) {
    if (count && count % 1024 === 0) await yieldTurn(signal);
    const current = unit(bytes, offset, utf8);
    const first = bytes[offset]!;
    if (ansi && !current.printable) {
      if (current.size === 1 && controls[first]) text += controls[first];
      else for (let index = 0; index < current.size; index++) text += "\\" + bytes[offset + index]!.toString(8).padStart(3, "0");
    } else if (ansi) text += first === 39 || first === 92 ? "\\" + current.text : current.text;
    else if (alternate) text += first === 39 ? "'\\''" : current.text;
    else {
      const safe = current.size > 1 || "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./@%+=:-".includes(current.text)
        || first === 35 && offset > 0 || first === 126 && offset > 0 && bytes[offset - 1] !== 58 && bytes[offset - 1] !== 61;
      text += safe ? current.text : "\\" + current.text;
    }
    offset += current.size;
  }
  return encoder.encode(text + (ansi || alternate ? "'" : ""));
}
