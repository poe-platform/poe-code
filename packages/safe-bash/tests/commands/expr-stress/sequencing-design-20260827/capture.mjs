import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const receipt = JSON.parse(readFileSync(join(owned, 'freeze/receipt.json')));
const frozen = JSON.parse(readFileSync(join(owned, 'freeze/cases.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const destination = process.argv[3];
if (process.argv[2] !== '--capture' || !destination || !/^[a-z0-9-]+$/.test(destination)) throw new Error('Usage: node capture.mjs --capture UNIQUE-OUTPUT-NAME');
const output = resolve(owned, destination);
assert(!existsSync(output), 'capture never overwrites prior evidence');
mkdirSync(output);
const save = (filename, data) => writeFileSync(join(output, filename), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
function verifyFreeze() {
  assert.equal(sha256(readFileSync(join(owned, 'freeze/accepted-source.tar.gz'))), receipt.sourceArchiveSha256);
  assert.equal(sha256(readFileSync(join(owned, 'freeze/cases.json'))), receipt.casesSha256);
  for (const [filename, hash] of Object.entries(receipt.filesSha256)) assert.equal(sha256(readFileSync(join(owned, filename))), hash, filename);
  assert.equal(sha256(readFileSync(receipt.native.path)), receipt.native.sha256);
}
function command(binary, args, cwd = root, env = process.env, timeout = 60000) {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}
function inventory(directory) {
  const records = {};
  function walk(current, relative = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relative && ['dist', 'node_modules'].includes(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), name);
      else records[name] = sha256(readFileSync(join(current, entry.name)));
    }
  }
  walk(directory);
  return records;
}
let scratch;
try {
  verifyFreeze();
  assert.equal(os.platform(), receipt.native.expectedPlatform);
  const version = command(receipt.native.path, ['--version'], root, receipt.native.environment);
  assert.equal(version.status, 0);
  assert(version.stdout.startsWith(`${receipt.native.expectedVersion}\n`));
  const nativeControls = [
    { args: ['41', '+', '1'], expected: { status: 0, stdout: '42\n', stderr: '' } },
    { args: ['0'], expected: { status: 1, stdout: '0\n', stderr: '' } },
    { args: ['1', '/', '0'], expected: { status: 2, stdout: '', stderr: 'expr: division by zero\n' } },
  ].map(control => {
    const observed = command(receipt.native.path, control.args, root, receipt.native.environment, 3000);
    return { ...control, observed, passed: Object.entries(control.expected).every(([key, value]) => observed[key] === value) && !observed.signal && !observed.error };
  });
  save('native-controls.json', { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, native: receipt.native, version, nativeControls, scope: 'pinned official GNU 9.7 fixture on Darwin; not Linux and not system BSD expr' });
  assert(nativeControls.every(control => control.passed));
  const native = frozen.cases.filter(specimen => specimen.native !== false).map(specimen => {
    const observed = command(receipt.native.path, specimen.args, root, receipt.native.environment, 3000);
    const passed = observed.status === specimen.expected.exitCode && observed.stdout === specimen.expected.stdout && observed.stderr === specimen.expected.stderr && !observed.error && !observed.signal;
    return { id: specimen.id, args: specimen.args, expected: specimen.expected, observed, passed };
  });
  save('native-semantics.json', { cases: native, passing: native.filter(specimen => specimen.passed).length, total: native.length });
  mkdirSync(join(owned, '.scratch'), { recursive: true });
  scratch = mkdtempSync(join(owned, '.scratch/accepted-'));
  const extract = command('tar', ['-xzf', join(owned, 'freeze/accepted-source.tar.gz'), '-C', scratch]);
  assert.equal(extract.status, 0, extract.stderr);
  const before = inventory(scratch);
  save('source-before.json', before);
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  const build = command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], scratch);
  save('build.json', build);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const execution = command(process.execPath, ['--unhandled-rejections=strict', join(owned, 'driver.mjs'), scratch, join(owned, 'freeze/cases.json')], scratch, process.env, 90000);
  save('execution.json', execution);
  assert.equal(execution.status, 0, execution.stderr);
  const results = JSON.parse(execution.stdout);
  save('product.json', results);
  const after = inventory(scratch);
  save('source-after.json', after);
  assert.deepEqual(after, before, 'full source/tests inventory detects modifications, deletions AND new entries; generated dist/node_modules excluded');
  verifyFreeze();
  save('summary.json', { capturedAt: new Date().toISOString(), candidate: receipt.commit, archiveSha256: receipt.sourceArchiveSha256, native: { pass: native.filter(specimen => specimen.passed).length, total: native.length }, product: { pass: results.cases.filter(specimen => specimen.passed).length, total: results.cases.length, failed: results.cases.filter(specimen => !specimen.passed).map(specimen => ({ id: specimen.id, failures: specimen.failures })) }, shell: { pass: results.shell.filter(specimen => specimen.passed).length, total: results.shell.length }, oldCapSeparate: { passed: results.oldCap.passed, observed: results.oldCap.observed }, integrity: { archiveBeforeAfter: true, frozenInputsBeforeAfter: true, nativeBinaryBeforeAfter: true, appendAwareSourceTestsBeforeAfter: true, activeWorkersAtCompletion: results.activeWorkers }, noCandidateSourceChanges: true });
  console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
} catch (error) {
  save('failure.json', { message: error.message, stack: error.stack });
  throw error;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratchRemoved: scratch ? !existsSync(scratch) : null, processChildren: 'synchronous native/build/driver children waited; driver terminates owned workers in finally; subprocess timeout is an infrastructure failure, not semantic result' });
}
