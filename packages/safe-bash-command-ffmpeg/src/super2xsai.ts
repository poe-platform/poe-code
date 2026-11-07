import { yieldTurn } from "safe-bash-contracts/yield";

// Average packed RGBA channels independently, rounding down as native FFmpeg does.
function blend(a: number, b: number, weight = 1): number {
  let result = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    result |= Math.floor((((a >>> shift) & 255) * weight + ((b >>> shift) & 255)) / (weight + 1)) << shift;
  }
  return result >>> 0;
}

export async function super2xsaiFrame(
  data: Uint8Array, width: number, height: number, signal?: AbortSignal
): Promise<Uint8Array> {
  const output = new Uint8Array(width * height * 16);
  const source = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const target = new Uint32Array(output.buffer);
  const stride = width * 2;
  const at = (x: number, y: number): number =>
    source[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;
  let work = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      // The central square is A B / C D; inspect its surrounding ring to
      // choose a diagonal, then soften only edges supported by that ring.
      const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1);
      const topLeft = at(x - 1, y - 1), top = at(x, y - 1);
      const topRight = at(x + 1, y - 1), topFar = at(x + 2, y - 1);
      const left = at(x - 1, y), right = at(x + 2, y);
      const lowerLeft = at(x - 1, y + 1), lowerRight = at(x + 2, y + 1);
      const bottomLeft = at(x - 1, y + 2), bottom = at(x, y + 2);
      const bottomRight = at(x + 1, y + 2), bottomFar = at(x + 2, y + 2);
      let upper, lower;
      if (c === b && a !== d) {
        upper = lower = c;
      } else if (a === d && c !== b) {
        upper = lower = a;
      } else if (a === d && c === b) {
        let vote = 0;
        for (const [p, q] of [[left, bottom], [lowerLeft, top], [bottomRight, lowerRight], [topRight, right]]) {
          vote += Number(b !== p || b !== q) - Number(a !== p || a !== q);
        }
        upper = lower = vote > 0 ? b : vote < 0 ? a : blend(a, b);
      } else {
        lower = b === d && d === bottom && c !== bottomRight && d !== bottomLeft
          ? blend(d, c, 3)
          : a === c && c === bottomRight && bottom !== d && c !== bottomFar
            ? blend(c, d, 3) : blend(c, d);
        upper = b === d && b === top && a !== topRight && b !== topLeft
          ? blend(b, a, 3)
          : a === c && a === topRight && top !== b && a !== topFar
            ? blend(a, b, 3) : blend(a, b);
      }
      const softenLower = (a === d && c !== b && left === a && a !== bottomRight) ||
        (a === lowerLeft && b === a && left !== c && a !== bottomLeft);
      const softenUpper = (c === b && a !== d && lowerLeft === c && c !== topRight) ||
        (left === c && d === c && lowerLeft !== a && c !== topLeft);
      const offset = y * 2 * stride + x * 2;
      target[offset] = softenUpper ? blend(c, a) : a;
      target[offset + 1] = upper;
      target[offset + stride] = softenLower ? blend(c, a) : c;
      target[offset + stride + 1] = lower;
    }
  }
  return output;
}
