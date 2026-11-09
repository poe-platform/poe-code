import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

// Default swresample 32-tap Kaiser window (beta 9), with antialias cutoff.
export function createResampleKernel(from: number, to: number, budget: MediaBudgetTracker) {
  const factor = Math.min(to * 0.97 / from, 1);
  const taps = Math.ceil(Math.ceil(32 / factor) / 2) * 2;
  const center = (taps - 2) / 2;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const phases = Math.min(1024, to / gcd(from, to));
  budget.allocateMemory(phases * taps * 8);
  const bessel = (x: number) => {
    let sum = 1, term = 1;
    for (let k = 1; k < 40; k++) { term *= x * x / (4 * k * k); sum += term; if (term < sum * 1e-16) break; }
    return sum;
  };
  let norm = 0;
  const kernels = Array.from({ length: phases }, (_, phase) => {
    const kernel = Float64Array.from({ length: taps }, (_, i) => {
      const distance = i - center - phase / phases;
      const x = Math.PI * distance * factor;
      return (x === 0 ? 1 : Math.sin(x) / x) * bessel(9 * Math.sqrt(Math.max(0, 1 - (2 * distance / taps) ** 2)));
    });
    if (phase === 0) norm = kernel.reduce((sum, x) => sum + x, 0);
    return kernel.map(x => x / norm);
  });
  return { taps, center, phases, kernels };
}
