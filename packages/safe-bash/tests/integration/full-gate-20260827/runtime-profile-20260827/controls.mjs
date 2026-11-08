import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateProfile, inspectRuntime, probeGuardedRuntime } from './profile.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.argv[2]; assert.ok(output); assert.equal(existsSync(output), false);
const temporary = realpathSync(mkdtempSync('/tmp/safe-bash-runtime-policy-controls-'));
const root = join(temporary, 'owned'), source = join(root, 'source');
mkdirSync(join(source, 'src/commands'), { recursive: true });
writeFileSync(join(source, 'package.json'), '{"type":"module"}\n');
cpSync(join(repository, 'node_modules'), join(source, 'node_modules'), { recursive: true, dereference: true });
const original = { 'src/commands/execution.ts': 'export const execution: number = 1;\n', 'src/commands/env-split.ts': 'export const split: number = 2;\n' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [path, content] of Object.entries(original)) writeFileSync(join(source, path), content);
const expected = Object.fromEntries(Object.entries(original).map(([path, content]) => [path, hash(content)]));
const guardBytes = execFileSync('git', ['show', '6699804a:tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'], { cwd: repository });
assert.equal(hash(guardBytes), gateProfile.guardSha256);
const report = { controls: [], probes: {}, productExecutions: 0, privateAccess: false, wholeGateLaunched: false };
const record = (name, action) => { action(); report.controls.push(name); };
const probe = (name, executable = gateProfile.executable, sourceHashes = expected, bytes = guardBytes) => {
  const harness = join(root, 'harness-' + name); mkdirSync(harness);
  const guard = join(harness, 'import-guard.mjs'); writeFileSync(guard, bytes);
  const result = probeGuardedRuntime({ executable, root, source, harness, guard, expectedSource: sourceHashes, environment: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1' } });
  report.probes[name] = result; return result;
};
try {
  report.selected = inspectRuntime(gateProfile.executable);
  record('installed Node24 version/path/hash identity matches explicit profile', () => assert.equal(report.selected.supported, true));
  const positive = probe('positive');
  record('unchanged guard plus tsx and TypeScript CJS succeeds', () => assert.equal(positive.status, 0, positive.reason));
  record('direct-exec and PATH child versions/paths match selected Node24 despite legacy-first input PATH', () => {
    assert.deepEqual(positive.childIdentities.self, positive.childIdentities.direct);
    assert.deepEqual(positive.childIdentities.self, positive.childIdentities.byPath);
    assert.equal(positive.childIdentities.self.version, gateProfile.version);
  });
  const legacy = probe('legacy22', process.execPath);
  record('historical Node22.22.2 interop refuses78 with original null-source diagnosis', () => {
    assert.equal(process.version, 'v22.22.2'); assert.equal(legacy.status, 78);
    assert.match(legacy.probe.stderr, /ERR_INVALID_RETURN_PROPERTY_VALUE/u);
  });
  const forbiddenOutput = join(temporary, 'must-not-launch');
  const cli = spawnSync(process.execPath, ['tests/integration/full-gate-20260827/combined-8670ebe8/run.mjs', '--handoff', '8670ebe8f0d39966c2de2638780437398e5f8490', '--execute', forbiddenOutput, '--committed-archive'], { cwd: repository, encoding: 'utf8', timeout: 10000 });
  report.legacyCli = { status: cli.status, signal: cli.signal, stdout: cli.stdout, stderr: cli.stderr };
  record('actual legacy gate CLI refuses78 before output/archive/suite creation', () => { assert.equal(cli.status, 78); assert.equal(cli.signal, null); assert.equal(existsSync(forbiddenOutput), false); assert.equal(JSON.parse(cli.stdout).suiteLaunched, false); });
  const wrongHash = probe('wrong-source-hash', gateProfile.executable, { ...expected, 'src/commands/execution.ts': '0'.repeat(64) });
  record('changed critical source assertion still rejects', () => { assert.equal(wrongHash.status, 78); assert.match(wrongHash.probe.stderr, /Frozen env source bytes/u); });
  rmSync(join(source, 'src/commands/execution.ts'));
  const missing = probe('missing-source');
  record('missing critical source rejects', () => { assert.equal(missing.status, 78); assert.match(missing.probe.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/u); });
  writeFileSync(join(source, 'src/commands/execution.ts'), original['src/commands/execution.ts']);
  const outside = join(temporary, 'outside.mjs'); writeFileSync(outside, 'throw new Error("OUTSIDE_BODY_MUST_NOT_RUN");\n');
  const malicious = `import ${JSON.stringify(new URL('file://' + outside).href)};\n`;
  writeFileSync(join(source, 'src/commands/execution.ts'), malicious);
  const overlay = probe('outside-overlay', gateProfile.executable, { ...expected, 'src/commands/execution.ts': hash(malicious) });
  record('byte-authenticated local importer cannot load an outside overlay', () => { assert.equal(overlay.status, 78); assert.match(overlay.probe.stderr, /FROZEN_IMPORT_OUTSIDE/u); assert.doesNotMatch(overlay.probe.stderr, /Error: OUTSIDE_BODY_MUST_NOT_RUN/u); });
  writeFileSync(join(source, 'src/commands/execution.ts'), original['src/commands/execution.ts']);
  const disabled = probe('disabled-guard', gateProfile.executable, expected, Buffer.from('export {};\n'));
  record('disabled authentication guard refuses before feature probe', () => { assert.equal(disabled.status, 78); assert.match(disabled.reason, /Authentication guard must remain unchanged/u); assert.equal(disabled.probe, undefined); });
  writeFileSync(join(source, 'src/commands/execution.js'), 'export const compiled = true;\n');
  const compiled = spawnSync(gateProfile.executable, ['--input-type=module', '-e', "await import('./src/commands/execution.js');"], { cwd: source, env: positive.environment, encoding: 'utf8', timeout: 10000 });
  report.compiledFallback = { status: compiled.status, stdout: compiled.stdout, stderr: compiled.stderr };
  record('unchanged guard refuses compiled-source fallback', () => { assert.equal(compiled.status, 1); assert.match(compiled.stderr, /Frozen env compiled-source fallback/u); });
  const tool = join(source, 'node_modules/typescript/lib/typescript.js'); const toolBytes = readFileSync(tool); writeFileSync(tool, 'changed');
  const toolMismatch = probe('changed-typescript');
  record('unqualified CJS tool bytes refuse before probe', () => { assert.equal(toolMismatch.status, 78); assert.match(toolMismatch.reason, /Unqualified TypeScript CJS dependency/u); });
  writeFileSync(tool, toolBytes);
  report.status = 'author-controls-pass-not-actual-body-acceptance';
} catch (error) { report.status = 'fail'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ status: report.status, controls: report.controls.length, temporaryRemoved: report.temporaryRemoved, error: report.error, output }));
