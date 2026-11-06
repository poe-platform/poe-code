import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { ByteSource } from "safe-bash-contracts";
import type { CodecInput } from "./codec.js";

// Unix compress stores LSB-first LZW codes in groups of eight. Width changes
// and dictionary resets discard the remainder of the current group.
export async function* uncompress(input: CodecInput, flags: number, signal: AbortSignal): ByteSource {
  const maxBits = flags & 31;
  if (maxBits < 9 || maxBits > 16 || (flags & 0x60)) throw new PublicDiagnostic("invalid compress header");
  const blockMode = (flags & 0x80) !== 0;
  const capacity = 1 << maxBits;
  const prefix = new Uint16Array(capacity);
  const suffix = new Uint8Array(capacity);
  const stack = new Uint8Array(capacity);
  const group = new Uint8Array(16);
  let output = new Uint8Array(64 * 1024);
  let used = 0;
  let width = 9;
  let next = blockMode ? 257 : 256;
  let previous = -1;
  let first = 0;
  let groups = 0;
  for (;;) {
    signal.throwIfAborted();
    if (++groups % 64 === 0) await yieldTurn(signal);
    let length = 0;
    while (length < width) {
      const bytes = await input.chunk();
      if (!bytes) break;
      const count = Math.min(bytes.length, width - length);
      group.set(bytes.subarray(0, count), length);
      length += count;
      input.restore(bytes.subarray(count));
    }
    if (!length) break;
    for (let bit = 0; bit + width <= length * 8; bit += width) {
      const offset = bit >>> 3;
      const code = ((group[offset]! | ((group[offset + 1] ?? 0) << 8) | ((group[offset + 2] ?? 0) << 16)) >>> (bit & 7)) & ((1 << width) - 1);
      if (blockMode && code === 256) {
        width = 9;
        next = 257;
        previous = -1;
        break;
      }
      let current = code;
      let size = 0;
      if (current === next && previous !== -1) {
        stack[size++] = first;
        current = previous;
      } else if (current >= next || (previous === -1 && current >= 256)) {
        throw new PublicDiagnostic("invalid compress code");
      }
      while (current >= 256) {
        stack[size++] = suffix[current]!;
        current = prefix[current]!;
      }
      first = current;
      stack[size++] = first;
      while (size) {
        output[used++] = stack[--size]!;
        if (used === output.length) {
          yield output;
          output = new Uint8Array(64 * 1024);
          used = 0;
        }
      }
      if (previous !== -1 && next < capacity) {
        prefix[next] = previous;
        suffix[next++] = first;
      }
      previous = code;
      if (next === (1 << width) && width < maxBits) {
        width++;
        break;
      }
    }
  }
  if (used) yield output.subarray(0, used);
}
