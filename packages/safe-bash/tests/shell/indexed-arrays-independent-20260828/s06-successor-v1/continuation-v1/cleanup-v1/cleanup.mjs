import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { archiveData, archiveHash, indexHash, rawRoot, release, regular, digest } from '../archive-data.mjs';
import { census } from '../../../candidate-v1/boundary-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [action, expected] = process.argv.slice(2);
assert.ok(action === 'prepare' || action === 'remove-approved-duplicates');
const started = performance.now();
const checkpoint = () => assert.ok(performance.now() - started < 120000, 'finite cleanup deadline');
const captured = await archiveData(['FINAL.json'], true, checkpoint);
const final = JSON.parse(captured.values.get('FINAL.json'));
assert.equal(final.accounting.children.length, 349);
assert.ok(final.accounting.children.every(child => child.retired && child.groupAbsent));
const verifyOther = () => {
  checkpoint();
  assert.deepEqual(fs.readdirSync(rawRoot).sort(), ['apps','artifacts','build','records','scratch','source','tools']);
  for (const tree of final.finalCensuses) { checkpoint(); assert.deepEqual(census(tree.root), tree.entries); }
  regular(path.join(release, 'RECORDS.jsonl.gz'), archiveHash);
  regular(path.join(release, 'CAPTURE-INDEX.json'), indexHash);
};
verifyOther();
const records = path.join(rawRoot, 'records');
assert.equal(fs.realpathSync(records), records);
const directory = fs.lstatSync(records);
assert.ok(directory.isDirectory());
const files = captured.rows.map(row => {
  const filename = path.join(records, row.name), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  return { ...row, path: filename, device: stat.dev, inode: stat.ino, links: stat.nlink };
});
const manifest = { action: 'remove-only-437-verified-raw-records', rawRoot, records, archiveHash, indexHash, bytes: 116980358, directory: { device: directory.dev, inode: directory.ino, mode: directory.mode & 0o777 }, files };
const manifestPath = path.join(here, 'DELETE-MANIFEST.json');
if (action === 'prepare') {
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(manifestPath, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, files: files.length, bytes: manifest.bytes, manifestSha256: digest(bytes), removed: 0 }));
} else {
  assert.match(expected ?? '', /^[a-f0-9]{64}$/u);
  assert.deepEqual(JSON.parse(regular(manifestPath, expected)), manifest);
  const journal = fs.openSync(path.join(here, 'DELETE-JOURNAL.jsonl'), 'wx');
  const completed = []; let failure;
  const append = entry => { fs.writeSync(journal, JSON.stringify(entry) + '\n'); fs.fsyncSync(journal); };
  try {
    append({ phase: 'preflight', manifestSha256: expected, files: files.length, bytes: manifest.bytes, archiveVerified: true, otherCensusesVerified: 6 });
    for (const row of files) {
      checkpoint(); assert.equal(fs.realpathSync(records), records);
      const parent = fs.lstatSync(records); assert.equal(parent.dev, manifest.directory.device); assert.equal(parent.ino, manifest.directory.inode);
      const stat = fs.lstatSync(row.path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.nlink, 1);
      assert.equal(stat.dev, row.device); assert.equal(stat.ino, row.inode);
      assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 0o777, row.mode);
      regular(row.path, row.sha256);
      append({ phase: 'before-unlink', path: row.path });
      fs.unlinkSync(row.path);
      completed.push(row);
      append({ phase: 'unlinked', path: row.path, bytes: row.bytes });
    }
    assert.deepEqual(fs.readdirSync(records), []);
    verifyOther();
    const post = { kind: 'approved-duplicate-only-cleanup', manifestSha256: expected, removedFiles: completed.length, removedBytes: completed.reduce((sum, row) => sum + row.bytes, 0), recordsDirectoryRetained: true, remainingRecordNames: [], otherCensusesUnchanged: 6, retainedOtherBytes: 75310015, archiveHash, indexHash, archiveAndIndexUnchanged: true, elapsedMs: performance.now() - started, productExecutions: 0, recursiveDeletes: 0 };
    assert.equal(post.removedFiles, 437); assert.equal(post.removedBytes, 116980358);
    fs.writeFileSync(path.join(here, 'POST.json'), JSON.stringify(post, null, 2) + '\n', { flag: 'wx' });
    append({ phase: 'complete', removedFiles: post.removedFiles, removedBytes: post.removedBytes });
    console.log(JSON.stringify(post));
  } catch (reason) {
    failure = reason;
    append({ phase: 'STOP', reason: String(reason), confirmedUnlinks: completed.length, confirmedBytes: completed.reduce((sum, row) => sum + row.bytes, 0) });
  } finally { fs.closeSync(journal); }
  if (failure) throw failure;
}
