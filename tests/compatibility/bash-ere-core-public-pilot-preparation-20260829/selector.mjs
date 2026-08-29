import assert from 'node:assert/strict';
export const IDS = Object.freeze(['R01', 'R02', 'R05', 'R06', 'R07', 'R11', 'R12', 'R22']);
export function select(rows) {
  assert(Array.isArray(rows));
  return IDS.map(id => {
    const found = rows.filter(row => row.id === id);
    assert.equal(found.length, 1);
    const row = found[0];
    assert.equal(row.route, 'script');
    assert.equal(row.workerStartsMaximum, 1);
    assert.equal(row.expected.stderr.exact, '');
    return structuredClone(row);
  });
}
export function createPilotClock({ started, now }) {
  assert(Number.isSafeInteger(started) && started >= 0 && typeof now === 'function');
  const deadline = started + 1200000;
  assert(Number.isSafeInteger(deadline));
  let last = started;
  let stopped = false;
  return Object.freeze({
    deadline,
    stopUnknown() { stopped = true; },
    admit(caseMilliseconds, cleanupMilliseconds) {
      assert(Number.isSafeInteger(caseMilliseconds) && caseMilliseconds > 0);
      assert(Number.isSafeInteger(cleanupMilliseconds) && cleanupMilliseconds > 0);
      const current = now();
      assert(Number.isSafeInteger(current) && current >= last);
      last = current;
      const required = caseMilliseconds + cleanupMilliseconds + 180000;
      assert(Number.isSafeInteger(required));
      return Object.freeze({ admitted: !stopped && required <= deadline - current, deadline, publicationMilliseconds: 180000 });
    },
  });
}
