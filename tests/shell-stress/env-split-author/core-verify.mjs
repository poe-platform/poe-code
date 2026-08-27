import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const base = 'c3fbda6279028fd2bde9f6d967970870ff7546aa';
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' }).trim().split('\n');
if (!sourcePaths.includes('src/commands/env-split.ts')) sourcePaths.push('src/commands/env-split.ts');
sourcePaths.sort();
const author = ['tests/shell/env-split-native.test.ts', 'tests/shell/env-split-host.test.ts', 'tests/shell/env-split-limits.test.ts'];
const legacy = [
  'tests/commands/execution.test.ts', 'tests/shell/env-replacement.test.ts', 'tests/shell/env-replacement-bounds.test.ts',
  'tests/shell/errexit-native.test.ts', 'tests/shell/errexit-extra.test.ts', 'tests/shell/errexit-host.test.ts',
  'tests/shell/invocation-modes.test.ts', 'tests/shell/input-units.test.ts', 'tests/shell/stdin-origin.test.ts',
  'tests/shell/descriptor-inheritance.test.ts', 'tests/shell/output-accounting.test.ts', 'tests/shell/output-accounting-bounds.test.ts',
  'tests/shell/invocation-cleanup.test.ts', 'tests/shell/source-dot-eval-source.test.ts', 'tests/shell/source-dot-eval-eval.test.ts',
];
const inventory = {};
for (const config of ['tsconfig.json', 'tsconfig.build.json']) {
  const read = ts.readConfigFile(config, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, '.');
  assert.equal(parsed.errors.length, 0);
  inventory[config] = parsed.fileNames.sort();
}
const paths = [...new Set([...sourcePaths, ...author, ...legacy, ...Object.values(inventory).flat(), 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'package-lock.json', 'node_modules/typescript/package.json', 'node_modules/tsx/package.json'])].sort();
const snapshot = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(path))])));
const before = await snapshot();
const original = execFileSync('git', ['show', `${base}:src/commands/execution.ts`], { encoding: 'utf8' });
const current = await readFile('src/commands/execution.ts', 'utf8');
assert.equal(current.slice(current.indexOf('    define("xargs"')), original.slice(original.indexOf('    define("xargs"')));
assert.equal(current.slice(0, current.indexOf('    define("env"')).replace('import { EnvSplitError, parseEnvOptions } from "./env-split.js";\n', ''), original.slice(0, original.indexOf('    define("env"')));
const frozen = JSON.parse(await readFile('tests/shell-stress/env-split-author/resume-seal.json', 'utf8'));
for (const [path, digest] of Object.entries(frozen.files)) assert.equal(hash(await readFile(path)), digest, `Frozen preparation changed: ${path}`);
const report = { base, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), date: new Date().toISOString(), node: process.version, typescript: ts.version, importedRuntime: import.meta.resolve('../../../src/shell/runtime.js'), importedEnv: import.meta.resolve('../../../src/commands/execution.js'), importedHelper: import.meta.resolve('../../../src/commands/env-split.js'), sourcePaths, inventory, before, frozenPreparationUnchanged: true, unrelatedExecutionBytesUnchanged: true, commands: [] };
for (const imported of [report.importedRuntime, report.importedEnv, report.importedHelper]) assert.match(imported, /\.ts$/u);
const run = (name, args, timeout = 60000) => {
  const child = spawnSync(process.execPath, args, { detached: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  report.commands.push({ name, args, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout?.toString(), stderr: child.stderr?.toString(), pid: child.pid });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
};
run('author', ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec', ...author]);
run('legacy', ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec', ...legacy]);
run('scoped-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', ...author, 'tests/shell-stress/env-split-author/resume-host.ts']);
run('global-types', ['node_modules/typescript/bin/tsc', '--noEmit'], 120000);
run('build-types', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--noEmit'], 120000);
const after = await snapshot();
report.changedGuards = paths.filter(path => before[path] !== after[path]);
report.afterChanges = Object.fromEntries(report.changedGuards.map(path => [path, after[path]]));
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ commands: report.commands.map(({name,status}) => ({name,status})), changedGuards: report.changedGuards, sourceInputs: sourcePaths.length, typecheckRootInputs: inventory['tsconfig.json'].length }));
