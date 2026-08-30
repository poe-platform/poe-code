import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const [stage, mode, receipt] = process.argv.slice(2);
assert.ok(stage && receipt && ['capture', 'compare'].includes(mode));
const root = process.cwd();
const { diagnosticCases, validControls } = await import(pathToFileURL(path.join(stage, 'tests/commands/expr/diagnostics/cases.ts')));
const { run } = await import(pathToFileURL(path.join(stage, 'tests/commands/expr/helpers.ts')));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const executable = path.join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr');
const source = path.join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr.c');
const archive = path.join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz');
const identities = { executable: sha256(fs.readFileSync(executable)), source: sha256(fs.readFileSync(source)), archive: sha256(fs.readFileSync(archive)), apple: sha256(fs.readFileSync('/bin/expr')) };
assert.deepEqual(identities, {
  executable: 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c',
  source: 'c9dc5e04039505ab48a350e9407b1d83b2574fd7e2c31c9d23f4bf942d1b8af0',
  archive: 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf',
  apple: '584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f',
});
function native(binary, args, argv0) {
  assert.ok(args.length <= 128 && args.reduce((sum, token) => sum + Buffer.byteLength(token), 0) <= 4096);
  const result = spawnSync(binary, args, { argv0, env: { LC_ALL: 'C' }, timeout: 2000, maxBuffer: 16384, killSignal: 'SIGKILL' });
  assert.ifError(result.error); assert.equal(result.signal, null); assert.notEqual(result.status, null);
  return { exitCode: result.status, stdoutHex: result.stdout.toString('hex'), stderr: result.stderr.toString() };
}
const cases = [
  ...diagnosticCases.map(specimen => ({ ...specimen, expected: { exitCode: 2, stdoutHex: '', stderr: specimen.stderr } })),
  ...validControls.map(([id, args, stdout, exitCode]) => ({ id, args, cohort: id === 'quoted-correction1' ? 'correction' : 'valid-control', expected: { exitCode, stdoutHex: Buffer.from(stdout).toString('hex'), stderr: '' } })),
];
let frozen;
if (mode === 'capture') {
  const rows = cases.map(specimen => {
    const gnu = native(executable, specimen.args, 'expr');
    assert.deepEqual(gnu, specimen.expected, `freeze native expectation: ${specimen.id}`);
    return { id: specimen.id, args: specimen.args, cohort: specimen.cohort, gnu, gnuAbsoluteArgv0: native(executable, specimen.args, executable), apple: native('/bin/expr', specimen.args, 'expr') };
  });
  const member = spawnSync('/usr/bin/tar', ['-xOf', archive, 'coreutils-9.7/src/expr.c'], { timeout: 10000, maxBuffer: 200000 });
  assert.equal(member.status, 0); assert.equal(sha256(member.stdout), identities.source);
  frozen = { createdAt: new Date().toISOString(), profile: 'GNU coreutils9.7 on Darwin, LC_ALL=C; Apple separately retained', host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version }, executable, argv0: 'expr', virtualLabel: 'expr', identities, version: native(executable, ['--version'], 'expr'), rows };
  assert.match(Buffer.from(frozen.version.stdoutHex, 'hex').toString(), /^expr \(GNU coreutils\) 9\.7\n/u);
  fs.writeFileSync(receipt, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' });
} else {
  frozen = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.deepEqual(frozen.identities, identities);
}
const observations = [];
for (const specimen of cases) {
  const reference = frozen.rows.find(row => row.id === specimen.id);
  assert.ok(reference); assert.deepEqual(reference.args, specimen.args); assert.deepEqual(reference.gnu, specimen.expected);
  const result = await run(specimen.args);
  const actual = { exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderr: result.stderr };
  const semantic = actual.exitCode === reference.gnu.exitCode && actual.stdoutHex === reference.gnu.stdoutHex && Boolean(actual.stderr) === Boolean(reference.gnu.stderr);
  const exactDiagnostic = actual.stderr === reference.gnu.stderr;
  observations.push({ id: specimen.id, cohort: specimen.cohort, actual, semantic, exactDiagnostic, strict: semantic && exactDiagnostic });
}
const counts = {};
for (const cohort of ['original', 'extension', 'control', 'valid-control', 'correction']) {
  const rows = observations.filter(row => row.cohort === cohort);
  counts[cohort] = { total: rows.length, semantic: rows.filter(row => row.semantic).length, exactDiagnostic: rows.filter(row => row.exactDiagnostic).length, strict: rows.filter(row => row.strict).length };
}
const outsideScopeArgs = ['1', '/', '0', 'extra'];
const outsideScopeActual = await run(outsideScopeArgs);
console.log(JSON.stringify({ createdAt: new Date().toISOString(), nativeReceiptSha256: sha256(fs.readFileSync(receipt)), virtualLabel: 'expr', counts, observations,
  outsideScopeEvaluationOrder: { args: outsideScopeArgs, native: native(executable, outsideScopeArgs, 'expr'), actual: { exitCode: outsideScopeActual.exitCode, stdoutHex: outsideScopeActual.stdoutHex, stderr: outsideScopeActual.stderr }, classification: 'AST-first parser versus native interleaved evaluation; recorded separately, not a focused parity pass' } }, null, 2));
