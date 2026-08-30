import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export const TOTAL_MS = 6600000;
export function deadline(totalMs = TOTAL_MS, now = () => performance.now(), origin = 0) {
  assert.ok(Number.isFinite(origin) && origin >= 0);
  assert.ok(Number.isSafeInteger(totalMs) && totalMs > 0);
  const end = origin + totalMs;
  const elapsed = () => now() - origin;
  function check(phase, reserve = 0) {
    assert.ok(Number.isSafeInteger(reserve) && reserve >= 0);
    const current = now(); assert.ok(Number.isFinite(current) && current >= origin, 'monotonic finite clock');
    if (current + reserve >= end) throw Object.assign(new Error(`total deadline exceeded: ${phase}`), { code: 'REVIEW_DEADLINE', phase });
    return current;
  }
  async function wait(value, phase) {
    let timer;
    const pending = Promise.resolve(value);
    try {
      check(`${phase}:wait-start`);
      return await Promise.race([
        pending.then(result => { check(`${phase}:settled`); return result; }),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`total deadline exceeded: ${phase}`), { code: 'REVIEW_DEADLINE', phase })), Math.max(0, end - now())); })
      ]);
    } finally { clearTimeout(timer); pending.catch(() => undefined); }
  }
  return Object.freeze({ end, totalMs, elapsed, remaining: () => end - now(), check, wait });
}
