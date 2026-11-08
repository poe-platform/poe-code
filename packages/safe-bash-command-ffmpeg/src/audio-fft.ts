// In-place radix-2 transform. The inverse is unnormalized.
export function transform(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    for (let k = 0; k < size / 2; k++) {
      const angle = (inverse ? 2 : -2) * Math.PI * k / size;
      const wr = Math.cos(angle), wi = Math.sin(angle);
      for (let a = k; a < n; a += size) {
        const b = a + size / 2;
        const r = real[b]! * wr - imaginary[b]! * wi;
        const im = real[b]! * wi + imaginary[b]! * wr;
        real[b] = real[a]! - r; imaginary[b] = imaginary[a]! - im;
        real[a] = real[a]! + r; imaginary[a] = imaginary[a]! + im;
      }
    }
  }
}

