import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changes, sha256 } from './fixture.mjs';

const output = process.argv[2]; assert.ok(output);
const root = dirname(fileURLToPath(import.meta.url));
const freeze = JSON.parse(readFileSync(join(root, 'freeze.json')));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const rows = [];
for (const delta of changes()) {
  const sourceSha256 = sha256(delta.after);
  assert.equal(sourceSha256, freeze.fixture.spans.find(row => row.id === delta.id).afterSha256);
  const exactPatchedBody = new AsyncFunction('shell', 'input', 'failure', 'details', 'assert', delta.after);
  for (const control of ['fulfilled-status-0-swallow', 'fulfilled-status-2', 'wrong-reason', 'equal-message-wrong-object', 'exact-identity-positive']) {
    const failure = new Error(delta.id === 'S07' ? 'external-return-sentinel' : 'shared-grep-return-sentinel');
    const other = new Error(control === 'equal-message-wrong-object' ? failure.message : 'wrong reason');
    const result = { exitCode: control === 'fulfilled-status-2' ? 2 : 0, stdout: '', stderr: failure.message, stdoutBytes: new Uint8Array(), stderrBytes: Buffer.from(failure.message) };
    const input = { input: {}, returns: () => 1, nextCalls: () => 1 };
    let disposeCalls = 0; let execCalls = 0;
    const shell = { commands: { has: () => false }, dispose: async () => { disposeCalls += 1; }, exec: async (command, options) => {
      execCalls += 1; assert.equal(command, delta.id === 'S07' ? 'egrep -q keep' : 'grep -q keep'); assert.equal(options.stdin, input.input);
      if (control.startsWith('fulfilled')) return result;
      throw control === 'exact-identity-positive' ? failure : other;
    } };
    const details = {}; let rejected = false; let error;
    try { await exactPatchedBody(shell, input, failure, details, assert); }
    catch (reason) { rejected = true; error = { name: reason.name, code: reason.code, message: reason.message, stack: reason.stack }; }
    assert.equal(execCalls, 1); assert.equal(disposeCalls, 1);
    assert.equal(rejected, control !== 'exact-identity-positive');
    if (rejected) assert.equal(error.code, 'ERR_ASSERTION');
    rows.push({ id: delta.id, label: delta.label, control, exactPatchedBodySha256: sourceSha256, assertionRejected: rejected, error, details, execCalls, disposeCalls, classification: 'assertion-control-with-stub-settlement-not-product-execution' });
  }
}
writeFileSync(output, `${JSON.stringify({ classification: 'exact-two-patched-bodies-no-product-import-or-mutant', negativeControls: 8, negativeControlsRejected: rows.filter(row => row.assertionRejected).length, positiveControls: 2, positiveControlsAccepted: rows.filter(row => !row.assertionRejected).length, productPasses: 0, rows }, null, 2)}\n`);
