import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = new URL('./', import.meta.url);
const build = JSON.parse(readFileSync(new URL('evidence/build.json', base)));
const directory = new URL('.temporary/js/', base); const temporary = new URL('.temporary/', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const removed = [];
const visit = (location, relative = '') => {
  for (const entry of readdirSync(location, { withFileTypes: true })) {
    const path = relative + entry.name; const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), location);
    if (entry.isDirectory()) { visit(target, path + '/'); rmdirSync(target); }
    else {
      assert(entry.isFile(), 'NO_SYMLINK_CLEANUP'); assert.equal(hash(readFileSync(target)), build.built[path], path);
      unlinkSync(target); removed.push(path);
    }
  }
};
visit(directory); rmdirSync(directory); rmdirSync(temporary);
assert.equal(removed.length, Object.keys(build.built).length);
assert(!existsSync(temporary));
writeFileSync(new URL('evidence/cleanup.json', base), JSON.stringify({ utc: new Date().toISOString(), exactOwnedTemporary: fileURLToPath(temporary), removed, removedCount: removed.length, absent: !existsSync(temporary), childAndWorkerCleanupEvidence: 'audit.json and per-scenario raw events; no PID search/process-group kill' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ removed: removed.length, ownedTemporaryAbsent: true }));
