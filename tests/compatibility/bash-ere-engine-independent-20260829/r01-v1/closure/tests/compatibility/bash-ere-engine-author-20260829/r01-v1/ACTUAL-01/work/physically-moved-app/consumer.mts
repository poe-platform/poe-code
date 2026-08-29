import { EreLedger, deriveEreLimits } from './artifact/limits.js';
import { compileEre } from './artifact/syntax.js';
import { matchEre } from './artifact/matcher.js';
import { EreProfileLimitError } from './artifact/errors.js';
import type { EreResult, EreFragment } from './artifact/types.js';

const limits = deriveEreLimits({ maxExpansionBytes: 1000, maxExpansionFields: 100 });
const ledger = new EreLedger({ maxExpansionBytes: 1000, maxExpansionFields: 100 }, { work: 200 });
const fragments: readonly EreFragment[] = [{ text: '.', literal: true }];
const compiled = await compileEre(fragments, ledger);
const result: EreResult = await matchEre(compiled, '.', ledger);
if (result.matched) {
  const value: string | undefined = result.values[0];
  void value;
}
const resource: number = limits.work;
const status: 3 = new EreProfileLimitError('work', resource).status;
void status;
