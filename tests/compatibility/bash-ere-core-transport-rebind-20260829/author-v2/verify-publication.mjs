import * as fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const [rootArgument] = process.argv.slice(2);
assert(rootArgument && process.argv.length === 3);
const root = fs.realpathSync(rootArgument);
assert(root.endsWith('/tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v2'));
assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
function read(name) {
  const filename = path.join(root, name), stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 16777216);
  return fs.readFileSync(filename);
}
assert(read('publication-before-index.raw').equals(read('publication-after-index.raw')), 'foreign staging preserved byte-for-byte');
const match = read('publication-commit.stdout').toString().match(/^\[[^\]\n]+ ([a-f0-9]{40})\]/);
assert(match, 'full explicit commit identifier');
const receiptRaw = read('FAILURE-RECEIPT.json'), receipt = JSON.parse(receiptRaw);
let files = 0, bytes = 0, captureBytes = 0, maximumFile = 0;
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    if (stat.isDirectory()) walk(filename);
    else { assert(stat.isFile() && stat.size <= 16777216); files++; bytes += stat.size; maximumFile = Math.max(maximumFile, stat.size); if (/\.(stdout|stderr|log|raw)$/.test(name)) captureBytes += stat.size; }
  }
}
walk(path.dirname(root));
assert(bytes <= receipt.resources.logicalBoundIncludingPublication && captureBytes <= 100663296);
assert(Date.now() < Date.parse(receipt.resources.deadline));
const result = { commit: match[1], receiptSha256: crypto.createHash('sha256').update(receiptRaw).digest('hex'), foreignStagingPreserved: true, knownStartsIncludingThisFinalizer: 35, conservativePeak: 3, at: new Date().toISOString(), observedFiles: files, observedLogicalBytes: bytes, observedCaptureBytes: captureBytes, maximumFileBytes: maximumFile, verdict: 'HOLD_BUILD_TS2688', finalizerClosure: 'Pending tool completion; no child processes launched by finalizer' };
fs.writeFileSync(path.join(root, 'POSTPUBLICATION-RECEIPT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
console.log(JSON.stringify(result));
