import type { ExecutionMeter } from "./execution-budget.js";

const encoder = new TextEncoder();

function diagnosticBytes(name: string, meter?: ExecutionMeter): Uint8Array | undefined {
  meter?.checkpoint(name.length + 1);
  for (const character of name) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return undefined;
  }
  // Reserve the maximum UTF-8 output for this many UTF-16 code units before
  // invoking the host encoder. No replacement of unpaired surrogates is allowed.
  meter?.checkpoint(name.length + 1, name.length * 3);
  return encoder.encode(name);
}

function editCost(left: Uint8Array, right: Uint8Array, limit: number, row: Uint32Array, meter?: ExecutionMeter): number {
  let start = 0, leftEnd = left.length, rightEnd = right.length;
  while (start < leftEnd && start < rightEnd && left[start] === right[start]) {
    meter?.checkpoint(); start++;
  }
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    meter?.checkpoint(); leftEnd--; rightEnd--;
  }
  const width = leftEnd - start, height = rightEnd - start;
  if (!width || !height) return (width + height) * 2;
  if (width > 40 || height > 40 || Math.abs(width - height) * 2 > limit) return limit + 1;
  meter?.checkpoint(width + 1);
  for (let column = 0; column <= width; column++) row[column] = column * 2;
  for (let index = 1; index <= height; index++) {
    let diagonal = row[0], minimum = Infinity;
    row[0] = index * 2;
    const b = right[start + index - 1];
    for (let column = 1; column <= width; column++) {
      meter?.checkpoint();
      const a = left[start + column - 1];
      const lowerA = a >= 65 && a <= 90 ? a + 32 : a;
      const lowerB = b >= 65 && b <= 90 ? b + 32 : b;
      const substitution = a === b ? 0 : lowerA === lowerB ? 1 : 2;
      const previous = row[column];
      row[column] = Math.min(diagonal + substitution, previous + 2, row[column - 1] + 2);
      diagonal = previous;
      minimum = Math.min(minimum, row[column]);
    }
    if (minimum > limit) return limit + 1;
  }
  return row[width];
}

/** CPython-style diagnostic suggestions: weighted UTF-8 byte edit distance,
 * bounded candidate count/workspace, and first-candidate tie breaking. Invalid
 * surrogate text suppresses suggestions, preserving the caller's primary error.
 * Resource-limit failures are not swallowed as optional diagnostic failures.
 */
export function suggestName(name: string, candidates: readonly string[], meter?: ExecutionMeter): string | undefined {
  meter?.checkpoint();
  if (candidates.length === 0 || candidates.length >= 750) return undefined;
  const target = diagnosticBytes(name, meter);
  if (target === undefined) return undefined;
  meter?.checkpoint(1, 41 * Uint32Array.BYTES_PER_ELEMENT);
  const row = new Uint32Array(41);
  let bestCost = Infinity, best: string | undefined;
  for (const candidate of candidates) {
    meter?.checkpoint(candidate.length + 1);
    if (candidate === name) continue;
    const bytes = diagnosticBytes(candidate, meter);
    if (bytes === undefined) return undefined;
    const threshold = Math.min(Math.floor((target.length + bytes.length + 3) / 3), bestCost - 1);
    const cost = editCost(target, bytes, threshold, row, meter);
    if (cost <= threshold) { bestCost = cost; best = candidate; }
  }
  return best;
}
