import type { PdfPathSegment, PdfPixelStorage } from "../ast.js";
import type { CffCodeSource, Type2Compiled } from "../vendor/pdfjs-fonts.mjs";
import { StoredFontOperands } from "./stored-operands.js";
import { commandSegments } from "./cff.js";
import type { PdfFontAllocationOptions } from "./memory.js";

/** Drain native operations while leasing reusable operand pages. Suspended or
 * concurrent glyph iterators never share a mutable operand stack. */
export function createStoredCffRenderer(
  renderer: Type2Compiled,
  getGlyph: (gid: number) => Promise<CffCodeSource | Uint8Array | undefined>,
  storage: PdfPixelStorage,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> & { signal?: AbortSignal } = {}
) {
  let commandPeak = 0;
  const pool: { free?: Map<number, StoredFontOperands> | undefined } = {};
  const { signal } = options;
  return async function* glyphSegments(glyph: number): AsyncGenerator<PdfPathSegment> {
    const code = (await getGlyph(glyph)) ?? new Uint8Array();
    const stacks = pool.free ?? new Map<number, StoredFontOperands>();
    pool.free = undefined;
    let scratch = 0;
    const charge = (bytes: number) => {
      scratch += bytes;
      if (scratch > commandPeak) {
        options.onAllocation?.(scratch - commandPeak);
        commandPeak = scratch;
      }
    };
    const steps = renderer.glyphCommands(code, glyph, charge, (depth) => {
      let stack = stacks.get(depth);
      if (!stack) {
        options.onAllocation?.(16384);
        stack = new StoredFontOperands(storage, signal);
        stacks.set(depth, stack);
      }
      stack.length = 0;
      return stack;
    });
    try {
      let step = steps.next(),
        requests = 0;
      while (!step.done) {
        if (++requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        if (step.value instanceof Promise) step = steps.next(await step.value);
        else {
          yield* commandSegments(step.value);
          step = steps.next();
        }
      }
    } finally {
      steps.return();
      // Another iterator may have returned a lease while this one was suspended.
      const available = pool.free as Map<number, StoredFontOperands> | undefined;
      if (!available || available.size < stacks.size) pool.free = stacks;
    }
  };
}
