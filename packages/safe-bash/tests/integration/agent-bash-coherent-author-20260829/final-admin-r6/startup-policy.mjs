import path from 'node:path';
import assert from 'node:assert/strict';

function ownData(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'STARTUP_RECORD');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), 'STARTUP_KEYS');
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); assert(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'STARTUP_DATA'); }
}
export function startupReservation(binding) {
  const paths = binding.outputs.startupCaptures, records = binding.startupStreams;
  assert(Array.isArray(paths) && Array.isArray(records) && paths.length <= 16 && records.length === paths.length, 'STARTUP_LIST');
  const seen = new Set(); let total = 0;
  for (let index = 0; index < records.length; index++) {
    const record = records[index]; ownData(record, ['path', 'capBytes']);
    assert(typeof record.path === 'string' && path.isAbsolute(record.path) && path.normalize(record.path) === record.path && !record.path.includes('\0'), 'STARTUP_PATH');
    assert.equal(record.path, paths[index], 'STARTUP_BOUND_ORDER'); assert(!seen.has(record.path), 'STARTUP_DUPLICATE'); seen.add(record.path);
    assert(Number.isSafeInteger(record.capBytes) && record.capBytes >= 0, 'STARTUP_CAP');
    assert(Number.isSafeInteger(total + record.capBytes), 'STARTUP_SUM_OVERFLOW'); total += record.capBytes;
  }
  return Object.freeze({ streams: Object.freeze(records.map(record => Object.freeze({ ...record }))), bytes: total });
}
export function observeStartup(reservation, stat, captureHeadroom = 67108864) {
  assert(Number.isSafeInteger(captureHeadroom) && captureHeadroom >= 0 && reservation.bytes <= captureHeadroom, 'STARTUP_AGGREGATE_HEADROOM');
  let total = 0;
  const streams = reservation.streams.map(entry => {
    const observed = stat(entry.path);
    assert(observed.isFile() && !observed.isSymbolicLink() && Number.isSafeInteger(observed.size) && observed.size >= 0 && observed.size <= entry.capBytes, 'STARTUP_STREAM_OVERRUN');
    assert(Number.isSafeInteger(total + observed.size), 'STARTUP_OBSERVED_OVERFLOW'); total += observed.size;
    return { path: entry.path, bytes: observed.size, prechargedCeiling: entry.capBytes, liveAfterCensus: true };
  });
  assert(total <= reservation.bytes && total <= captureHeadroom, 'STARTUP_TOTAL_OVERRUN');
  return { total, streams, reservedBytes: reservation.bytes, remainingReservedBytes: reservation.bytes - total };
}
