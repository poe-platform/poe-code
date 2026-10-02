// Paired operations adapted from goffice go-quad.c by Morten Welinder,
// under GNU GPL version 2 or, at your option, version 3, without warranty.
// The package LICENSE contains the GPL version 2 terms used for this adaptation.
import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { capturedTrig } from "./captured-trigonometry.js";
import type { FunctionHost } from "./types.js";

import { add, subtract, product, multiply, divide, type Pair } from "./captured-quad.js";
const pi: Pair = [Math.PI, 1.2246467991473532e-16];
const piParts = [Math.PI, 1.2246467991473525e-16, 7.096094005475149e-32,
  2.337498945872879e-47, 1.6964756225906639e-62, 2.3330058546990757e-78,
  4.1561276376542085e-94, 1.7472360971449637e-109, 4.601452500437483e-125, 1.752534108156407e-140];
function reduce(a: Pair, host: FunctionHost): readonly [Pair, number] {
  if (a[0] < 0) { const [r, k] = reduce([-a[0], -a[1]], host); return [[-r[0], -r[1]], (-k) & 7]; }
  if (a[0] > 1 / Number.EPSILON) host.diagnostic?.({ code: "numeric-warning", severity: "warning", message: "Reduced accuracy for very large trigonometric arguments" });
  const q = add(multiply(divide(a, pi), [4, 0]), [.5, 0]);
  // go_quad_floor floors both parts before correcting by at most one. Rounding
  // the pair to binary64 first can discard the fraction that chooses the turn.
  let rounded = add([Math.floor(q[0]), 0], [Math.floor(q[1]), 0]);
  const remainder = subtract(q, rounded);
  if (remainder[0] + remainder[1] < 0) rounded = subtract(rounded, [1, 0]);
  else {
    const excess = subtract(remainder, [1, 0]);
    if (!(excess[0] + excess[1] < 0)) rounded = add(rounded, [1, 0]);
  }
  const k = rounded[0] + rounded[1];
  let result = a;
  for (const part of piParts) result = subtract(result, product(part, k / 4));
  return [result, k % 8];
}

export function besselPhaseDomain(x: number, order: number): boolean {
  const n = Math.abs(order);
  if (n < 2) return x > 1000000;
  return n < x / (x < 20 ? 5 : x < 30 ? 3 : x < 50 ? 2 : x < 100 ? 1.5 : x < 250 ? 1.2 : 1.1);
}

/** Released amplitude and paired phase recurrence, including accuracy warnings. */
export function capturedBesselPhase(x: number, order: number, secondKind: boolean, host: FunctionHost): number {
  let sum = 1, term = 1;
  const x2 = x * x, n2 = order * order;
  const inverse = divide([1, 0], product(x, x)), square = product(order, order);
  // The source's paired inverse is NaN after square overflow, and every later
  // phase term stays NaN. Preserve that result without its 399 wasted steps.
  if (!Number.isFinite(x2) || !Number.isFinite(n2) || !Number.isFinite(inverse[0] + inverse[1]) || !Number.isFinite(square[0] + square[1])) {
    if (x > 1 / Number.EPSILON) host.diagnostic?.({ code: "numeric-warning", severity: "warning", message: "Reduced accuracy for very large trigonometric arguments" });
    return NaN;
  }
  for (let n = 1; n < 400; n++) {
    host.tick(); const half = n - .5, ratio = fusedMultiplyAdd(-half, half, n2) * (half / n) / x2;
    if (Math.abs(ratio) > 1) break;
    term *= ratio; sum += term;
    if (Math.abs(term) < Number.EPSILON * Math.abs(sum)) break;
  }
  const amplitude = Math.sqrt(sum / (x * (Math.PI / 2)));
  const t: Pair[] = [[1, 0]], s: Pair[] = [[1, 0]];
  let phase: Pair = [0, 0], last = Number.MAX_VALUE;
  for (let n = 1; n < 400; n++) {
    host.tick(); const half: Pair = [n - .5, 0], f = divide(multiply(subtract(square, multiply(half, half)), half), [n, 0]);
    t[n] = multiply(multiply(t[n - 1]!, f), inverse);
    let coefficient: Pair = [0, 0];
    for (let j = 1; j <= n; j++) { host.tick(); coefficient = subtract(coefficient, multiply(t[j]!, s[n - j]!)); }
    s[n] = coefficient;
    const contribution = divide(coefficient, [1 - 2 * n, 0]), magnitude = Math.abs(t[n]![0] + t[n]![1]);
    if (magnitude > last) break;
    last = magnitude; phase = add(phase, contribution);
    // Include equality so exact-zero series and underflowed tails terminate
    // even when the scaled precision threshold has itself underflowed to zero.
    if (Math.abs(contribution[0] + contribution[1]) <= Number.EPSILON ** 2 * Math.abs(phase[0] + phase[1])) break;
  }
  phase = multiply([x, 0], phase);
  const [remainder, quadrant] = reduce([x, 0], host);
  phase = add(phase, remainder);
  const twice = -2 * order, nearest = Math.round(twice), integer = twice - nearest === -.5 && nearest % 2 ? nearest - 1 : nearest;
  phase = add(phase, multiply([(twice - integer) / 4, 0], pi));
  const [reduced, shift] = reduce(phase, host), k = (quadrant - 1 + integer % 8 + shift + (secondKind ? 6 : 0)) & 7;
  const angle = reduced[0] + reduced[1], c = capturedTrig(angle, true), sine = capturedTrig(angle, false), h = .7071067811865476;
  const value = [c, (c - sine) * h, -sine, (c + sine) * -h, -c, (sine - c) * h, sine, (c + sine) * h][k]!;
  return amplitude * value;
}
