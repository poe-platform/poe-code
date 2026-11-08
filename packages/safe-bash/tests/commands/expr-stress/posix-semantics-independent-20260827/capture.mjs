import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' };
const fingerprint = filename => ({ path: filename, realpath: realpathSync(filename), sha256: hash(readFileSync(filename)) });
const execute = (filename, arguments_, extraEnvironment = {}) => {
  const result = spawnSync(filename, arguments_, { cwd: root, env: { ...environment, ...extraEnvironment }, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, input: Buffer.alloc(0), argv0: path.basename(filename) });
  return { arguments: arguments_, status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null, stdoutHex: result.stdout?.toString('hex') ?? '', stderrHex: result.stderr?.toString('hex') ?? '' };
};
const git = arguments_ => {
  const result = execute('/usr/bin/git', arguments_);
  assert.equal(result.status, 0);
  return Buffer.from(result.stdoutHex, 'hex').toString();
};
const caseBytes = readFileSync(path.join(directory, 'CASES.json'));
const cases = JSON.parse(caseBytes).cases;
const sourcePaths = ['CASES.json', 'libc-probe.c', 'capture.mjs'];
const inputs = () => sourcePaths.map(name => ({ name, sha256: hash(readFileSync(path.join(directory, name))) }));
const gnu = path.join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr');
assert.equal(fingerprint(gnu).sha256, 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c');
const result = {
  started: new Date().toISOString(),
  head: git(['rev-parse', 'HEAD']).trim(),
  inputFreeze: git(['log', '-1', '--format=%H', '--', path.relative(root, path.join(directory, 'CASES.json'))]).trim(),
  casesSha256: hash(caseBytes), environment,
  runtime: { ...fingerprint(process.execPath), version: process.version, platform: process.platform, arch: process.arch },
  platform: execute('/usr/bin/sw_vers', []),
  before: inputs(),
  native: { gnu: fingerprint(gnu), apple: fingerprint('/bin/expr'), compiler: fingerprint('/usr/bin/cc') },
  versions: { gnu: execute(gnu, ['--version']), compiler: execute('/usr/bin/cc', ['--version']) },
  historical: [
    ['53f2a4681cd22a65299576ba655cf9338c3d1de0', 'tests/commands/expr-stress/nullable-design-review/REPORT.md'],
    ['6580859f176b3fc172b78a42f50a339576744190', 'tests/commands/expr-stress/c-profile-gap-review/frozen/CASES.md']
  ].map(([commit, filename]) => ({ commit, path: filename, sha256: hash(Buffer.from(git(['show', `${commit}:${filename}`]))) })),
  rows: []
};
const output = mkdtempSync(path.join(tmpdir(), 'expr-posix-independent-'));
const executionRoot = mkdtempSync(path.join(tmpdir(), 'expr-posix-native-'));
try {
  const helper = path.join(executionRoot, 'libc-probe');
  result.compile = execute('/usr/bin/cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', path.join(directory, 'libc-probe.c'), '-o', helper]);
  assert.equal(result.compile.status, 0, Buffer.from(result.compile.stderrHex, 'hex').toString());
  result.native.libcHelper = fingerprint(helper);
  result.linkage = execute('/usr/bin/otool', ['-L', helper]);
  for (const fixture of cases) {
    const row = {
      id: fixture.id,
      gnuPlus: execute(gnu, ['+', fixture.subject, ':', fixture.pattern]),
      gnuPortable: execute(gnu, [fixture.subject, ':', fixture.pattern]),
      applePortable: execute('/bin/expr', [fixture.subject, ':', fixture.pattern]),
      libc: execute(helper, [fixture.pattern, fixture.subject])
    };
    if (['P-empty', 'P-a', 'P-aa', 'P-aaa', 'Q-empty'].includes(fixture.id)) row.gnuPosixEnvironment = execute(gnu, [fixture.subject, ':', fixture.pattern], { POSIXLY_CORRECT: '1' });
    result.rows.push(row);
  }
} catch (error) {
  result.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  rmSync(executionRoot, { recursive: true, force: true });
  result.after = inputs();
  result.nativeAfter = { gnu: fingerprint(gnu), apple: fingerprint('/bin/expr'), compiler: fingerprint('/usr/bin/cc') };
  result.finished = new Date().toISOString();
  result.cleanup = { executionRootRemoved: true, activeOwnedChildren: 0, method: 'spawnSync waits for each child; unique helper tree removed in finally' };
  writeFileSync(path.join(output, 'capture.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(output);
}
