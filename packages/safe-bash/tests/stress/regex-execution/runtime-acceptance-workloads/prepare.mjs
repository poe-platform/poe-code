import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/runtime-acceptance-workloads');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const compiler = resolve('node_modules/.bin/tsc');
const build = spawnSync(compiler, ['-p', resolve(owned, 'tsconfig.json')], { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
assert.equal(build.status, 0, build.stdout + build.stderr);
const source = [];
for (const path of ['child.mjs', 'observe.mjs', 'benchmark.mjs', 'guard.mjs', 'binding.mjs', 'prepare.mjs', 'tsconfig.json']) source.push({ path, sha256: hash(await readFile(resolve(owned, path))) });
const emitted = [];
for (const path of ['child.mjs', 'observe.mjs', 'benchmark.mjs']) emitted.push({ path: '.temporary/compiled/' + path, sha256: hash(await readFile(resolve(owned, '.temporary/compiled', path))) });
const priorPaths = ['cleanup-boundary-review/throughput.mjs', 'cleanup-boundary-review/runtime.mjs', 'cleanup-boundary-review/old-five.mjs', 'cleanup-boundary-review/build.mjs', 'cleanup-boundary-review/freeze.mjs', 'production-review/child.mjs', 'production-review/guard.mjs', 'production-continuation-review/child.mjs', 'production-continuation-review/evidence/baseline-freeze.json', 'production-continuation-review/evidence/baseline/build.json'];
const prior = [];
for (const path of priorPaths) prior.push({ path: 'tests/stress/regex-execution/' + path, sha256: hash(await readFile(resolve('tests/stress/regex-execution', path))) });
const commits = { runtime: '1b133a8662a32ee84524794842074c9c98d5f6c3', registration: '01aa1bffe0568cc6787d5ff8e0331e024a787385', fixture: '10273352f8d65d929cbf5a23e69119414dacee60' };
const pinned = [];
for (const [role, paths] of Object.entries({ runtime: ['src/shell/shell.ts', 'src/commands/regex-execution/protocol.ts'], registration: ['src/commands/grep.ts', 'src/commands/search/rg.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/README.md'], fixture: ['tests/commands/regex-execution/followup/messageerror.test.ts'] })) {
  for (const path of paths) pinned.push({ role, path, commit: commits[role], sha256: hash(git('show', `${commits[role]}:${path}`)) });
}
const output = { phase: 'PREPARATION ONLY', time: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, typescript: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).trim(), compile: { status: build.status, stdout: build.stdout, stderr: build.stderr, scope: 'standalone JavaScript harness only; allowJs emit, not product or JS typecheck' }, commits, pinned, source, emitted, prior, worktreeHead: git('rev-parse', 'HEAD').toString().trim(), worktreeStatus: git('status', '--short').toString(), index: git('diff', '--cached', '--name-only').toString(), riskConsumed: 0, additionalSix: 'UNUSED', productExecuted: false, benchmarkExecuted: false };
await mkdir(resolve(owned, 'evidence'), { recursive: true });
await writeFile(resolve(owned, 'evidence/prepared.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ compiled: emitted.length, pinned: pinned.length, riskConsumed: 0 }));
