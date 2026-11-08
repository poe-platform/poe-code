import {rtfError} from "./rtf-syntax.js";
import type {AdapterContext} from "./types.js";

/** Adjacent byte pieces share one decoder. A literal symbol ends the byte run,
 * so incomplete UTF-8 cannot cross that boundary. Source chunks may be reused
 * after yielding; each piece is consumed before advancing the source iterator. */
export async function* decodeRtfText(source: Iterable<Uint8Array | string> | AsyncIterable<Uint8Array | string>, page: number, context: AdapterContext): AsyncGenerator<string> {
  if (page !== 1252 && page !== 65001) rtfError(context, `Unsupported RTF code page ${page}; supported pages are 1252 and 65001`, "E_ENCODING");
  const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
  const buffer = new Uint8Array(page === 1252 ? 2048 : 256);
  let used = 0, active = false;
  const decode = async (final: boolean): Promise<string> => {
    let text = "";
    if (used) {
      if (page === 1252) text = await context.decodeCodepage(buffer.subarray(0, used), 1252);
      else {
        await context.cooperate(256); context.charge("retainedBytes", 1024);
        try {text = decoder.decode(buffer.subarray(0, used), {stream: true});}
        catch {rtfError(context, `Invalid RTF bytes for code page ${page}`, "E_ENCODING");}
        context.charge("text", text.length); context.charge("retainedBytes", text.length * 2);
      }
      used = 0;
    }
    if (final && active && page === 65001) {
      let tail: string;
      try {tail = decoder.decode();} catch {return rtfError(context, `Truncated RTF code-page sequence ${page}`, "E_ENCODING");}
      context.charge("text", tail.length); context.charge("retainedBytes", tail.length * 2); text += tail;
    }
    if (final) active = false;
    return text;
  };
  for await (const part of source) {
    if (typeof part === "string") {
      const tail = await decode(true); if (tail) yield tail;
      context.charge("text", part.length); yield part;
    } else for (let offset = 0; offset < part.length;) {
      const count = Math.min(buffer.length - used, part.length - offset);
      buffer.set(part.subarray(offset, offset + count), used); used += count; offset += count; active = true;
      if (used === buffer.length) {const text = await decode(false); if (text) yield text;}
    }
    await context.cooperate();
  }
  const tail = await decode(true); if (tail) yield tail;
}
