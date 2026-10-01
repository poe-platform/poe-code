import assert from 'node:assert/strict';
import test from 'node:test';
import { RootShellState } from '../../src/shell/runtime.js';
import { InvocationScope } from '../../src/shell/cleanup.js';
import { trackState, stateMonitor } from '../../src/shell/arrays/state.js';

for (const maxCommands of [undefined, Infinity, 1]) {
  test(`internal array accounting honors command ceiling ${maxCommands}`, async () => {
    const scope = new InvocationScope();
    const state = trackState(new RootShellState('/', Object.create(null), new Set(), undefined), {
      limits: { maxExpansionBytes: Infinity, maxExpansionFields: Infinity, ...(maxCommands === undefined ? {} : { maxCommands }) },
    }, scope);
    try {
      const ledger = stateMonitor(state)!.internalOwner().ledger;
      const reserve = () => ledger.reserve({ wrappers: 700_000 });
      if (maxCommands === 1) assert.throws(reserve);
      else reserve().release();
    } finally { await scope.close(); }
  });
}
