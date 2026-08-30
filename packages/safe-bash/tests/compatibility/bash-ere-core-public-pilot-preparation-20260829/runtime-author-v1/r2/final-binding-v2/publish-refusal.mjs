import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const directory = path.resolve('tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2/final-binding-v2');
const monotonic = () => Number(process.hrtime.bigint() / 1000000n);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (filename, cap = 1048576) => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
const assertPublicationTime = () => {
  assert(Date.now() < Date.parse('2026-08-29T17:41:59.169Z'));
  assert(monotonic() < 268731292);
};
assertPublicationTime();
const actual = JSON.parse(read(path.join(directory, 'ACTUAL-RECEIPT.json')));
assert.equal(actual.status, 'REFUSED');
assert.equal(actual.coordinatorLaunched, false);
assert.equal(actual.attemptConsumed, true);
assert.equal(actual.outerStarted, 267531292);
const pins = [
  ['PENDING-GRANT.json', 667, '1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf'],
  ['RESOLVED-COMMAND.txt', 995, '47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721'],
];
for (const [filename, size, sha256] of pins) {
  const bytes = read(path.join(directory, filename), size);
  assert.equal(bytes.length, size);
  assert.equal(digest(bytes), sha256);
}
const launch = JSON.parse(read(path.join(directory, 'RESOLVED-LAUNCH.json')));
const profileBytes = read(launch.argv[1]);
assert.equal(digest(profileBytes), 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05');
const profile = JSON.parse(profileBytes);
const binding = JSON.parse(read(path.join(directory, 'BINDING-RECEIPT.json')));
assert.equal(binding.unusedSlots.length, 76);
for (const filename of binding.unusedSlots) assert(!fs.existsSync(filename), filename);
let authenticatedPins = 0;
for (const row of [...profile.assets, ...profile.tools, profile.archive]) {
  const stat = fs.lstatSync(row.path);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, row.size);
  if (row.mode !== undefined) assert.equal(stat.mode & 0o777, row.mode);
  const descriptor = fs.openSync(row.path, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(65536);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino);
    assert.equal(opened.dev, stat.dev);
    let count;
    while ((count = fs.readSync(descriptor, buffer))) hash.update(buffer.subarray(0, count));
  } finally {
    fs.closeSync(descriptor);
  }
  assert.equal(hash.digest('hex'), row.sha256, row.path);
  authenticatedPins++;
}
const review = read(path.resolve('tests/compatibility/bash-ere-core-public-pilot-independent-20260829/runtime-review-r2/RESULT.json'));
assert.equal(digest(review), 'f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b');
const evidence = [];
for (const filename of ['actual-owner.mjs', 'ATTEMPT.json', 'ACTUAL-RECEIPT.json', 'actual-owner.stdout', 'actual-owner.stderr', 'ACTUAL-HANDOFF.md', 'publish-refusal.mjs']) {
  const bytes = read(path.join(directory, filename));
  evidence.push({ filename, size: bytes.length, sha256: digest(bytes) });
}
const directoryBytes = fs.readdirSync(directory).reduce((total, filename) => {
  const stat = fs.lstatSync(path.join(directory, filename));
  assert(stat.isFile() && !stat.isSymbolicLink());
  return total + stat.size;
}, 0);
assertPublicationTime();
const result = {
  status: 'REFUSED_SINGLE_ATTEMPT_CONSUMED',
  publicationUtc: new Date().toISOString(),
  publicationMonotonic: monotonic(),
  frozenOuterStarted: 267531292,
  remainingIncludingPublicationMs: 268731292 - monotonic(),
  latenessMs: Date.parse(actual.startedUtc) - Date.parse('2026-08-29T17:26:59.169Z'),
  coordinatorLaunches: 0, nativeInstallLaunches: 0, cellLaunches: 0, workerStarts: 0,
  cells: { total: 24, pass: 0, fail: 0, unrun: 24 },
  unusedActivationSlots: 76,
  postRefusalAuthenticatedPins: authenticatedPins,
  completeLayoutReadmission: 'NOT_RUN: refused at first clock check',
  declaredHashVsVerified: 'Outer receipt command hash was declarative; this publication verifies exact command bytes after refusal.',
  startupCaptureQualification: 'Shell opened owner FD1/FD2 before Node startup; reserved trusted startup captures postchecked, not prewrite-enforced for owner startup.',
  directoryBytesBeforePublicationReceipt: directoryBytes,
  logicalWorkQualification: 'Only this owned binding directory changed; no runtime root/install/cache created. This is a quiescent directory sample, not OS quota, atomic peak, or native/prewrite work proof. Git physical storage excluded.',
  evidence,
};
const output = Buffer.from(JSON.stringify(result, null, 2) + '\n');
assert(output.length <= 65536 && directoryBytes + output.length <= 1048576);
fs.writeFileSync(path.join(directory, 'PUBLICATION-RECEIPT.json'), output, { flag: 'wx', mode: 0o600 });
console.log(output.toString('utf8'));
