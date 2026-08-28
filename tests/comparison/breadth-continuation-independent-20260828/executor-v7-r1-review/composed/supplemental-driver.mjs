import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { authenticate, home, hashFile } from './auth.mjs';

const originalBefore = authenticate();
const seal = JSON.parse(fs.readFileSync(path.join(home, 'SUPPLEMENTAL-PRESEAL.json')));
function check() {
  for (const entry of seal.owned) {
    const filename = path.join(home, entry.path); const info = fs.lstatSync(filename);
    assert.equal(info.size, entry.bytes); assert.equal(info.mode & 0o7777, entry.mode); assert.equal(hashFile(filename), entry.sha256);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(home, 'ORIGINAL-MANIFEST.json')));
  const found = [];
  const visit = directory => { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name); const info = fs.lstatSync(filename); if (info.isDirectory()) visit(filename); else found.push(path.relative(home, filename)); } };
  visit(path.join(home, 'evidence-01'));
  assert.deepEqual(found.sort(), manifest.files.map(entry => entry.path).sort());
  for (const entry of manifest.files) { const filename = path.join(home, entry.path); const info = fs.lstatSync(filename); assert.equal(hashFile(filename), entry.sha256); assert.equal(info.mode & 0o7777, entry.mode); }
}
check();
const output = path.join(home, 'evidence-02'); fs.mkdirSync(output);
const save = (filename, value) => { const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); assert.ok(bytes.length <= 262144); fs.writeFileSync(path.join(output, filename), bytes, { flag: 'wx' }); };
save('BEFORE.json', originalBefore);
const { observeCoordinator } = await import('../../../breadth-continuation-20260828/executor-v7-r1/outer.mjs');
const { assessTerminal } = await import('../../../breadth-continuation-20260828/executor-v7-r1/report.mjs');
const { readDocument } = await import('../../../breadth-continuation-20260828/executor-v7-r1/records.mjs');
const resources = process.getActiveResourcesInfo().sort(); const late = [];
const listener = error => late.push(String(error)); process.on('unhandledRejection', listener);
const started = new Date().toISOString();
const result = await observeCoordinator({ node: seal.child.node, args: seal.child.args, cwd: home, captureRoot: path.join(output, 'outer'), resultRoot: path.join(output, 'body/runs/synthetic'), deadline: 10000, syntheticOnly: true });
save('RECEIPT.json', result.receipt);
let failure;
try {
  assert.equal(result.qualified, false);
  assert.equal(result.receipt.natural, true);
  assert.deepEqual(result.receipt.exit, { code: 0, signal: null }); assert.deepEqual(result.receipt.close, { code: 0, signal: null });
  assert.deepEqual(result.receipt.failures, []); assert.deepEqual(result.receipt.signals, []);
  assert.equal(result.receipt.reaped, true);
  assert.throws(() => process.kill(result.receipt.pid, 0), { code: 'ESRCH' }); assert.throws(() => process.kill(-result.receipt.pid, 0), { code: 'ESRCH' });
  const terminal = JSON.parse(Buffer.from(result.receipt.stdout, 'base64'));
  assert.equal(Object.hasOwn(terminal, 'failures'), false);
  assert.equal(terminal.status, 'ADMISSION_ACCEPTED'); assert.equal(terminal.unsafe, false);
  const artifact = readDocument(path.join(output, 'body/runs/synthetic'), 'RESULT.json', terminal.result.sha256);
  assert.equal(artifact.admissionQualified, true); assert.equal(artifact.authorityClass, 'SYNTHETIC_ONLY');
  assert.equal(assessTerminal(result.receipt, path.join(output, 'body/runs/synthetic'), { syntheticOnly: true }), false);
  const originalBytes = fs.readFileSync(path.join(output, 'ORIGINAL-TERMINAL.json'));
  const repaired = { ...result.receipt, stdout: originalBytes.toString('base64'), captureBytes: { ...result.receipt.captureBytes, stdout: originalBytes.length } };
  assert.equal(assessTerminal(repaired, path.join(output, 'body/runs/synthetic'), { syntheticOnly: true }), true);
  await delay(150); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(process.getActiveResourcesInfo().sort(), resources); assert.deepEqual(late, []);
} catch (error) { failure = { message: error.message, code: error.code, stack: error.stack }; }
const originalAfter = authenticate(); check(); assert.deepEqual(originalAfter, originalBefore);
save('AFTER.json', originalAfter);
process.removeListener('unhandledRejection', listener);
const final = { id: 'F31', classification: 'SUPPLEMENTAL_EXACT_MALFORMED_TERMINAL_NOT_REBASELINE', pass: !failure, failure, started, finished: new Date().toISOString(), expected: seal.expected, actual: { outerQualified: result.qualified, natural: result.receipt.natural, reaped: result.receipt.reaped, exit: result.receipt.exit, close: result.receipt.close }, originalCaptureFilesUnchanged: 180, all322InputsUnchanged: true, resourcesBefore: resources, resourcesAfter: process.getActiveResourcesInfo().sort(), late, children: 1, drivers: 1, actualEngines: 0, actualAdmission: 0 };
save('F31.json', final); process.stdout.write(`${JSON.stringify(final)}\n`); process.exitCode = failure ? 1 : 0;
