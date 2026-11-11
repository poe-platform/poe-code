import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

// FFmpeg convolves two rectangles using double RDFTs. Evaluating the resulting
// trapezoid directly loses the transform roundoff present in double PCM output.
export function declickWindow(size: number, hop: number, budget: MediaBudgetTracker): Float64Array {
  const n = 2 ** (Math.floor(Math.log2(size)) + 1);
  budget.allocateMemory(((n + 2) * 4 + n / 4 + 1) * 8);
  const cosine = Float64Array.from({ length: n / 4 + 1 }, (_, i) => i === n / 4 ? 0 : Math.cos(i * (2 * Math.PI / n)));
  const a = new Float64Array(n + 2), b = new Float64Array(n + 2);
  const fa = new Float64Array(n + 2), fb = new Float64Array(n + 2);
  a.fill(1, 0, size - hop); b.fill(1, 0, hop);
  rdft(a, fa, cosine); rdft(b, fb, cosine);
  for (let i = 0; i <= n; i += 2) {
    a[i] = fa[i]! * fb[i]! - fa[i + 1]! * fb[i + 1]!;
    a[i + 1] = fa[i]! * fb[i + 1]! + fb[i]! * fa[i + 1]!;
  }
  rdft(a, fa, cosine, true);
  const scale = 1 / (size - hop);
  for (let i = 0; i < size; i++) fa[i] = fa[i]! * scale;
  budget.checkCpu();
  return fa.subarray(0, size);
}

function rdft(input: Float64Array, output: Float64Array, cosine: Float64Array, inverse = false): void {
  const n = input.length - 2, half = n / 2;
  const data = inverse ? input : output;
  if (inverse) data[1] = data[n]!;
  else splitRadix(input, output, cosine, 0, 1, half, 0);
  const scale = inverse ? 1 / n : 1;
  const dc = data[0]!, nyquist = data[1]!;
  data[0] = (dc + nyquist) * scale; data[1] = (dc - nyquist) * scale;
  data[half] = data[half]! * (inverse ? 2 * scale : 1);
  data[half + 1] = data[half + 1]! * (inverse ? -2 * scale : -1);
  for (let i = 1; i < n / 4; i++) {
    const a = 2 * i, b = n - a;
    const evenR = (inverse ? scale : 0.5) * (data[a]! + data[b]!);
    const evenI = (inverse ? -scale : -0.5) * (data[a + 1]! - data[b + 1]!);
    const oddR = (inverse ? -scale : 0.5) * (data[a + 1]! + data[b + 1]!);
    const oddI = (inverse ? scale : -0.5) * (data[a]! - data[b]!);
    const wr = cosine[i]!, wi = cosine[n / 4 - i]! * (inverse ? 1 : -1);
    const r = oddR * wr - oddI * wi, im = oddR * wi + oddI * wr;
    data[a] = evenR + r; data[a + 1] = im - evenI;
    data[b] = evenR - r; data[b + 1] = im + evenI;
  }
  if (inverse) splitRadix(data, output, cosine, 0, -1, half, 0);
  else { output[n] = output[1]!; output[1] = output[n + 1] = 0; }
}

// Conjugate-pair split radix preserves FFmpeg's double butterfly ordering.
// Reversing the input stride computes the inverse without changing that order.
function splitRadix(input: Float64Array, out: Float64Array, cosine: Float64Array,
  start: number, step: number, n: number, offset: number): void {
  const mask = (input.length - 2) / 2 - 1;
  if (n === 2) {
    const a = 2 * (start & mask), b = 2 * ((start + step) & mask);
    out[offset] = input[a]! + input[b]!; out[offset + 1] = input[a + 1]! + input[b + 1]!;
    out[offset + 2] = input[a]! - input[b]!; out[offset + 3] = input[a + 1]! - input[b + 1]!;
    return;
  }
  if (n === 4) {
    const a = 2 * (start & mask), b = 2 * ((start + step) & mask);
    const c = 2 * ((start + 2 * step) & mask), d = 2 * ((start + 3 * step) & mask);
    const ar = input[a]! + input[c]!, ai = input[a + 1]! + input[c + 1]!;
    const br = input[b]! + input[d]!, bi = input[b + 1]! + input[d + 1]!;
    const cr = input[a]! - input[c]!, ci = input[a + 1]! - input[c + 1]!;
    const dr = input[d]! - input[b]!, di = input[b + 1]! - input[d + 1]!;
    out[offset] = ar + br; out[offset + 1] = ai + bi;
    out[offset + 2] = cr + di; out[offset + 3] = ci + dr;
    out[offset + 4] = ar - br; out[offset + 5] = ai - bi;
    out[offset + 6] = cr - di; out[offset + 7] = ci - dr;
    return;
  }
  splitRadix(input, out, cosine, start, step * 2, n / 2, offset);
  splitRadix(input, out, cosine, start + step, step * 4, n / 4, offset + n);
  splitRadix(input, out, cosine, start - step, step * 4, n / 4, offset + n * 1.5);
  for (let k = 0; k < n / 4; k++) {
    const a = offset + 2 * k, b = a + n / 2, c = a + n, d = b + n;
    const index = k * (input.length - 2) / n;
    const wr = cosine[index]!, wi = cosine[(input.length - 2) / 4 - index]!;
    const cr = out[c]! * wr - out[c + 1]! * -wi, ci = out[c]! * -wi + out[c + 1]! * wr;
    const dr = out[d]! * wr - out[d + 1]! * wi, di = out[d]! * wi + out[d + 1]! * wr;
    const sumR = dr + cr, sumI = ci + di, diffR = dr - cr, diffI = ci - di;
    const ar = out[a]!, ai = out[a + 1]!, br = out[b]!, bi = out[b + 1]!;
    out[a] = ar + sumR; out[a + 1] = ai + sumI;
    out[b] = br + diffI; out[b + 1] = bi + diffR;
    out[c] = ar - sumR; out[c + 1] = ai - sumI;
    out[d] = br - diffI; out[d + 1] = bi - diffR;
  }
}
