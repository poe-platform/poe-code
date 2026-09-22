import { Diff3Error } from './contracts.js';

/** Preserve default GNU admission, rather than implicitly enabling --minimal. */
export function assertAlignmentCost(cost: number, diagonals: number): void {
  const cutoff = Math.max(4096, 2 ** (Math.floor(Math.log2(diagonals) / 2) + 1));
  if (cost >= cutoff) throw new Diff3Error('ALIGNMENT', 'GNU costly-search shortcut is outside the qualified alignment profile');
}
