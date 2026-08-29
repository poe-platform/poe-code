import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.dirname(new URL(import.meta.url).pathname);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plan = JSON.parse(fs.readFileSync(root + '/ROLE-PLAN.json', 'utf8'));
assert(Date.now() < Date.parse(plan.deadline));
const evidence = root + '/supervision';
fs.mkdirSync(evidence);
let captureBytes = 0;
const captureRows = [];
function copy(source, target) {
  const stat = fs.lstatSync(source);
  assert(!stat.isSymbolicLink());
  if (stat.isDirectory()) {
    fs.mkdirSync(target);
    for (const name of fs.readdirSync(source).sort()) copy(source + '/' + name, target + '/' + name);
    return;
  }
  assert(stat.isFile() && stat.size <= 4194304);
  const bytes = fs.readFileSync(source);
  assert.equal(bytes.length, stat.size);
  captureBytes += bytes.length;
  assert(captureBytes <= 16777216);
  fs.writeFileSync(target, bytes, {flag: 'wx', mode: 0o600});
  captureRows.push({source, path: path.relative(root, target), bytes: bytes.length, sha256: hash(bytes)});
}
for (const name of fs.readdirSync('/tmp').sort()) {
  if (!name.startsWith('pipestatus-typed-review-')) continue;
  if (name.startsWith('pipestatus-typed-review-accounting') || name.startsWith('pipestatus-typed-review-publish')) continue;
  copy('/tmp/' + name, evidence + '/' + name);
}
const rows = [];
let bytes = 0;
function walk(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const file = directory + '/' + name, stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) walk(file);
    else {
      assert(stat.isFile() && stat.size <= 4194304);
      const data = fs.readFileSync(file);
      assert.equal(data.length, stat.size);
      bytes += data.length;
      assert(bytes < plan.grant.work);
      rows.push({path: path.relative(root, file), mode: stat.mode & 0o777, bytes: data.length, sha256: hash(data)});
    }
  }
}
walk(root);
rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
const snapshot = {at: new Date().toISOString(), domain: 'all current owned regular files recursively, UTF-8 byte path order; excludes this subsequently written snapshot and later publication outputs', files: rows.length, bytes, rows, captureBytes, captureRows, knownRolesBeforeThisHelper: 15, thisHelper: 1, publicationReservedRoles: 4, plannedFinalKnownRoles: 20, observedPeak: 2, noGlobalOrTransitiveCensusClaim: true, activeAccountingCaptureAndFuturePublicationNotTerminallySampled: true};
fs.writeFileSync(root + '/FULL-OWNED-SNAPSHOT.json', JSON.stringify(snapshot, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const message = JSON.stringify({at: snapshot.at, files: rows.length, bytes, captureBytes, knownThroughHelper: 16, finalPlanned: 20});
fs.writeSync(1, message + '\n');
fs.writeSync(3, message + '\n');
