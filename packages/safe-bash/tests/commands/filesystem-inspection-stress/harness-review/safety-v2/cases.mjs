import assert from 'node:assert/strict';
import { verifySeal as originalSeal } from '../safety-v1/seal.mjs';

export const caseIds = ['T-DP-cumulative', 'T-sort-many'];
export function buildCases() {
  const original = originalSeal();
  return caseIds.map(id => {
    const entry = structuredClone(original.cases.find(value => value.id === id));
    assert(entry);
    if (id === 'T-DP-cumulative') entry.limits.maxSteps = 16384;
    entry.expected = {
      ...entry.expected,
      mode: 'tree-shell-work-limit',
      exitCode: 1,
      stderr: 'meaningful bounded tree work-limit diagnostic through actual Shell',
      listing: id === 'T-DP-cumulative'
        ? { next: 4, yielded: 4, done: false, returned: 1 }
        : { next: 65, yielded: 64, done: true, returned: 0 },
      qualification: id === 'T-DP-cumulative'
        ? 'Derived budget16384 admits singleton4573; fourth filter exceeds cumulative work before listing exhaustion/sort. Require exact four-entry partial iterator trace plus independently reviewed frozen static proof; no per-entry reset or later-sort substitution.'
        : 'Same512-byte names and4096 budget; require exhausted64-entry listing, no child stat/output and meaningful Shell work-limit status1. Frozen proof identifies fourth name comparison admission; dirsfirst metering is static only.',
    };
    return entry;
  });
}
