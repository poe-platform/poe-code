import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { fail, type ArchiveLimits } from "../internal.js";

/** Info-ZIP's fgets/strlen archive-comment grammar, with explicit byte limits. */
export async function readZipComment(source: ByteSource, limits: ArchiveLimits, signal: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const line: number[] = [];
  let length = 0;
  let bytes = 0;
  let pulls = 0;
  const append = (): boolean => {
    const zero = line.indexOf(0);
    const text = line.slice(0, zero < 0 ? undefined : zero);
    line.length = 0;
    if (text.length === 2 && text[0] === 46 && text[1] === 10) return false;
    if (text.at(-1) === 10) text.pop();
    const separator = length || !text.length ? 2 : 0;
    if (text.length + separator > Math.min(limits.maxTextBytes, 65535) - length) fail("ZIP archive comment byte limit exceeded");
    if (separator) parts.push(Buffer.from("\r\n"));
    if (text.length) parts.push(Uint8Array.from(text));
    length += separator + text.length;
    return true;
  };
  for await (const chunk of readBytes(source, signal)) {
    if (++pulls > limits.maxPatternSteps) fail("ZIP comment input work limit exceeded");
    for (const byte of chunk) {
      if (++bytes > limits.maxFilesFromBytes) fail("ZIP comment input byte limit exceeded");
      line.push(byte);
      if ((byte === 10 || line.length === 65535) && !append()) return Buffer.concat(parts, length);
      if (bytes % 4096 === 0) await yieldTurn(signal);
    }
    if (pulls % 64 === 0) await yieldTurn(signal);
  }
  if (line.length) append();
  return Buffer.concat(parts, length);
}
