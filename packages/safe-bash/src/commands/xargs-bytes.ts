import { readBytes, type ByteSource } from "../contracts/index.js";
import { shellValueBytes, type ShellValue } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";
import { encoder, UsageError } from "./internal.js";

export async function* delimitedArguments(source: ByteSource, signal: AbortSignal, workSignal: AbortSignal, delimiter: number, limit: number): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(Math.min(1024, limit));
  let length = 0;
  let work = 0;
  for await (const chunk of readBytes(source, signal)) {
    for (const byte of chunk) {
      if (++work % 4096 === 0) { await yieldTurn(workSignal); signal.throwIfAborted(); }
      if (byte === delimiter) {
        yield buffer.slice(0, length);
        length = 0;
      } else {
        if (byte === 0) throw new UsageError("NUL in non-NUL-delimited input is not supported");
        if (length === limit) throw new UsageError("single argument exceeds command size limit");
        if (length === buffer.length) {
          const grown = new Uint8Array(Math.min(limit, Math.max(1, buffer.length * 2)));
          grown.set(buffer);
          buffer = grown;
        }
        buffer[length++] = byte;
      }
    }
  }
  if (length) yield buffer.slice(0, length);
}

export async function replaceXargsArguments(values: readonly ShellValue[], needle: Uint8Array, replacement: string | Uint8Array, available: number, signal: AbortSignal): Promise<Uint8Array[]> {
  const inserted = typeof replacement === "string" ? encoder.encode(replacement) : replacement;
  const prefixes = new Uint32Array(needle.length);
  let work = 0;
  for (let offset = 1, matched = 0; offset < needle.length; offset++) {
    if (++work % 4096 === 0) await yieldTurn(signal);
    while (matched && needle[offset] !== needle[matched]) matched = prefixes[matched - 1]!;
    if (needle[offset] === needle[matched]) matched++;
    prefixes[offset] = matched;
  }
  const plans: { source: Uint8Array; matches: number[]; length: number }[] = [];
  for (const value of values) {
    const source = shellValueBytes(value);
    const matches: number[] = [];
    let length = source.length;
    for (let offset = 0, matched = 0; offset < source.length; offset++) {
      if (++work % 4096 === 0) await yieldTurn(signal);
      while (matched && source[offset] !== needle[matched]) matched = prefixes[matched - 1]!;
      if (source[offset] === needle[matched]) matched++;
      if (matched === needle.length) {
        matches.push(offset + 1 - matched);
        length += inserted.length - needle.length;
        matched = 0;
        if (length > available) throw new UsageError("expanded arguments exceed command size limit");
      }
    }
    available -= length + 1;
    if (available < 0) throw new UsageError("expanded arguments exceed command size limit");
    plans.push({ source, matches, length });
  }
  signal.throwIfAborted();
  const result: Uint8Array[] = [];
  for (const { source, matches, length } of plans) {
    const bytes = new Uint8Array(length);
    let offset = 0;
    let written = 0;
    for (const start of matches) {
      if (++work % 4096 === 0) await yieldTurn(signal);
      bytes.set(source.subarray(offset, start), written);
      written += start - offset;
      bytes.set(inserted, written);
      written += inserted.length;
      offset = start + needle.length;
    }
    bytes.set(source.subarray(offset), written);
    result.push(bytes);
  }
  return result;
}

export function xargsDisplay(value: ShellValue): string {
  let text: string | undefined = typeof value === "string" ? value : undefined;
  const bytes = typeof value === "string" ? undefined : shellValueBytes(value);
  if (bytes) {
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { text = undefined; }
  }
  let escaped = text === undefined;
  if (text !== undefined) for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 || code >= 127 && code <= 159) { escaped = true; break; }
  }
  if (escaped) {
    let quoted = "$'";
    for (const byte of bytes ?? encoder.encode(text!)) quoted += byte >= 32 && byte < 127 && byte !== 92 && byte !== 39 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`;
    return `${quoted}'`;
  }
  let plain = text!.length > 0;
  for (const character of text!) {
    const code = character.charCodeAt(0);
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || character === "_" || character === "." || character === "/" || character === "-")) { plain = false; break; }
  }
  return plain ? text! : `'${text!.replaceAll("'", "'\\''")}'`;
}
