import assert from 'node:assert/strict';
import { StateMonitor } from './node_modules/virtual-bash/dist/shell/arrays/state.js';
import { ArrayOwner } from './node_modules/virtual-bash/dist/shell/arrays/ledger.js';

export const candidate = '50117fc54fdfd650e8f57e84b82ba21297ab8a0f';
export const supportedIds = ['O11'];
export async function observeTerminalState(shell, row) {
  assert.equal(row.id, 'O11');
  const activate = StateMonitor.prototype.activate, close = ArrayOwner.prototype.close;
  const monitors = new Set(), roots = new Set(), snapshots = [];
  StateMonitor.prototype.activate = function (...args) {
    const result = Reflect.apply(activate, this, args);
    monitors.add(this); return result;
  };
  ArrayOwner.prototype.close = function (...args) {
    if (!this.parent && !roots.has(this)) {
      roots.add(this);
      for (const monitor of monitors) if (monitor.session.owner === this) {
        const binding = monitor.store?.bindings.get('a');
        if (binding) snapshots.push([...binding.values].map(([index, entry]) => [index, entry.text.value]).sort((left, right) => left[0] - right[0]));
      }
    }
    return Reflect.apply(close, this, args);
  };
  let restored = false;
  const settle = async () => {
    for (const owner of roots) await owner.completion;
    for (const owner of roots) assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0], 'observed integrated root live counters drain');
  };
  return {
    async after() {
      await settle(); assert.equal(roots.size, 1); assert.equal(snapshots.length, 1);
      for (const monitor of monitors) assert.equal(monitor.store.bindings.size, 0);
      process.stdout.write(JSON.stringify({ admission: { kind: 'O11-actual-terminal-observer', roots: roots.size, monitors: monitors.size, snapshots, ledgers: [...roots].map(owner => owner.ledger.snapshot()), scope: 'Only actually activated monitors/root owners; no inactive/private-head completeness claim.' } }) + '\n');
      return snapshots[0];
    },
    async close() {
      if (!restored) { StateMonitor.prototype.activate = activate; ArrayOwner.prototype.close = close; restored = true; }
      await settle();
    }
  };
}
