import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const output = path.resolve(process.argv[2] ?? '');
assert.ok(output.startsWith(`${directory}/native-`), 'explicit new owned native-* output required');
mkdirSync(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(readFileSync(path.join(directory, 'CASES.json')));
const historical = JSON.parse(readFileSync(path.join(directory, 'HISTORICAL-REGRESSIONS.json')));
const cases = [...frozen.cases.filter(row => row.native !== false), ...historical.rows.map(row => ({ id: `historical/${row.id}`, subject: row.argv[1], pattern: row.argv[3], historicalGNU: row.native }))];
const identify = () => Object.fromEntries(['gnu', 'apple'].map(name => {
  const oracle = frozen.native[name];
  const filename = path.resolve(root, oracle.path);
  const sha256 = hash(readFileSync(filename));
  assert.equal(sha256, oracle.sha256);
  return [name, { ...oracle, filename, sha256 }];
}));
const anchors = () => frozen.anchors.map(entry => {
  const actual = hash(readFileSync(path.join(root, entry.path)));
  assert.equal(actual, entry.sha256, entry.path);
  return { ...entry, actual };
});
const capture = { started: new Date().toISOString(), casesSha256: hash(readFileSync(path.join(directory, 'CASES.json'))), regressionsSha256: hash(readFileSync(path.join(directory, 'HISTORICAL-REGRESSIONS.json'))), environment: frozen.native.environment, profiles: identify(), anchorsBefore: anchors(), rows: [] };
try {
  for (const fixture of cases) {
    const row = { id: fixture.id, subject: fixture.subject, pattern: fixture.pattern };
    for (const name of ['gnu', 'apple']) {
      const argv = [fixture.subject, ':', fixture.pattern];
      const result = spawnSync(capture.profiles[name].filename, argv, { cwd: output, env: frozen.native.environment, timeout: frozen.native.timeoutMs, killSignal: 'SIGKILL', maxBuffer: frozen.native.maxOutputBytes, input: Buffer.alloc(0), argv0: 'expr' });
      row[name] = { argv, status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null, stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex') };
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (name === 'gnu' && fixture.historicalGNU) {
        const expected = fixture.historicalGNU;
        assert.equal(row.gnu.status, expected.status);
        assert.equal(row.gnu.stdoutHex, Buffer.from(expected.stdoutBase64, 'base64').toString('hex'));
        assert.equal(row.gnu.stderrHex, Buffer.from(expected.stderrBase64, 'base64').toString('hex'));
      }
    }
    row.profilesAgree = ['status', 'stdoutHex', 'stderrHex'].every(key => row.gnu[key] === row.apple[key]);
    capture.rows.push(row);
  }
} catch (error) {
  capture.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  capture.profilesAfter = identify();
  capture.anchorsAfter = anchors();
  capture.finished = new Date().toISOString();
  capture.cleanup = { activeOwnedChildren: 0, method: 'Every native spawnSync settles before continuing; each invocation has a 2s SIGKILL deadline and 64KiB output bound.' };
  capture.counts = { cases: capture.rows.length, nativeObservations: capture.rows.length * 2, agreements: capture.rows.filter(row => row.profilesAgree).length, differences: capture.rows.filter(row => !row.profilesAgree).map(row => row.id), candidateExecutions: 0, candidateAcceptances: 0 };
  writeFileSync(path.join(output, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(capture.counts));
}
