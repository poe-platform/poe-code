import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productRevision, stageExternalVerifier, verifierRevision } from './external-verifier-v2.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(process.argv[2]);
assert.ok(output.startsWith('/tmp/') && !existsSync(output));
const temporary = realpathSync(mkdtempSync('/tmp/safe-bash-verifier-overlay-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['tests/plugins/stream-five-public/harness.mjs', 'tests/plugins/stream-five-public/current-profile.mjs', 'tests/plugins/qualified-current-release/consumers.mjs', 'tests/plugins/qualified-current-release/runtime-coverage.mjs', 'tests/plugins/qualified-current-release/snapshot.mjs', 'scripts/verify-current-consumers.mjs'];
const bytes = Object.fromEntries(paths.map(path => [path, execFileSync('git', ['--no-replace-objects', 'show', productRevision + ':' + path], { cwd: repository })]));
const report = { productRevision, verifierRevision, productExecutions: 0, controls: [], failures: [] };
function context(name) {
  const root = join(temporary, name), source = join(root, 'source'), harness = join(root, 'external');
  mkdirSync(harness, { recursive: true });
  for (const [path, content] of Object.entries(bytes)) {
    const target = join(source, path); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, content);
  }
  return { repository, source, harness, inputs: Object.fromEntries(Object.entries(bytes).map(([path, content]) => [path, { sha256: hash(content) }])) };
}
function check(name, action) {
  try { action(); report.controls.push({ name, status: 'pass' }); }
  catch (error) { report.controls.push({ name, status: 'fail' }); report.failures.push({ name, message: error.message }); }
}
try {
  const positive = context('positive');
  const receipt = stageExternalVerifier(positive); report.receipt = receipt;
  check('exact five frozen helper imports and reversible verifier transformation', () => {
    assert.equal(receipt.helperBindings.length, 5);
    let restored = readFileSync(receipt.external, 'utf8');
    for (const binding of receipt.helperBindings) restored = restored.replace(JSON.stringify(binding.replacement), JSON.stringify(binding.specifier));
    assert.equal(hash(Buffer.from(restored)), receipt.originalSha256);
    assert.equal(hash(readFileSync(receipt.driver)), receipt.driverSha256);
  });
  check('frozen helper and original verifier bytes untouched', () => { for (const [path, content] of Object.entries(bytes)) assert.deepEqual(readFileSync(join(positive.source, path)), content); });
  check('changed frozen consumer mapping refuses before driver emission', () => {
    const input = context('tamper'); writeFileSync(join(input.source, paths[2]), 'changed mapping');
    assert.throws(() => stageExternalVerifier(input), /Frozen helper mismatch/); assert.equal(existsSync(join(input.harness, 'permission-tap-driver-v2.mjs')), false);
  });
  check('missing frozen helper refuses', () => { const input = context('missing'); unlinkSync(join(input.source, paths[3])); assert.throws(() => stageExternalVerifier(input)); });
  check('helper symlink to same bytes refuses', () => {
    const input = context('symlink'), target = join(input.source, paths[2]), external = join(input.harness, 'same-bytes');
    writeFileSync(external, bytes[paths[2]]); unlinkSync(target); symlinkSync(external, target); assert.throws(() => stageExternalVerifier(input));
  });
  check('unbound helper hash refuses', () => { const input = context('unbound'); delete input.inputs[paths[1]]; assert.throws(() => stageExternalVerifier(input), /Frozen helper mismatch/); });
  check('overlay cannot be staged inside frozen source', () => { const input = context('inside'); input.harness = join(input.source, 'overlay'); mkdirSync(input.harness); assert.throws(() => stageExternalVerifier(input)); });
  check('existing overlay cannot be silently overwritten', () => { assert.throws(() => stageExternalVerifier(positive), /EEXIST/); assert.equal(hash(readFileSync(receipt.external)), receipt.transformedSha256); });
} finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ controls: report.controls.length, failures: report.failures, productExecutions: 0, temporaryRemoved: report.temporaryRemoved, output }));
  if (report.failures.length) process.exitCode = 1;
}
