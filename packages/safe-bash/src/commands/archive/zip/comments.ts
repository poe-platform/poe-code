import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { fail, type ArchiveLimits } from "../internal.js";

/** One bounded cursor for all comments; an input chunk may contain many lines. */
export class ZipCommentInput {
  readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private bytes = 0;
  private pulls = 0;
  private ended = false;
  constructor(source: ByteSource, private readonly limits: ArchiveLimits, private readonly signal: AbortSignal) {
    this.iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  }
  async readLine(): Promise<Uint8Array | undefined> {
    const line: number[] = [];
    while (line.length < 65535) {
      this.signal.throwIfAborted();
      if (this.offset === this.chunk.length) {
        if (this.ended) break;
        if (++this.pulls > this.limits.maxPatternSteps) fail("ZIP comment input work limit exceeded");
        const next = await this.iterator.next();
        if (next.done) { this.ended = true; break; }
        this.chunk = next.value;
        this.offset = 0;
        if (this.pulls % 64 === 0) await yieldTurn(this.signal);
        if (!this.chunk.length) continue;
      }
      if (++this.bytes > this.limits.maxFilesFromBytes) fail("ZIP comment input byte limit exceeded");
      const byte = this.chunk[this.offset++]!;
      line.push(byte);
      if (this.bytes % 4096 === 0) await yieldTurn(this.signal);
      if (byte === 10) break;
    }
    if (!line.length) return undefined;
    const zero = line.indexOf(0);
    return Uint8Array.from(line.slice(0, zero < 0 ? undefined : zero));
  }
}

/** Info-ZIP's fgets/strlen archive-comment grammar, with explicit byte limits. */
export async function readZipComment(source: ByteSource | ZipCommentInput, limits: ArchiveLimits, signal: AbortSignal): Promise<Uint8Array> {
  const input = source instanceof ZipCommentInput ? source : new ZipCommentInput(source, limits, signal);
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const line = await input.readLine();
      if (line === undefined || line.length === 2 && line[0] === 46 && line[1] === 10) break;
      const text = line.at(-1) === 10 ? line.subarray(0, -1) : line;
      const separator = length || !text.length ? 2 : 0;
      if (text.length + separator > Math.min(limits.maxTextBytes, 65535) - length) fail("ZIP archive comment byte limit exceeded");
      if (separator) parts.push(Buffer.from("\r\n"));
      if (text.length) parts.push(text);
      length += separator + text.length;
    }
    return Buffer.concat(parts, length);
  } finally { await input.iterator.return?.(); }
}
