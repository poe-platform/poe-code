// Double RDFT with FFmpeg's conjugate-pair split-radix operation order.
// Scaling belongs to the RDFT packing step, before the inverse complex FFT.
export function dialogueDoubleTransform(real: Float64Array, imaginary: Float64Array,
  packed: Float64Array, scratch: Float64Array, cosine: Float64Array, inverse = false): void {
  const size = real.length, half = size / 2, quarter = size / 4;
  if (inverse) {
    for (let i = 0; i < half; i++) { packed[2 * i] = real[i]!; packed[2 * i + 1] = imaginary[i]!; }
    packed[1] = real[half]!;
  } else {
    splitRadix(real, packed, cosine, 0, 1, half, 0);
  }
  const scale = inverse ? 1 / (size * 1.5) : 1;
  const dc = packed[0]!, nyquist = packed[1]!;
  packed[0] = (dc + nyquist) * scale;
  packed[1] = (dc - nyquist) * scale;
  packed[half] = packed[half]! * (inverse ? 2 * scale : 1);
  packed[half + 1] = packed[half + 1]! * (inverse ? -2 * scale : -1);
  for (let i = 1; i < quarter; i++) {
    const a = 2 * i, b = size - a;
    const evenR = (inverse ? scale : 0.5) * (packed[a]! + packed[b]!);
    const evenI = (inverse ? -scale : -0.5) * (packed[a + 1]! - packed[b + 1]!);
    const oddR = (inverse ? -scale : 0.5) * (packed[a + 1]! + packed[b + 1]!);
    const oddI = (inverse ? scale : -0.5) * (packed[a]! - packed[b]!);
    const wr = cosine[i]!, wi = cosine[quarter - i]! * (inverse ? 1 : -1);
    const r = oddR * wr - oddI * wi, im = oddR * wi + oddI * wr;
    packed[a] = evenR + r; packed[a + 1] = im - evenI;
    packed[b] = evenR - r; packed[b + 1] = im + evenI;
  }
  if (inverse) {
    splitRadix(packed, scratch, cosine, 0, -1, half, 0);
    real.set(scratch);
  } else {
    real[half] = packed[1]!; imaginary[half] = 0;
    real[0] = packed[0]!; imaginary[0] = 0;
    for (let i = 1; i < half; i++) { real[i] = packed[2 * i]!; imaginary[i] = packed[2 * i + 1]!; }
  }
}

function splitRadix(input: Float64Array, out: Float64Array, cosine: Float64Array,
  start: number, step: number, n: number, offset: number): void {
  const mask = input.length / 2 - 1;
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
    const br = input[d]! + input[b]!, bi = input[b + 1]! + input[d + 1]!;
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
    const index = k * input.length / n;
    const wr = cosine[index]!, wi = cosine[input.length / 4 - index]!;
    const cr = k === 0 ? out[c]! : out[c]! * wr - out[c + 1]! * -wi;
    const ci = k === 0 ? out[c + 1]! : out[c]! * -wi + out[c + 1]! * wr;
    const dr = k === 0 ? out[d]! : out[d]! * wr - out[d + 1]! * wi;
    const di = k === 0 ? out[d + 1]! : out[d]! * wi + out[d + 1]! * wr;
    const sumR = dr + cr, sumI = ci + di, diffR = dr - cr, diffI = ci - di;
    const ar = out[a]!, ai = out[a + 1]!, br = out[b]!, bi = out[b + 1]!;
    out[a] = ar + sumR; out[a + 1] = ai + sumI;
    out[b] = br + diffI; out[b + 1] = bi + diffR;
    out[c] = ar - sumR; out[c + 1] = ai - sumI;
    out[d] = br - diffI; out[d + 1] = bi - diffR;
  }
}
