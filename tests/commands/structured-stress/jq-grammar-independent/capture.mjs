import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { arch, release, platform } from 'node:os';
import { join } from 'node:path';
import { cases } from './cases.mjs';
import { addFile, artifact, directory, digest, sourceSnapshot } from './common.mjs';

assert.equal(process.argv.length, 2, 'one-time native freeze accepts no rebaseline options');
assert.equal(existsSync(join(directory, 'native-frozen.json')), false, 'native freeze is immutable');
assert.equal(cases.length, 35);
assert.equal(new Set(cases.map(vector => vector.id)).size, 35);
const executable = '/usr/bin/jq';
const executableSha256 = digest(readFileSync(executable));
assert.equal(executableSha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };
const startedAt = new Date().toISOString();
const before = sourceSnapshot();
const scratch = mkdtempSync(join(directory, '.native-'));
let nativeInvocations = 0;
function invoke(argv, inputHex, cwd) {
  nativeInvocations++;
  const result = spawnSync(executable, argv, { cwd, env: environment, input: Buffer.from(inputHex, 'hex'), shell: false, timeout: 5000, maxBuffer: 256 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(Number.isInteger(result.status));
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
}
try {
  const version = invoke(['--version'], '', scratch);
  const build = invoke(['--build-configuration'], '', scratch);
  assert.equal(Buffer.from(version.stdoutHex, 'hex').toString().trim(), 'jq-1.7.1-apple');
  assert.equal(Buffer.from(build.stdoutHex, 'hex').toString().trim(), '--with-oniguruma=builtin');
  const frozen = [];
  for (const vector of cases) {
    const cwd = mkdtempSync(join(scratch, `${vector.id}-`));
    for (const [name, inputHex] of Object.entries(vector.files ?? {})) {
      assert.match(name, /^[a-z]+\.txt$/u);
      const bytes = Buffer.from(inputHex, 'hex');
      assert.equal(Buffer.from(bytes.toString()).toString('hex'), inputHex, 'text fixtures must roundtrip');
      addFile(join(cwd, name), bytes.toString());
    }
    const snapshot = () => Object.fromEntries(readdirSync(cwd).sort().map(name => [name, readFileSync(join(cwd, name)).toString('hex')]));
    const beforeFiles = snapshot();
    const execute = () => {
      let inputHex = vector.inputHex;
      const stages = (vector.stages ?? [{ argv: vector.argv }]).map(stage => {
        const expected = invoke(stage.argv, inputHex, cwd);
        const result = { argv: stage.argv, inputHex, expected };
        inputHex = expected.stdoutHex;
        return result;
      });
      return { expected: { status: stages.at(-1).expected.status, stdoutHex: inputHex, stderrHex: stages.map(stage => stage.expected.stderrHex).join('') },
        ...(vector.stages ? { stages } : {}), afterFiles: snapshot() };
    };
    const first = execute();
    const second = execute();
    assert.deepEqual(second, first, `${vector.id}: repeated native observation differs`);
    assert.deepEqual(first.afterFiles, beforeFiles, `${vector.id}: native modified fixtures`);
    frozen.push({ ...vector, ...first, inputSha256: digest(Buffer.from(vector.inputHex, 'hex')) });
    console.log(JSON.stringify({ id: vector.id, status: first.expected.status, stdoutBytes: first.expected.stdoutHex.length / 2, stderr: Buffer.from(first.expected.stderrHex, 'hex').toString() }));
  }
  artifact('native-frozen.json', { phase: 'PREPARATION: native-only capture; no virtual implementation imported or executed', startedAt, endedAt: new Date().toISOString(),
    executable, executableSha256, version, build, environment, host: { platform: platform(), release: release(), arch: arch(), node: process.version, nodeExecutable: process.execPath },
    specificationSha256: digest(readFileSync(join(directory, 'cases.mjs'))), captureSha256: digest(readFileSync(join(directory, 'capture.mjs'))),
    nativeInvocations, repeats: 2, before, after: sourceSnapshot(), cases: frozen,
    limits: '35 native vectors, two identical captures each. Pipelines are argv-safe sequential native stages, not host-shell execution; stage stderr concatenation makes no cross-process ordering promise. Chunk tests are virtual transport schedules, not forced native read boundaries. Source snapshots are context only, not a source validation or handoff acceptance.' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
