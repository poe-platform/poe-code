import type { Diff3Line, Diff3Options } from './contracts.js';
import type { Budget } from './budget.js';
export function bodyLength(line: Diff3Line, options: Diff3Options): number {
  const end = line.bytes.length - Number(line.terminated);
  return end - Number(options.stripTrailingCR === true && line.terminated && end > 0 && line.bytes[end - 1] === 13);
}
export function equalLines(a: Diff3Line, b: Diff3Line, options: Diff3Options, budget: Budget): boolean {
  budget.admit('work', 1);
  const size = bodyLength(a, options);
  if (a.terminated !== b.terminated || size !== bodyLength(b, options)) return false;
  for (let index = 0; index < size; index++) { budget.admit('work', 1); if (a.bytes[index] !== b.bytes[index]) return false; }
  return true;
}
