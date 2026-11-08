import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const [rootArgument] = process.argv.slice(2);
assert(rootArgument && process.argv.length === 3);
const root = fs.realpathSync(rootArgument);
assert(root.endsWith('/tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3'));
assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
function read(name) { const filename = path.join(root, name), stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16777216); return fs.readFileSync(filename); }
assert(read('final-index-before.raw').equals(read('final-index-after.raw')));
const match = read('final-commit.stdout').toString().match(/^\[[^\]\n]+ ([a-f0-9]{40})\]/); assert(match);
const raw = read('PUBLICATION-RECEIPT.json'), receipt = JSON.parse(raw);
let bytes = 0, files = 0, maximumFile = 0, capture = 0;
function walk(directory) { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name), stat = fs.lstatSync(filename); if (stat.isDirectory()) walk(filename); else { assert(stat.isFile() && stat.size <= 16777216); bytes += stat.size; files++; maximumFile = Math.max(maximumFile, stat.size); if (/\.(stdout|stderr|log|raw)$/.test(name)) capture += stat.size; } } }
walk(path.dirname(root));
assert(bytes < receipt.currentResources.logicalBoundIncludingPublication && capture < 100663296);
assert(Date.now() < Date.parse(receipt.currentResources.deadline));
const result = { at: new Date().toISOString(), producerCommit: receipt.producerCommit, bindingsCommit: match[1], publicationReceiptSha256: crypto.createHash('sha256').update(raw).digest('hex'), foreignStagingPreserved: true, knownStartsIncludingFinalizer: 36, conservativePeak: 3, observedOwnedFiles: files, observedLogicalBytes: bytes, observedCaptureBytes: capture, maximumFileBytes: maximumFile, finalizerClosure: 'Established by subsequent direct tool completion; no subprocesses', actualRuntimeAuthority: false };
fs.writeFileSync(path.join(root, 'POSTPUBLICATION-RECEIPT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
console.log(JSON.stringify(result));
