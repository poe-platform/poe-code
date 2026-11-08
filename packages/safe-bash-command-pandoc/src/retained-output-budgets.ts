import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";

/** Replay native text finalization without retaining the output. Source chunks
 * preserve Unicode scalar boundaries and can be replayed from caller storage. */
export async function reserveRetainedOutput(source: () => AsyncIterable<string>, context: ExecutionContext, eol: ConversionOptions["eol"], encodeSlices = true): Promise<void> {
  const retained = Number.isFinite(context.limits.retainedBytes);
  if (!Number.isFinite(context.limits.references) && !retained) return;
  if (retained) {let units = 0; for await (const chunk of source()) units += chunk.length; context.charge("retainedBytes", units * 2);}
  if (eol === "crlf") {
    let units = 0;
    for await (const chunk of source()) for (const char of chunk) {
      units += char === "\n" ? 2 : char.length;
      context.bound("outputBytes", units);
      if (retained) context.charge("retainedBytes", char === "\n" ? 4 : char.length * 2);
      context.charge("references", 1);
    }
    if (retained) context.charge("retainedBytes", units * 2);
  }
  if (Number.isFinite(context.limits.outputBytes) || retained) {
    let length = 0;
    for await (const chunk of source()) for (const char of chunk) {
      if (eol === "crlf" && char === "\n") context.bound("outputBytes", ++length);
      const code = char.codePointAt(0)!;
      length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      context.bound("outputBytes", length);
    }
    if (retained) {
      context.charge("retainedBytes", length);
      if (!encodeSlices) return;
      let units = 0;
      for await (const chunk of source()) for (const char of chunk) {
        const next = eol === "crlf" && char === "\n" ? 2 : char.length;
        // Native encoding slices at 4096 UTF-16 units, keeping surrogate pairs intact.
        if (units + next > 4096 && char.length === 2) {context.charge("retainedBytes", units * 2); units = 0;}
        units += next;
        if (units >= 4096) {context.charge("retainedBytes", 8192); units -= 4096;}
      }
      if (units) context.charge("retainedBytes", units * 2);
    }
  }
}

/** Preserve native output-sink allocation boundaries for cumulative byte quotas. */
export async function emitRetainedOutput(chunks: AsyncIterable<Uint8Array>, context: ExecutionContext): Promise<void> {
  if (!Number.isFinite(context.limits.retainedBytes)) {for await (const bytes of chunks) await context.emit(bytes); return;}
  let buffer = new Uint8Array(4096), used = 0;
  for await (const bytes of chunks) for (let offset = 0; offset < bytes.length;) {
    const count = Math.min(buffer.length - used, bytes.length - offset);
    buffer.set(bytes.subarray(offset, offset + count), used); used += count; offset += count;
    if (used === buffer.length) {await context.emit(buffer); buffer = new Uint8Array(4096); used = 0;}
  }
  if (used) await context.emit(buffer.subarray(0, used));
}
