const f = Math.fround;

// Single-precision conjugate-pair split radix, with the butterfly ordering used
// by FFmpeg's x86-64 RDFT. Near-cancelling stereo amplifies even FFT roundoff.
export function dialogueSpectrum(input: Float64Array, output: Float64Array, cosine: Float32Array): void {
  const size = input.length, half = size / 2;
  splitRadix(input, output, cosine, 0, 1, half, 0);
  const dc = output[0]!, nyquist = output[1]!;
  output[0] = f(dc + nyquist); output[1] = f(dc - nyquist);
  output[half + 1] = -output[half + 1]!;
  for (let i = 1; i < size / 4; i++) {
    const a = 2 * i, b = size - a;
    const evenR = f(0.5 * f(output[a]! + output[b]!));
    const evenI = f(-0.5 * f(output[a + 1]! - output[b + 1]!));
    const oddR = f(0.5 * f(output[a + 1]! + output[b + 1]!));
    const oddI = f(-0.5 * f(output[a]! - output[b]!));
    const wr = cosine[i]!, wi = -cosine[size / 4 - i]!;
    const r = f(f(oddR * wr) - f(oddI * wi));
    const im = f(f(oddR * wi) + f(oddI * wr));
    output[a] = f(evenR + r); output[a + 1] = f(im - evenI);
    output[b] = f(evenR - r); output[b + 1] = f(im + evenI);
  }
  // Unpack into the caller's separate real/imaginary buffers. Forward copying
  // is safe: each packed pair is read before either destination can overwrite it.
  const last = output[1]!;
  input[0] = output[0]!; output[0] = 0;
  for (let i = 1; i < half; i++) {
    input[i] = output[2 * i]!; output[i] = output[2 * i + 1]!;
  }
  input[half] = last; output[half] = 0;
}

// Unnormalized inverse real transform. Pack into the imaginary workspace
// backwards so each bin is read before it is overwritten.
export function inverseRealSpectrum(real: Float64Array, imaginary: Float64Array, cosine: Float32Array): void {
  const size = real.length, half = size / 2;
  for (let i = half - 1; i > 0; i--) {
    imaginary[2 * i + 1] = imaginary[i]!;
    imaginary[2 * i] = real[i]!;
  }
  imaginary[0] = f(real[0]! + real[half]!);
  imaginary[1] = f(real[0]! - real[half]!);
  imaginary[half] = f(2 * imaginary[half]!);
  imaginary[half + 1] = f(-2 * imaginary[half + 1]!);
  for (let i = 1; i < size / 4; i++) {
    const a = 2 * i, b = size - a;
    const evenR = f(imaginary[a]! + imaginary[b]!);
    const evenI = -f(imaginary[a + 1]! - imaginary[b + 1]!);
    const oddR = -f(imaginary[a + 1]! + imaginary[b + 1]!);
    const oddI = f(imaginary[a]! - imaginary[b]!);
    const wr = cosine[i]!, wi = cosine[size / 4 - i]!;
    const r = f(f(oddR * wr) - f(oddI * wi));
    const im = f(f(oddR * wi) + f(oddI * wr));
    imaginary[a] = f(evenR + r); imaginary[a + 1] = f(im - evenI);
    imaginary[b] = f(evenR - r); imaginary[b + 1] = f(im + evenI);
  }
  splitRadix(imaginary, real, cosine, 0, -1, half, 0);
}

function splitRadix(input: Float64Array, out: Float64Array, cosine: Float32Array,
  start: number, step: number, n: number, offset: number): void {
  const mask = input.length / 2 - 1;
  if (n === 4) {
    const a = 2 * (start & mask), b = 2 * ((start + step) & mask);
    const c = 2 * ((start + 2 * step) & mask), d = 2 * ((start + 3 * step) & mask);
    const ar = f(input[a]! + input[c]!), ai = f(input[a + 1]! + input[c + 1]!);
    const br = f(input[b]! + input[d]!), bi = f(input[b + 1]! + input[d + 1]!);
    const cr = f(input[a]! - input[c]!), ci = f(input[a + 1]! - input[c + 1]!);
    const dr = f(input[b]! - input[d]!), di = f(input[b + 1]! - input[d + 1]!);
    out[offset] = f(ar + br); out[offset + 1] = f(ai + bi);
    out[offset + 2] = f(cr + di); out[offset + 3] = f(ci - dr);
    out[offset + 4] = f(ar - br); out[offset + 5] = f(ai - bi);
    out[offset + 6] = f(cr - di); out[offset + 7] = f(ci + dr);
    return;
  }
  if (n === 8) {
    fft8(input, out, start, step, offset, false);
    return;
  }
  if (n === 16) fft8(input, out, start, step * 2, offset, true);
  else splitRadix(input, out, cosine, start, step * 2, n / 2, offset);
  splitRadix(input, out, cosine, start + step, step * 4, n / 4, offset + n);
  splitRadix(input, out, cosine, start - step, step * 4, n / 4, offset + n * 1.5);
  for (let k = 0; k < n / 4; k++) {
    const a = offset + 2 * k, b = a + n / 2, c = a + n, d = b + n;
    const index = k * input.length / n;
    const wr = cosine[index]!, wi = cosine[input.length / 4 - index]!;
    let cr: number, ci: number, dr: number, di: number;
    // The 16-point base combines the diagonal terms before scaling; larger
    // stages round the sine product before the fused cosine multiply-add.
    if (n === 16 && k === 2) {
      cr = f(f(out[c]! + out[c + 1]!) * wr); ci = f(f(out[c + 1]! - out[c]!) * wr);
      dr = f(f(out[d]! - out[d + 1]!) * wr); di = f(f(out[d + 1]! + out[d]!) * wr);
    } else if (n === 16) {
      cr = f(f(out[c]! * wr) + out[c + 1]! * wi); ci = f(f(out[c + 1]! * wr) - out[c]! * wi);
      dr = f(f(out[d]! * wr) - out[d + 1]! * wi); di = f(f(out[d + 1]! * wr) + out[d]! * wi);
    } else {
      cr = f(out[c]! * wr + f(out[c + 1]! * wi)); ci = f(out[c + 1]! * wr - f(out[c]! * wi));
      dr = f(out[d]! * wr - f(out[d + 1]! * wi)); di = f(out[d + 1]! * wr + f(out[d]! * wi));
    }
    const sumR = f(cr + dr), sumI = f(ci + di), diffR = f(dr - cr), diffI = f(ci - di);
    const ar = out[a]!, ai = out[a + 1]!, br = out[b]!, bi = out[b + 1]!;
    out[a] = f(ar + sumR); out[a + 1] = f(ai + sumI);
    out[b] = f(br + diffI); out[b + 1] = f(bi + diffR);
    out[c] = f(ar - sumR); out[c + 1] = f(ai - sumI);
    out[d] = f(br - diffI); out[d + 1] = f(bi - diffR);
  }
}

function fft8(input: Float64Array, out: Float64Array, start: number, step: number, offset: number, sumBeforeMultiply: boolean): void {
  const mask = input.length / 2 - 1;
  const a = 2 * (start & mask), b = 2 * ((start + 2 * step) & mask);
  const c = 2 * ((start + step) & mask), d = 2 * ((start - step) & mask);
  const e = 2 * ((start + 4 * step) & mask), g = 2 * ((start + 6 * step) & mask);
  const h = 2 * ((start + 5 * step) & mask), j = 2 * ((start + 3 * step) & mask);
  const ar = f(input[a]! + input[e]!), ai = f(input[a + 1]! + input[e + 1]!);
  const br = f(input[b]! + input[g]!), bi = f(input[b + 1]! + input[g + 1]!);
  const cr = f(input[c]! + input[h]!), ci = f(input[c + 1]! + input[h + 1]!);
  const dr = f(input[d]! + input[j]!), di = f(input[d + 1]! + input[j + 1]!);
  out[offset] = f(f(ar + br) + f(cr + dr)); out[offset + 1] = f(f(ai + bi) + f(ci + di));
  out[offset + 4] = f(f(ar - br) + f(ci - di)); out[offset + 5] = f(f(ai - bi) + f(dr - cr));
  out[offset + 8] = f(f(ar + br) - f(cr + dr)); out[offset + 9] = f(f(ai + bi) - f(ci + di));
  out[offset + 12] = f(f(ar - br) - f(ci - di)); out[offset + 13] = f(f(ai - bi) - f(dr - cr));
  const er = f(input[a]! - input[e]!), ei = f(input[a + 1]! - input[e + 1]!);
  const fr = f(input[b]! - input[g]!), fi = f(input[b + 1]! - input[g + 1]!);
  const gr = f(input[c]! - input[h]!), gi = f(input[c + 1]! - input[h + 1]!);
  const hr = f(input[d]! - input[j]!), hi = f(input[d + 1]! - input[j + 1]!);
  const root = f(Math.SQRT1_2);
  const p = sumBeforeMultiply ? f(f(gr + gi) * root) : f(f(gr * root) + f(gi * root));
  const q = sumBeforeMultiply ? f(f(gr - gi) * root) : f(f(gr * root) - f(gi * root));
  const r = sumBeforeMultiply ? f(f(hr - hi) * root) : f(f(hr * root) - f(hi * root));
  const s = sumBeforeMultiply ? f(f(hr + hi) * root) : f(f(hr * root) + f(hi * root));
  out[offset + 2] = f(f(er + fi) + f(r + p)); out[offset + 3] = f(f(ei - fr) + f(s - q));
  out[offset + 6] = f(f(er - fi) - f(s + q)); out[offset + 7] = f(f(ei + fr) + f(r - p));
  out[offset + 10] = f(f(er + fi) - f(r + p)); out[offset + 11] = f(f(ei - fr) - f(s - q));
  out[offset + 14] = f(f(er - fi) + f(s + q)); out[offset + 15] = f(f(ei + fr) - f(r - p));
}
