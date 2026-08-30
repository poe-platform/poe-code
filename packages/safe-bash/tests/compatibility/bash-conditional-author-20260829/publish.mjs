import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const preparation = JSON.parse(fs.readFileSync(path.join(own, 'PREP.json'))).root;
const log = { started: new Date().toISOString(), role: 'BOUNDED_ARTIFACT_PUBLICATION_NO_PRODUCT', product: 0, children: 0 };
const record = fs.openSync(path.join(preparation, 'publication-final.json'), 'wx');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const roots = [
    ['prep', preparation],
    ['v1-outer', '/tmp/bash-conditional-launch-HtdX7b'], ['v1-run', '/tmp/conditional-author-CnHXwl'],
    ['v2-outer', '/tmp/bash-conditional-launch-TNHiRC'], ['v2-run', '/tmp/conditional-author-yLl1MG'],
    ['v3-outer', '/tmp/bash-conditional-launch-0WtGxc'], ['v3-run', '/tmp/conditional-author-fhvyDt'],
  ];
  const entries = []; let total = 0;
  for (const [label, root] of roots) {
    for (const name of fs.readdirSync(root).sort()) {
      assert.notEqual(name.toLowerCase(), 'agents.md');
      const file = path.join(root, name), stat = fs.lstatSync(file); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory() || file === path.join(preparation, 'publication-final.json')) continue;
      assert.ok(stat.isFile() && stat.size <= 16 * 1024 * 1024); total += stat.size; assert.ok(total <= 64 * 1024 * 1024);
      const bytes = fs.readFileSync(file); entries.push({ path: label + '/' + name, mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') });
    }
  }
  const result = JSON.parse(fs.readFileSync('/tmp/conditional-author-fhvyDt/RESULT.json'));
  assert.equal(result.source.computedTree, '501ad98748e639c909f717007dac4f1da19c67dc');
  assert.equal(result.package.sha256, '4df8658746a881fd1316e403a234fd941baccfdead7a9518bc39fa7f6df2bb6e');
  assert.equal(result.package.members.length, 954);
  assert.equal(result.failures.length, 3);
  assert.ok(result.failures.every(row => row.cases.length === 1 && row.cases[0].id === 'H02'));
  assert.ok(result.children.every(row => row.closed && row.signal === null && row.signals.length === 0));
  const archive = gzipSync(Buffer.from(JSON.stringify({ schema: 'conditional-author-raw-v1', roots, entries })));
  const recovered = JSON.parse(gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 }));
  assert.equal(recovered.entries.length, entries.length);
  for (const entry of recovered.entries) { const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(bytes.length, entry.bytes); assert.equal(sha(bytes), entry.sha256); }
  const output = path.join(own, 'results-v3'); fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'RAW.json.gz'), archive, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  const inventory = entries.map(({ base64, ...entry }) => entry);
  fs.writeFileSync(path.join(output, 'CAPTURE-INVENTORY.json'), JSON.stringify(inventory, null, 2), { flag: 'wx' });
  const data = { candidate: result.source.computedTree, sourceCommit: '6fde455bcc103117a6424b95156b152721f5735f', sourceInputs: result.source.inputs.length, pack: { sha256: result.package.sha256, bytes: result.package.bytes, members: result.package.members.length }, cohortPass: result.cohorts.reduce((count, row) => count + row.pass, 0), cohortCases: result.cohorts.reduce((count, row) => count + (Array.isArray(row.cases) ? row.cases.length : row.cases), 0), mainProfile: '750/753 plus3/3 restored controls, not all-pass', authorConditional: '49/50 per layout; H02 unchanged failure', native: 0, types: result.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, diagnostics: row.errors.length })), controls: result.controls, cleanup: result.cleanup, roots, captureRecords: entries.length, rawBytes: total, archiveBytes: archive.length, archiveSha256: sha(archive), qualification: 'Unenrolled metadata-finalizer settlement assertion remains failed; no resource-leak inference or hard cleanup guarantee. V1 compiler/V2 import and obsolete assertion retained. Source/install/move only; not native/global acceptance.' };
  fs.writeFileSync(path.join(output, 'SUMMARY.json'), JSON.stringify(data, null, 2), { flag: 'wx' });
  Object.assign(log, { finished: new Date().toISOString(), records: entries.length, rawBytes: total, archiveBytes: archive.length, archiveSha256: sha(archive), sourceInputs: data.sourceInputs, pack: data.pack });
} catch (error) { log.error = String(error?.stack ?? error); process.exitCode = 1; }
finally { fs.writeSync(record, JSON.stringify(log, null, 2)); fs.closeSync(record); }
console.log(JSON.stringify(log));
