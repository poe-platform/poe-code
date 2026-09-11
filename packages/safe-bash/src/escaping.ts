import { writeBytes, type ByteSink } from "./contracts/index.js";
import { yieldTurn } from "./contracts/yield.js";

const controls: Readonly<Record<number, string>> = { 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 92: "\\\\" };
const encoder = new TextEncoder();

function* parts(value: string, mode: "display" | "diagnostic"): Generator<string> {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (mode === "diagnostic" && (point === 9 || point === 10 || point >= 32 && (point < 127 || point > 159))) {
      yield character;
    } else {
      for (const byte of encoder.encode(character)) {
        yield controls[byte] ?? (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, "0")}`);
      }
    }
  }
}

export function escapeText(value: string, mode: "display" | "diagnostic", checkOutput?: (bytes: number) => void): string {
  let result = "", bytes = 0;
  for (const part of parts(value, mode)) {
    bytes += Buffer.byteLength(part);
    checkOutput?.(bytes);
    result += part;
  }
  return result;
}

export async function writeDiagnostic(sink: ByteSink, value: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let chunk = "", bytes = 0, work = 0;
  for (const part of parts(value, "diagnostic")) {
    signal?.throwIfAborted();
    const size = Buffer.byteLength(part);
    if (bytes + size > 16_384) {
      await writeBytes(sink, encoder.encode(chunk), signal);
      chunk = ""; bytes = 0;
    }
    chunk += part; bytes += size;
    if (++work % 1024 === 0) await yieldTurn(signal);
  }
  if (bytes) await writeBytes(sink, encoder.encode(chunk), signal);
  signal?.throwIfAborted();
}
