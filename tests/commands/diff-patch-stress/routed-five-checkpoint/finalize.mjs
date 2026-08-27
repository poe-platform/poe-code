import assert from 'node:assert/strict';
import { readFile, readdir, readlink, lstat, unlink, rmdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { hash } from '/Users/kjopek/Workspace/safe-bash/benchmarks/expanded/common.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash';
const results = JSON.parse(await readFile('/tmp/safe-bash-routed-five-results.json', 'utf8'));
const before = JSON.parse(await readFile('/tmp/safe-bash-routed-five-before.json', 'utf8'));
const workspace = results.nativeWorkspace;
assert.ok(workspace.startsWith('/tmp/safe-bash-routed-five-native-'));
assert.equal((await lstat(workspace)).isSymbolicLink(), false);
assert.deepEqual((await readdir(workspace)).sort(), ['bin', 'owned-sentinel.txt']);
assert.equal(await readFile(join(workspace, 'owned-sentinel.txt'), 'utf8'), 'Owned by /tmp/safe-bash-routed-five-probe.mjs. Native cases only; unrelated native artifacts untouched.\n');
assert.equal((await lstat(join(workspace, 'bin'))).isSymbolicLink(), false);
assert.deepEqual((await readdir(join(workspace, 'bin'))).sort(), Object.keys(results.tools).sort());
for (const [name, tool] of Object.entries(results.tools)) assert.equal(await readlink(join(workspace, 'bin', name)), tool.executable);
for (const name of Object.keys(results.tools)) await unlink(join(workspace, 'bin', name));
await rmdir(join(workspace, 'bin'));
await unlink(join(workspace, 'owned-sentinel.txt'));
await rmdir(workspace);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const hashes = {};
for (const path of Object.keys(before.hashes)) hashes[path] = hash(await readFile(join(repo, path)));
const changedPaths = Object.keys(hashes).filter(path => hashes[path] !== before.hashes[path]);
const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--short');
const index = git('diff', '--cached', '--raw');
const history = {
  epochNegativeFix: git('show', '2cacd04', '--', 'src/commands/metadata/stat.ts'),
  epochWidthFix: git('show', '0c4709f', '--', 'src/commands/metadata/stat.ts'),
  timestampBlame: git('blame', '-L', '57,61', '--', 'src/commands/metadata/stat.ts'),
  patchOptionBlame: git('blame', '-L', '48,65', '--', 'src/commands/diff-patch/patch.ts'),
  ancestorChecks: ['2cacd04', '0c4709f'].map(revision => {
    git('merge-base', '--is-ancestor', revision, 'bd2cacb');
    return { revision, frozen: 'bd2cacb', exitCode: 0 };
  }),
};
const output = { at: new Date().toISOString(), head, dirty, index, changedPaths, headUnchanged: head === before.head, dirtyUnchanged: dirty === before.dirty, indexUnchanged: index === before.index, hashes, history, cleanup: { workspace, sentinelAndExactSymlinksVerified: true, ownedProfileRemoved: true, nativeCasesAlreadyRemovedByActualRunner: true, unrelatedArtifactsTouched: false } };
const text = JSON.stringify(output, null, 2);
execFileSync('apply_patch', [], { cwd: repo, input: `*** Begin Patch\n*** Add File: /tmp/safe-bash-routed-five-final-state.json\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 32 * 1024 * 1024 });
console.log(JSON.stringify({ head, changedPaths, dirtyUnchanged: output.dirtyUnchanged, indexUnchanged: output.indexUnchanged, cleanup: output.cleanup }));
