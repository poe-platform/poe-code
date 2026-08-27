import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const gateProfile = Object.freeze({
  name: 'guarded-gate-node24.11.1-darwin-arm64',
  executable: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node',
  version: 'v24.11.1', platform: 'darwin', arch: 'arm64',
  sha256: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0',
  guardSha256: 'af4608b333f6b2dc4384fb28d3866a134ba3efc0a120d63a9adeee79f0f21114',
  typescriptSha256: '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function inspectRuntime(executable = process.execPath) {
  const report = { profile: gateProfile.name, requested: executable, supported: false, refusalStatus: 78 };
  try {
    const path = realpathSync(executable);
    const result = spawnSync(path, ['--input-type=module', '-e', 'console.log(JSON.stringify({version:process.version,execPath:process.execPath,platform:process.platform,arch:process.arch}))'], { encoding: 'utf8', timeout: 10000, env: { PATH: dirname(path) + ':/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' } });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
    report.identity = { ...JSON.parse(result.stdout), path, sha256: hash(readFileSync(path)) };
    for (const key of ['version', 'platform', 'arch', 'sha256']) assert.equal(report.identity[key], gateProfile[key], 'Unqualified external gate runtime: ' + key);
    assert.equal(path, realpathSync(gateProfile.executable), 'Use the explicitly selected installed runtime');
    assert.equal(realpathSync(report.identity.execPath), path);
    report.supported = true;
  } catch (error) { report.reason = error.message; }
  return report;
}

export function probeGuardedRuntime({ executable, root, source, harness, guard, expectedSource, environment }) {
  const report = { profile: gateProfile.name, status: 78, productExecutions: 0, suiteLaunched: false };
  try {
    const physicalRoot = realpathSync(root), physicalSource = realpathSync(source), physicalHarness = realpathSync(harness);
    assert.ok(physicalSource.startsWith(physicalRoot + '/'));
    assert.ok(physicalHarness.startsWith(physicalRoot + '/') && !physicalHarness.startsWith(physicalSource + '/'));
    assert.ok(realpathSync(guard).startsWith(physicalHarness + '/'));
    assert.ok(lstatSync(guard).isFile() && !lstatSync(guard).isSymbolicLink());
    assert.equal(hash(readFileSync(guard)), gateProfile.guardSha256, 'Authentication guard must remain unchanged');
    assert.deepEqual(Object.keys(expectedSource).sort(), ['src/commands/env-split.ts', 'src/commands/execution.ts']);
    assert.equal(hash(readFileSync(join(source, 'node_modules/typescript/lib/typescript.js'))), gateProfile.typescriptSha256, 'Unqualified TypeScript CJS dependency');
    const expectedFile = join(harness, 'runtime-probe-expected.json');
    writeFileSync(expectedFile, JSON.stringify(expectedSource), { flag: 'wx' });
    const imports = join(harness, 'runtime-probe-imports'); mkdirSync(imports);
    const physicalExecutable = realpathSync(executable);
    const env = { ...environment, PATH: dirname(physicalExecutable) + ':' + (environment.PATH ?? '/usr/bin:/bin'),
      FULL_GATE_ROOT: physicalRoot, FULL_GATE_SOURCE: physicalSource, FULL_GATE_EXPECTED: expectedFile,
      FULL_GATE_TOOL_ROOTS: '[]', FULL_GATE_IMPORTS: imports,
      NODE_OPTIONS: '--import=' + pathToFileURL(realpathSync(guard)).href };
    const program = `import assert from 'node:assert/strict'; import ts from 'typescript'; import {execFileSync} from 'node:child_process';
await import('./src/commands/execution.ts'); await import('./src/commands/env-split.ts');
assert.match(ts.transpileModule('const value: number = 1;', {}).outputText, /value = 1/);
const childProgram = 'console.log(JSON.stringify({version:process.version,execPath:process.execPath,platform:process.platform,arch:process.arch}))';
const direct = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', childProgram], {encoding:'utf8'}));
const byPath = JSON.parse(execFileSync('node', ['--input-type=module', '-e', childProgram], {encoding:'utf8'}));
const self = {version:process.version,execPath:process.execPath,platform:process.platform,arch:process.arch};
assert.deepEqual(direct,self); assert.deepEqual(byPath,self); console.log(JSON.stringify({self,direct,byPath,typescript:ts.version}));`;
    const result = spawnSync(physicalExecutable, ['--import', 'tsx', '--input-type=module', '-e', program], { cwd: physicalSource, env, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    report.probe = { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
    report.guard = { path: realpathSync(guard), sha256: hash(readFileSync(guard)) };
    report.environment = env;
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, 'Guarded TypeScript/CommonJS feature probe failed');
    report.childIdentities = JSON.parse(result.stdout);
    report.runtime = inspectRuntime(physicalExecutable);
    assert.equal(report.runtime.supported, true, 'Feature success alone does not qualify an unpinned runtime');
    assert.equal(hash(readFileSync(guard)), gateProfile.guardSha256);
    report.status = 0;
    report.scope = 'Guarded loader interoperability plus default PATH/direct-exec child identities, not affected test-body acceptance or all nested absolute-executable tracing';
  } catch (error) { report.reason = error.message; }
  return report;
}

export function requireMatchingLauncher(receipt) {
  assert.equal(receipt.supported, true, 'Runtime must pass pinned external gate policy');
  assert.equal(realpathSync(process.execPath), receipt.identity.path, 'Gate launcher and selected child runtime must match');
  assert.equal(process.version, receipt.identity.version);
}
