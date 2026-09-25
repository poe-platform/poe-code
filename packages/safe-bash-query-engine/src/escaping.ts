import { writeBytes, type ByteSink } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";

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
  let clean = true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code >= 127 || code === 92) {
      clean = false;
      break;
    }
  }
  if (clean) {
    checkOutput?.(value.length);
    return value;
  }
  let result = "", bytes = 0;
  for (const part of parts(value, mode)) {
    bytes += Buffer.byteLength(part);
    checkOutput?.(bytes);
    result += part;
  }
  return result;
}

/** GNU shell-escape-always operand quoting in the C locale. */
export function quoteShellOperand(value: string): string {
  if (value.includes("'") && !["$", "`", "\\", '"'].some(character => value.includes(character))
    && [...value].every(character => character >= " " && character <= "~")) return `"${value}"`;
  const escapes: Readonly<Record<number, string>> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
  let result = "'", escaped = false;
  for (const byte of encoder.encode(value)) {
    const special = byte < 32 || byte >= 127;
    if (special !== escaped) {
      result += special ? "'$'" : byte === 39 ? "" : "''";
      escaped = special;
    }
    result += special ? escapes[byte] ?? `\\${byte.toString(8).padStart(3, "0")}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
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
