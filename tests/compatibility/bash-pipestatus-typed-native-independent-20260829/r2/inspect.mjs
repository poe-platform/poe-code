import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = '/Users/kjopek/Workspace/safe-bash';
const base = repository + '/tests/compatibility/bash-pipestatus-typed-native-reference-20260829';
const actual = base + '/actual-run-v2';
function read(file) {
  assert.equal(fs.realpathSync(file), file);
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 131072);
  const bytes = fs.readFileSync(file); assert.equal(bytes.length, stat.size); return bytes;
}
const invocationBytes = read(process.argv[2]); assert.equal(hash(invocationBytes), process.argv[3]);
const invocation = JSON.parse(invocationBytes); assert.equal(invocation.schema, 'typed6-r2-invocation-v1');
assert.ok(Number.isSafeInteger(invocation.deadlineMs) && Date.now() < invocation.deadlineMs);
for (const [descriptor, key] of [[1, 'stdout'], [2, 'stderr']]) {
  const file = invocation.inspect[key]; assert.equal(path.dirname(file), invocation.root);
  const actualFd = fs.fstatSync(descriptor), declared = fs.lstatSync(file); assert.ok(actualFd.isFile() && declared.isFile() && !declared.isSymbolicLink()); assert.equal(actualFd.ino, declared.ino); assert.equal(actualFd.dev, declared.dev);
}
const sealBytes = read(actual + '/SEAL.json'); assert.equal(hash(sealBytes), '7a043c0bdc645e6c45d3a193d686e1741fcdb9662a5951dac141a41018937201');
const seal = JSON.parse(sealBytes); const rows = new Map(seal.rows.map(row => [row.path, row]));
function evidence(name) { const row = rows.get(name); assert.ok(row); const bytes = read(actual + '/' + name); assert.equal(bytes.length, row.bytes); assert.equal(fs.lstatSync(actual + '/' + name).mode & 511, row.mode); assert.equal(hash(bytes), row.sha256); return JSON.parse(bytes); }
const preflight = evidence('PREFLIGHT.json');
const sourceRows = preflight.records.filter(row => row.path.startsWith(repository + '/'));
function source(file) { const row = sourceRows.find(item => item.path === file); assert.ok(row, 'source record ' + file); const bytes = read(file); assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256); assert.equal(fs.lstatSync(file).mode & 511, row.mode); return JSON.parse(bytes); }
const executable = source(base + '/materialized/PRESEAL.json');
const requests = source(base + '/materialized/REQUESTS.json');
const approval = source(base + '/activation-v1/APPROVAL-REQUEST.json');
const slot = source(preflight.slotReceipt.path);
const results = evidence('native-artifacts/RESULTS.json.data');
const observations = evidence('OBSERVATIONS.json');
const paths = [...new Set([actual + '/SEAL.json', ...seal.rows.map(row => actual + '/' + row.path), ...sourceRows.map(row => row.path), preflight.slotReceipt.path])].map(file => {
  assert.ok(file.startsWith(repository + '/tests/compatibility/bash-pipestatus-typed-native-')); const relative = path.relative(repository, file); assert.ok(!relative.split('/').includes('..') && !relative.includes('\0')); return relative;
}).sort();
assert.ok(paths.length <= 128);
fs.writeFileSync(invocation.root + '/GIT-PATHS.nul', Buffer.from(paths.join('\0') + '\0'), { flag: 'wx' });
const output = { sourceRecordCount: sourceRows.length, executableFiles: executable.files, sourceRows, requests, approval, slotSummary: { verdict: slot.verdict, packet: slot.packet, executableHash: slot.executableHash, executableMembers: slot.executableMembers, tools: slot.tools, approvalPath: slot.approvalPath, approvalSha256: slot.approvalSha256, commandSha256: slot.commandSha256, window: slot.window, budget: slot.budget }, slotKeys: Object.keys(slot), results, observationKeys: Object.keys(observations), observationsSummary: observations.summary, gitPathCount: paths.length, phase: invocation, pureOnly: true };
fs.writeFileSync(invocation.root + '/INSPECTION.json', JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sourceRecordCount: sourceRows.length, executableMembers: executable.files.length, paths: paths.length, requestFirst: requests[0], approval, slotKeys: Object.keys(slot), resultKeys: Object.keys(results), observationsKeys: Object.keys(observations) }));
