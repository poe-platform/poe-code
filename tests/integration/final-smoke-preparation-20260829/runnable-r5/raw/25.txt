import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

export const cacheReservationBytes = 134217728;
export function sampleTree(roots, { cacheRoot, active = false, reservationBytes = cacheReservationBytes, maximumBytes = 536870912, maximumEntries = 16384, io = fs } = {}) {
  assert.ok(Number.isSafeInteger(reservationBytes) && reservationBytes >= 0 && reservationBytes <= maximumBytes);
  if (active) { assert.equal(typeof cacheRoot, "string"); assert.equal(path.normalize(cacheRoot), cacheRoot); assert.ok(roots.some(root => cacheRoot.startsWith(root + path.sep))); }
  const rows = []; const races = []; let entries = 0; let bytes = 0; let cacheBytes = 0; let raceCount = 0;
  const descendant = filename => active && filename.startsWith(cacheRoot + path.sep);
  function observe(operation, filename, run) {
    try { return { present: true, value: run() }; }
    catch (error) {
      const code = error !== null && (typeof error === "object" || typeof error === "function") ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
      if (code !== "ENOENT" || !descendant(filename)) throw error;
      raceCount++; if (races.length < 64) races.push(Object.freeze({ kind: "SNAPSHOT_RACE", operation, path: filename, code }));
      return { present: false };
    }
  }
  function visit(filename) {
    assert.ok(++entries <= maximumEntries);
    const observation = observe("lstat", filename, () => io.lstatSync(filename));
    if (!observation.present) return;
    const stat = observation.value;
    if (stat.isDirectory()) {
      const names = observe("readdir", filename, () => io.readdirSync(filename));
      if (names.present) for (const child of names.value.sort()) visit(path.join(filename, child));
    } else {
      assert.ok(stat.isFile() || stat.isSymbolicLink()); assert.ok(Number.isSafeInteger(stat.size) && stat.size >= 0);
      bytes += stat.size; assert.ok(Number.isSafeInteger(bytes) && bytes <= maximumBytes);
      const inCache = cacheRoot && (filename === cacheRoot || filename.startsWith(cacheRoot + path.sep));
      if (inCache) cacheBytes += stat.size;
      rows.push(Object.freeze({ path: filename, bytes: stat.size, symlinkNotFollowed: stat.isSymbolicLink() }));
    }
  }
  for (const root of roots) visit(root);
  if (active) assert.ok(cacheBytes <= reservationBytes, "observed cache exceeds prospective reservation");
  const chargedBytes = active ? bytes - cacheBytes + reservationBytes : bytes;
  assert.ok(chargedBytes <= maximumBytes, "aggregate logical reservation exceeded");
  return Object.freeze({ bytes: chargedBytes, observedBytes: bytes, observedCacheBytes: cacheBytes, reservedCacheBytes: active ? reservationBytes : 0, entries, rows: Object.freeze(rows), snapshotRaceCount: raceCount, races: Object.freeze(races), atomic: false, peakProof: false, cacheBoundSourceProved: false });
}
