// In-place transform; the inverse is unnormalized. Non-power-of-two lengths
// use Bluestein convolution with four caller-owned, power-of-two scratch planes.
export function transform(real: Float64Array, imaginary: Float64Array, inverse = false, workspace?: Float64Array): void {
  const n = real.length;
  if ((n & (n - 1)) !== 0) {
    const padded = 2 ** Math.ceil(Math.log2(2 * n - 1));
    if (!workspace || workspace.length < 4 * padded) throw new Error("FFT workspace is too small");
    const ar = workspace.subarray(0, padded), ai = workspace.subarray(padded, 2 * padded);
    const br = workspace.subarray(2 * padded, 3 * padded), bi = workspace.subarray(3 * padded, 4 * padded);
    workspace.fill(0);
    for (let i = 0; i < n; i++) {
      const angle = (inverse ? 1 : -1) * Math.PI * (i * i % (2 * n)) / n;
      const wr = Math.cos(angle), wi = Math.sin(angle);
      ar[i] = real[i]! * wr - imaginary[i]! * wi;
      ai[i] = real[i]! * wi + imaginary[i]! * wr;
      br[i] = wr; bi[i] = -wi;
      if (i > 0) { br[padded - i] = wr; bi[padded - i] = -wi; }
    }
    transform(ar, ai);
    transform(br, bi);
    for (let i = 0; i < padded; i++) {
      const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
      ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
      ar[i] = r;
    }
    transform(ar, ai, true);
    for (let i = 0; i < n; i++) {
      const angle = (inverse ? 1 : -1) * Math.PI * (i * i % (2 * n)) / n;
      const wr = Math.cos(angle), wi = Math.sin(angle);
      real[i] = (ar[i]! * wr - ai[i]! * wi) / padded;
      imaginary[i] = (ar[i]! * wi + ai[i]! * wr) / padded;
    }
    return;
  }
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

