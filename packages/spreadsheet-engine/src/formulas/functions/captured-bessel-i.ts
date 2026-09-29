import { capturedExp, fusedMultiplyAdd } from "./numeric-arithmetic.js";
import type { FunctionHost } from "./types.js";

/** Olver's P-sequence/backward normalization for positive unscaled I0.
 * Original scalar implementation of the mathematical recurrence qualified
 * against the pinned Cody/Stoltz profile in Gnumeric src/sf-bessel.c. */
export function capturedBesselI0(x: number, host: FunctionHost): number {
  const integerX = Math.trunc(x);
  let n = integerX + 1, en = 2 * n, previous = 1, p = en / x;
  const test = integerX * 2 > 80 ? Math.sqrt(2e16 * p) : 2e16 / 1.585 ** integerX;
  do {
    host.tick(); n++; en += 2; const old = previous; previous = p; p = en * previous / x + old;
  } while (p < test);
  n++; en += 2;
  let higher = 0, current = 1 / p, em = n - 1, empal = em, emp2al = em - 1;
  let normalization = current * empal * emp2al / em;
  const steps = n - 1;
  for (let step = 1; step <= steps; step++) {
    host.tick(); n--; en -= 2;
    let nextHigher = higher; higher = current;
    if (steps > 100 && current > 1e200) { nextHigher *= 2 ** -900; higher *= 2 ** -900; normalization *= 2 ** -900; }
    current = en * higher / x + nextHigher;
    em--; emp2al--;
    if (n === 1) break;
    if (n === 2) emp2al = 1;
    empal--;
    normalization = fusedMultiplyAdd(current, empal, normalization) * emp2al / em;
  }
  normalization = normalization + normalization + current;
  normalization *= capturedExp(-x);
  const minimum = normalization > 1 ? 8.9e-308 * normalization : 8.9e-308;
  return current < minimum ? 0 : current / normalization;
}
