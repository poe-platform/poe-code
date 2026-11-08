import assert from 'node:assert/strict';
import { startupReservation, observeStartup } from '../startup-policy.mjs';
import { Ledger } from '../../stage-b1-r4/policy.mjs';
export function controls() {
  const results = [];
  const make = caps => ({ outputs: { startupCaptures: caps.map((_, index) => '/private/tmp/owned-startup-' + index) }, startupStreams: caps.map((capBytes, index) => ({ path: '/private/tmp/owned-startup-' + index, capBytes })) });
  const stat = bytes => () => ({ isFile: () => true, isSymbolicLink: () => false, size: bytes });
  const check = (id, operation) => { operation(); results.push({ id, outcome: 'PASS', role: 'PURE_EXACT_HELPER' }); };
  check('S01-zero-streams', () => { const reserve = startupReservation(make([])); assert.equal(reserve.bytes, 0); assert.equal(observeStartup(reserve, stat(0), 0).total, 0); });
  check('S02-one-stream', () => { const reserve = startupReservation(make([4096])); assert.equal(reserve.bytes, 4096); assert.equal(observeStartup(reserve, stat(4096), 4096).remainingReservedBytes, 0); });
  check('S03-four-streams-unique-bound', () => { const binding = make([4096, 4096, 4096, 4096]); const reserve = startupReservation(binding); assert.equal(reserve.bytes, 16384); assert.equal(observeStartup(reserve, stat(4096)).total, 16384); const duplicate = structuredClone(binding); duplicate.startupStreams[1].path = duplicate.startupStreams[0].path; duplicate.outputs.startupCaptures[1] = duplicate.outputs.startupCaptures[0]; assert.throws(() => startupReservation(duplicate), /STARTUP_DUPLICATE/); const alias = make([1]); alias.startupStreams[0].path = '/private/tmp/../tmp/x'; alias.outputs.startupCaptures[0] = alias.startupStreams[0].path; assert.throws(() => startupReservation(alias), /STARTUP_PATH/); });
  check('S04-safeinteger-sum', () => { assert.throws(() => startupReservation(make([Number.MAX_SAFE_INTEGER, 1])), /STARTUP_SUM_OVERFLOW/); assert.throws(() => startupReservation(make([1.5])), /STARTUP_CAP/); });
  check('S05-late-per-stream-overrun', () => { const reserve = startupReservation(make([4096])); assert.equal(observeStartup(reserve, stat(0)).total, 0); assert.throws(() => observeStartup(reserve, stat(4097)), /STARTUP_STREAM_OVERRUN/); });
  check('S06-aggregate-headroom', () => { const reserve = startupReservation(make([4096, 4096, 4096, 4096])); assert.throws(() => observeStartup(reserve, stat(0), 8192), /STARTUP_AGGREGATE_HEADROOM/); assert.equal(observeStartup(reserve, stat(4096), 16384).total, 16384); const shared = new Ledger({ capture: 67108864 - 2097152 - 8192, work: 0 }); const before = shared.snapshot(); assert.equal(before.reserved.capture, 2097152); assert.throws(() => shared.charge(reserve.bytes), error => error.message === 'Prewrite capture refusal'); assert.deepEqual(shared.snapshot(), before); });
  check('D01-constructor-refusal-distinct', () => { assert.throws(() => new Ledger({ capture: 67108864 - 8192, work: 0 }), error => error.message === 'Aggregate capture admission'); });
  check('D02-admitted-charge-boundary', () => { const shared = new Ledger({ capture: 67108864 - 2097152 - 16384, work: 0 }); shared.charge(16384); assert.equal(shared.snapshot().used.capture + shared.snapshot().reserved.capture, 67108864); assert.throws(() => shared.charge(1), error => error.message === 'Prewrite capture refusal'); });
  return results;
}
