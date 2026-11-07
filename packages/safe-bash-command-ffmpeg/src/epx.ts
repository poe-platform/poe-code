import { yieldTurn } from "safe-bash-contracts/yield";

export async function epxFrame(
  data: Uint8Array, width: number, height: number, factor: 2 | 3, signal?: AbortSignal
): Promise<Uint8Array> {
  const output = new Uint8Array(width * height * factor * factor * 4);
  const source = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const target = new Uint32Array(output.buffer);
  const targetWidth = width * factor;
  let work = 0;
  for (let y = 0; y < height; y++) {
    const above = Math.max(0, y - 1) * width;
    const row = y * width;
    const below = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      // The 3x3 source neighborhood is A B C / D E F / G H I.
      const a = source[above + left]!;
      const b = source[above + x]!;
      const c = source[above + right]!;
      const d = source[row + left]!;
      const e = source[row + x]!;
      const f = source[row + right]!;
      const g = source[below + left]!;
      const h = source[below + x]!;
      const i = source[below + right]!;
      const offset = y * factor * targetWidth + x * factor;
      for (let dy = 0; dy < factor; dy++) target.fill(e, offset + dy * targetWidth, offset + dy * targetWidth + factor);
      if (b === h || d === f) continue;
      target[offset] = d === b ? d : e;
      target[offset + factor - 1] = b === f ? f : e;
      target[offset + (factor - 1) * targetWidth] = d === h ? d : e;
      target[offset + (factor - 1) * targetWidth + factor - 1] = h === f ? f : e;
      if (factor === 3) {
        target[offset + 1] = (d === b && e !== c) || (b === f && e !== a) ? b : e;
        target[offset + targetWidth] = (d === b && e !== g) || (d === h && e !== a) ? d : e;
        target[offset + targetWidth + 2] = (b === f && e !== i) || (h === f && e !== c) ? f : e;
        target[offset + 2 * targetWidth + 1] = (d === h && e !== i) || (h === f && e !== g) ? h : e;
      }
    }
  }
  return output;
}
