import assert from 'node:assert/strict';

export function controlledClock({ initial = 0, handles = [] } = {}) {
  let sample = initial, nextHandle = 0, peak = 0;
  const records = [], rows = [], pending = new Set();
  const receiver = {
    now() { assert.equal(this, receiver); records.push({ event: 'now', value: sample }); if (sample instanceof Error) throw sample; return sample; },
    setTimeout(callback, milliseconds) {
      assert.equal(this, receiver); assert.equal(typeof callback, 'function');
      assert.ok(Number.isInteger(milliseconds) && milliseconds >= 1 && milliseconds <= 2147483647);
      assert.equal(pending.size, 0, 'more than one live scheduler handle');
      const handle = nextHandle < handles.length ? handles[nextHandle] : Object.freeze({ ordinal: nextHandle });
      const row = { ordinal: nextHandle++, handle, callback, milliseconds, offered: false, cleared: false };
      rows.push(row); pending.add(row); peak = Math.max(peak, pending.size);
      records.push({ event: 'arm', ordinal: row.ordinal, milliseconds, handle }); return handle;
    },
    clearTimeout(handle) {
      assert.equal(this, receiver);
      const row = rows.findLast(item => Object.is(item.handle, handle) && !item.cleared);
      assert.ok(row, 'unknown or already cleared handle');
      row.cleared = true; pending.delete(row); records.push({ event: 'clear', ordinal: row.ordinal, handle });
    },
  };
  return {
    scheduler: receiver, records, rows,
    sample(value) { sample = value; },
    async wake(ordinal, value) {
      const row = rows[ordinal]; assert.ok(row); assert.equal(row.offered, false, 'trusted scheduler offers each callback at most once');
      sample = value; row.offered = true; pending.delete(row);
      records.push({ event: 'offer', ordinal, value, staleAfterClear: row.cleared });
      await Promise.resolve(); row.callback(); await Promise.resolve();
    },
    get live() { return pending.size; }, get peak() { return peak; },
  };
}
