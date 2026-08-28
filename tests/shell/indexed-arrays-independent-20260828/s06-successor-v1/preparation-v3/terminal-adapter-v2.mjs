import assert from 'node:assert/strict';
import { StateMonitor } from './node_modules/virtual-bash/dist/shell/arrays/state.js';
import { ArrayOwner } from './node_modules/virtual-bash/dist/shell/arrays/ledger.js';
import { dataField, installTerminalObserver, namedBinding, ownData } from './observer-v2.mjs';

export const candidate = 'c0adae539c736db0e4023d401562ce958d9ebb00';
export const supportedIds = ['O11'];
export async function observeTerminalState(shell, row) {
  assert.equal(row.id, 'O11');
  return installTerminalObserver({
    monitorPrototype: StateMonitor.prototype,
    ownerPrototype: ArrayOwner.prototype,
    ownerFor(monitor) { return dataField(dataField(monitor, 'session'), 'owner'); },
    isRoot(owner) { return dataField(owner, 'parent') === undefined; },
    capture(monitor) {
      const store = dataField(monitor, 'store'), values = dataField(store, 'bindings');
      const named = Map.prototype.get.call(values, 'a');
      return named === undefined ? undefined : namedBinding(named);
    },
    terminal(observation) {
      ownData(observation, ['monitors', 'roots', 'captures']);
      assert.equal(observation.roots.length, 1); assert.equal(observation.captures.length, 1);
      const ledgers = observation.roots.map(owner => owner.ledger.snapshot());
      for (const ledger of ledgers) assert.deepEqual(ledger.used.slice(0, 4), [0, 0, 0, 0]);
      for (const monitor of observation.monitors) assert.equal(monitor.store.bindings.size, 0);
      process.stdout.write(JSON.stringify({ admission: { kind: 'O11-terminal-observer-v2', roots: observation.roots.length, monitors: observation.monitors.length, snapshots: observation.captures, ledgers, scope: 'actually activated monitors and actual forwarded close returns only' } }) + '\n');
      return observation.captures[0];
    }
  });
}
