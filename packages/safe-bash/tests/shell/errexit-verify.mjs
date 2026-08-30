import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/') && !existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const testArgs = paths => ['--unhandled-rejections=strict', '--import', 'tsx', '--import', './tests/shell/invocation-discovery-fixes-imports.mjs', '--test', '--test-concurrency=1', ...paths];
const commands = [
  ['errexit-author', process.execPath, testArgs(['tests/shell/errexit-native.test.ts', 'tests/shell/errexit-extra.test.ts', 'tests/shell/errexit-host.test.ts'])],
  ['parser-state', process.execPath, testArgs(['tests/shell/parser-regressions.test.ts', 'tests/shell/core.test.ts', 'tests/shell/runtime-regressions.test.ts', 'tests/shell/variable-scope.test.ts', 'tests/shell/positional-ifs.test.ts', 'tests/shell/input-units.test.ts', 'tests/shell/descriptor-inheritance.test.ts', 'tests/shell/stdin-origin.test.ts', 'tests/shell/fatal-expansion.test.ts'])],
  ['invocation', process.execPath, testArgs(['tests/shell/invocation-modes.test.ts', 'tests/shell/invoke.test.ts', 'tests/shell/invocation-closure-discovery.test.ts', 'tests/shell/invocation-closure-read.test.ts', 'tests/shell/invocation-closure-sh.test.ts'])],
  ['source-eval', process.execPath, testArgs(['tests/shell/source-dot-eval-source.test.ts', 'tests/shell/source-dot-eval-source-host.test.ts', 'tests/shell/source-dot-eval-eval.test.ts', 'tests/shell/source-dot-eval-eval-host.test.ts'])],
  ['current-shell', process.execPath, testArgs(['tests/shell-stress/current-shell/current-shell.test.ts'])],
  ['file-entry', process.execPath, testArgs(['tests/shell/script-entrypoint.test.ts', 'tests/shell/expanded-gaps-env.test.ts', 'tests/shell/expanded-gaps-env-host.test.ts', 'tests/shell/expanded-gaps-fallback.test.ts', 'tests/shell/expanded-gaps-fallback-host.test.ts', 'tests/shell/unsupported-options.test.ts'])],
];
for (const [name, args] of [['global', []], ['build', ['-p', 'tsconfig.build.json']], ['benchmark', ['-p', 'benchmarks/tsconfig.json']]]) commands.push([name, './node_modules/.bin/tsc', [...args, '--noEmit', '--listFiles']]);
function inventory() {
  const paths = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|json|mjs)$/.test(path)) paths.push(resolve(path));
    }
  };
  visit('src'); visit('tests/shell'); visit('tests/shell-stress/current-shell');
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json']) if (existsSync(path)) paths.push(resolve(path));
  return paths;
}
const manifests = {};
const manifest = values => { const digest = hash(JSON.stringify(values)); manifests[digest] = values; return digest; };
const snapshot = paths => Object.fromEntries([...new Set(paths)].sort().map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
const report = { head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), node: process.version, runs: [], manifests };
for (const [name, executable, args] of commands.filter(command => process.argv[3] !== 'compilers' || command[0] === 'errexit-author' || command[1].endsWith('/tsc'))) {
  const compiler = executable.endsWith('/tsc');
  const enumeration = compiler ? spawnSync(executable, args.map(arg => arg === '--listFiles' ? '--listFilesOnly' : arg), { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }) : undefined;
  if (enumeration) assert.equal(enumeration.status, 0, enumeration.stderr);
  const compilerPaths = enumeration?.stdout.split('\n').filter(path => path.startsWith('/') && /\.\w*ts$/.test(path)) ?? [];
  const paths = [...inventory(), ...compilerPaths];
  const before = snapshot(paths);
  const importsPath = `${output}.${name}.imports`;
  const result = spawnSync(executable, args, { env: { ...process.env, DISCOVERY_FIX_IMPORTS: importsPath }, detached: true, timeout: compiler ? 90000 : 15000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  if (result.pid) { try { process.kill(-result.pid, 'SIGKILL'); } catch {} }
  const after = snapshot([...paths, ...inventory()]);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const imports = existsSync(importsPath) ? readFileSync(importsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const importedMismatch = imports.filter(entry => entry.hash !== before[entry.path] || entry.hash !== after[entry.path]);
  const stdout = result.stdout?.toString() ?? '';
  const actualCompilerPaths = compiler ? stdout.split('\n').filter(path => path.startsWith('/') && /\.\w*ts$/.test(path)) : [];
  const unguardedCompilerPaths = actualCompilerPaths.filter(path => !(path in before));
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const raw = stdout + (result.stderr?.toString() ?? '');
  writeFileSync(`${output}.${name}.log`, raw, { flag: 'wx' });
  const run = { name, executable, args, pid: result.pid, status: result.status, error: result.error?.message, counts, rawHash: hash(raw), before: manifest(before), after: manifest(after), changed, importedMismatch, actualImports: manifest(Object.fromEntries(imports.map(entry => [entry.path, entry.hash]))), compilerInputs: manifest(snapshot(compilerPaths)), compilerInputCount: compilerPaths.length, unguardedCompilerPaths };
  report.runs.push(run);
  console.log(JSON.stringify({ name, status: run.status, counts, changed, importedMismatch: importedMismatch.length, unguardedCompilerPaths, compilerInputCount: compilerPaths.length }));
}
for (const run of report.runs) if (run.pid) for (const target of [run.pid, -run.pid]) assert.throws(() => process.kill(target, 0), error => error.code === 'ESRCH');
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
