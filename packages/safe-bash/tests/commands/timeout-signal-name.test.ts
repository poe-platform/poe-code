import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignal, signalName } from '../../src/commands/timeout/signal.js';

test('virtual signal names round-trip independently of native host catalogs', () => {
  assert.equal(signalName(15),'TERM');
  assert.equal(signalName(0),undefined);
  for (const signal of [...Array.from({length:31},(_,index) => index+1),...Array.from({length:31},(_,index) => index+34)]) {
    assert.equal(parseSignal(signalName(signal)!),signal);
  }
  for (const signal of [-1,32,33,65,1.5,NaN]) assert.equal(signalName(signal),undefined);
});
