import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidate = 'f1a90436c45208ca248e058a039893233c608daa';
const baseline = '45baf7647124282bf52cd843656b6e190746580a';
const oracle = '/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = spawnSync('/usr/bin/git', args, { cwd: repository, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const toolEvidence = JSON.parse(git(['show', '0579a239:tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json']));
const selected = ['src', 'tests/commands/tree', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const inventory = async root => {
  const rows = {};
  const visit = async relative => {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const child = join(relative, name), stat = await lstat(join(root, child));
      assert.equal(stat.isSymbolicLink(), false, child);
      if (stat.isDirectory()) { rows[child] = { type: 'directory' }; await visit(child); }
      else { assert.ok(stat.isFile()); rows[child] = { type: 'file', sha256: hash(await readFile(join(root, child))) }; }
    }
  };
  await visit('');
  return rows;
};
const scratch = await mkdtemp(join(tmpdir(), 'safe-bash-tree-charset-frozen-'));
const report = { candidate, baseline, node: { path: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)) },
  oracle: { path: oracle, sha256: hash(await readFile(oracle)) }, tools: toolEvidence.tools, revisions: [], wholeGate: false };
assert.equal(report.oracle.sha256, '34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a');
try {
  for (const revision of [baseline, candidate]) {
    const root = join(scratch, revision); await mkdir(root);
    const tracked = git(['ls-tree', '-r', revision, '--', ...selected]).toString().trim().split('\n');
    assert.ok(tracked.every(line => line.startsWith('100644 blob ')), 'regular-file source only');
    const archive = git(['archive', revision, ...selected]);
    const extracted = spawnSync('/usr/bin/tar', ['-xf', '-', '-C', root], { input: archive, timeout: 30000 });
    assert.equal(extracted.status, 0);
    const sourceBefore = await inventory(root);
    for (const [relative, metadata] of Object.entries(toolEvidence.tools)) {
      const bytes = await readFile(join(repository, 'node_modules', relative));
      assert.equal(hash(bytes), metadata.sha256, relative);
      const destination = join(root, 'node_modules', relative);
      await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); await chmod(destination, metadata.mode);
    }
    const toolsBefore = await inventory(join(root, 'node_modules'));
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TREE_NATIVE_BIN: oracle };
    const phases = [];
    const execute = (name, args) => {
      const result = spawnSync(process.execPath, args, { cwd: root, env, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
      const stdout = result.stdout?.toString() ?? '', stderr = result.stderr?.toString() ?? '';
      phases.push({ name, args, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr,
        counts: Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) });
    };
    const testFiles = (await readdir(join(root, 'tests/commands/tree'))).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/commands/tree/${name}`);
    execute('all-tree-tests-with-pinned-native', ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=2', ...testFiles]);
    execute('scoped-strict-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--skipLibCheck', 'false', '-p', 'tests/commands/tree/tsconfig.json']);
    execute('source-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
    const after = await inventory(root);
    for (const [name, metadata] of Object.entries(sourceBefore)) assert.deepEqual(after[name], metadata, `changed frozen source ${name}`);
    const additions = Object.keys(after).filter(name => !(name in sourceBefore) && name !== 'node_modules' && !name.startsWith('node_modules/') && name !== 'dist' && !name.startsWith('dist/'));
    assert.deepEqual(additions, [], 'unexpected new source/test entries');
    assert.deepEqual(await inventory(join(root, 'node_modules')), toolsBefore);
    const dist = Object.fromEntries(Object.entries(after).filter(([name, metadata]) => name.startsWith('dist/') && metadata.type === 'file'));
    report.revisions.push({ revision, archiveSha256: hash(archive), sourceBefore, phases, dist, sourceAndToolsUnchanged: true,
      newEntryCheck: 'all candidate entries checked; only explicitly generated dist and pinned node_modules allowed' });
  }
  assert.equal(hash(await readFile(oracle)), report.oracle.sha256);
  report.allPhasesPass = report.revisions.every(revision => revision.phases.every(phase => phase.exitCode === 0));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.allPhasesPass) process.exitCode = 1;
} finally { await rm(scratch, { recursive: true, force: true }); }
