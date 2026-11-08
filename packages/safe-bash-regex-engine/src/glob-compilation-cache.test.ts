import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EreLedger } from './ere/limits.js';
import { compileEre, tryCompileEreSync } from './ere/syntax.js';
import { globFragments } from './glob.js';

const ledger = () => new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });

test('repeated glob fragments reuse compilation with the same resource accounting', async () => {
  const signal = new AbortController().signal;
  const fragments = await globFragments('*.rs', false, ledger(), signal);
  const cold = ledger();
  const program = await compileEre(fragments, cold, signal);
  const warm = ledger();
  const cached = tryCompileEreSync(fragments, warm, signal);
  assert.ok(cached, 'glob fragment arrays should be eligible for bounded compilation reuse');
  assert.deepEqual(cached, program);
  assert.deepEqual(warm.usage, cold.usage);
  const limited = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, { work: 0 });
  assert.equal(tryCompileEreSync(fragments, limited, signal), undefined);
  await assert.rejects(compileEre(fragments, limited, signal));
  const literal = fragments.map(fragment => ({ ...fragment, literal: true }));
  assert.equal(tryCompileEreSync(literal, ledger(), signal), undefined, 'literal and syntax fragments must have distinct cache keys');
});
