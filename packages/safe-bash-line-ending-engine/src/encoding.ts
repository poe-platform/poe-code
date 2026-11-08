import { Reader } from "./io.js";

export type Encoding = "bytes" | "le" | "be" | "utf8" | "gb";
export const encodingLabels: Record<Encoding, string> = { bytes: "no_bom", le: "UTF-16LE", be: "UTF-16BE", utf8: "UTF-8", gb: "GB18030" };

export async function readEncoding(reader: Reader): Promise<{ bom: Encoding; byte: () => number | Promise<number>; error: boolean }> {
  const prefix: number[] = [];
  let bom: Encoding = "bytes", error = false;
  const first = await reader.get();
  if (first !== -1) {
    if (first !== 0xff && first !== 0xfe && first !== 0xef && first !== 0x84) prefix.push(first);
    else {
      const second = await reader.get();
      if (second === -1) error = true;
      else if (first === 0xff && second === 0xfe) bom = "le";
      else if (first === 0xfe && second === 0xff) bom = "be";
      else {
        const third = await reader.get();
        if (third === -1) error = true;
        else if (first === 0xef && second === 0xbb && third === 0xbf) bom = "utf8";
        else {
          prefix.push(first, second, third);
          if (first === 0x84 && second === 0x31 && third === 0x95) {
            const fourth = await reader.get();
            if (fourth === -1) error = true;
            else if (fourth === 0x33) { bom = "gb"; prefix.length = 0; }
            else prefix.push(fourth);
          }
        }
      }
    }
  }
  let offset = 0;
  return { bom, error, byte: () => offset < prefix.length ? prefix[offset++]! : reader.get() };
}
