import type { ByteSource } from 'safe-bash-contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { sqliteSourceChunks } from './sqlite-stream.js';

export interface SqliteNormalizedToken {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly end: number;
}

/** Stream the default native unicode61 token sequence, retaining at most FTS5's
 * 32768-byte indexed prefix per token. tokenize must synchronously invoke the
 * native unicode61 tokenizer on its bounded input and return normalized tokens
 * with native byte offsets. This adapter preserves token order, not source byte
 * offsets; malformed UTF-8 may be compacted using SQLite's 32-bit decoder state.
 * The caller owns native callback registration and FTS insertion. */
export async function* streamSqliteUnicode61(source: ByteSource, signal: AbortSignal,
  tokenize: (bytes: Uint8Array) => Iterable<SqliteNormalizedToken>): ByteSource {
  const pending = new Uint8Array(32768);
  let used = 0, continuing = false;
  let carry: Uint8Array = new Uint8Array();
  const take = (): Uint8Array | undefined => {
    const value = continuing ? pending.slice(0, used) : undefined;
    used = 0; continuing = false; return value;
  };
  function* feed(part: Uint8Array): Iterable<Uint8Array> {
    const prefix = continuing ? 1 : 0;
    const framed = new Uint8Array(prefix + part.length + 1);
    if (prefix) framed[0] = 97;
    framed.set(part, prefix); framed[framed.length - 1] = 97;
    let end = 0;
    for (const token of tokenize(framed)) {
      signal.throwIfAborted();
      if (!(token.bytes instanceof Uint8Array) || !Number.isSafeInteger(token.start) || !Number.isSafeInteger(token.end) ||
          token.start < end || token.end <= token.start || token.end > framed.length || token.bytes.length > framed.length * 4) {
        throw new TypeError('Invalid native SQLite token');
      }
      end = token.end;
      const first = Boolean(prefix && token.start === 0), last = token.end === framed.length;
      // A standalone trailing sentinel is not part of the document.
      if (last && token.start === framed.length - 1) continue;
      if (!first) { const previous = take(); if (previous) yield previous; }
      if (first && token.bytes[0] !== 97 || last && token.bytes.at(-1) !== 97) throw new TypeError('SQLite tokenizer must preserve unicode61 sentinels');
      const value = token.bytes.subarray(first ? 1 : 0, token.bytes.length - (last ? 1 : 0));
      const length = Math.min(value.length, pending.length - used);
      pending.set(value.subarray(0, length), used); used += length; continuing = true;
      if (!last) { const complete = take(); if (complete) yield complete; }
    }
  }
  for await (const chunk of sqliteSourceChunks(source, signal)) {
    await yieldTurn(signal);
    if (!(chunk instanceof Uint8Array)) throw new TypeError('SQLite text source must yield bytes');
    for (let offset = 0; offset < chunk.length; offset += 16384) {
      await yieldTurn(signal);
      const part = chunk.subarray(offset, offset + 16384);
      const joined = new Uint8Array(carry.length + part.length);
      joined.set(carry); joined.set(part, carry.length);
      let lead = joined.length - 1;
      while (lead >= 0 && (joined[lead]! & 192) === 128) lead--;
      // SQLite consumes every continuation byte after a leading byte, including
      // malformed sequences longer than four bytes. Preserve that grouping.
      const stop = lead >= 0 && joined[lead]! >= 192 ? lead : joined.length;
      const tail = joined.subarray(stop);
      if (tail.length > 7) {
        // Six continuation bytes completely replace the 32-bit decoder state.
        carry = new Uint8Array(7); carry[0] = 240; carry.set(tail.subarray(tail.length - 6), 1);
      } else carry = tail.slice();
      yield* feed(joined.subarray(0, stop));
    }
  }
  if (carry.length) yield* feed(carry);
  signal.throwIfAborted();
  const final = take(); if (final) yield final;
}
