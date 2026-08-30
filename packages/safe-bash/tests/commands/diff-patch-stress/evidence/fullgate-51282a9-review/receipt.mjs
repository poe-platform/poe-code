import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { release } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, git, hash, save } from './replay.mjs';

const gate = JSON.parse(readFileSync(`${base}/final-gate.json`, 'utf8'));
const directory = resolve(base, '.scratch/final-corrected');
const metadataBase = 'tests/commands/metadata-stress/evidence/fullgate-51282a9-review';
for (const entry of gate.before) assert.equal(hash(readFileSync(resolve(directory, entry.path))), entry.sha256, entry.path);
const extraPaths = git('ls-tree', '-r', '--name-only', gate.revision, 'tests/commands/diff-patch', 'tests/commands/stream-next-stress/independent.review.ts', 'tests/commands/stream-next-stress/tsconfig.scoped.json').toString().trim().split('\n');
const extra = extraPaths.map(path => {
  const actual = hash(readFileSync(resolve(directory, path)));
  assert.equal(actual, hash(git('show', `${gate.revision}:${path}`)));
  return { path, sha256: actual };
});
const natives = gate.nativeOverlay.map(entry => {
  const source = { sha256: hash(readFileSync(entry.source)), mode: statSync(entry.source).mode };
  const target = { sha256: hash(readFileSync(entry.target)), mode: statSync(entry.target).mode };
  assert.equal(source.sha256, entry.expected);
  assert.deepEqual(target, source);
  return { ...entry, sourceAfter: source, targetAfter: target };
});
const { oracleIdentity } = await import(pathToFileURL(resolve(directory, 'tests/commands/diff-patch-stress/gnu-target/oracle.ts')));
const patchDiffPins = ['gnu', 'apple-calibration'].flatMap(profile => ['diff', 'patch'].map(tool => ({ profile, tool, ...oracleIdentity(tool, profile) })));
const failedNames = path => [...readFileSync(path, 'utf8').matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
assert.deepEqual(failedNames(`${base}/final-qualified-original31.tap.txt`), failedNames(`${base}/initial-qualified-original31.tap.txt`));
assert.equal(failedNames(`${base}/final-qualified-original31.tap.txt`).length, 9);
const helpers = [base, metadataBase].flatMap(parent => readdirSync(parent).filter(name => name.endsWith('.mjs')).map(name => ({ path: `${parent}/${name}`, sha256: hash(readFileSync(`${parent}/${name}`)) })));
const tools = ['tsx', 'typescript'].map(name => {
  const path = resolve('node_modules', name, 'package.json');
  const bytes = readFileSync(path);
  return { name, version: JSON.parse(bytes).version, sha256: hash(bytes) };
});
save(`${base}/final-receipt.json`, { completedAt: new Date().toISOString(), revision: gate.revision, tree: git('rev-parse', `${gate.revision}^{tree}`).toString().trim(), reviewedInputsUnchanged: gate.before.length, extra, natives, patchDiffPins, originalFailureNames: failedNames(`${base}/final-qualified-original31.tap.txt`), helpers, tools, node: { version: process.version, executable: process.execPath, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch, kernel: release() }, rootHeadAtCompletion: git('rev-parse', 'HEAD').toString().trim(), indexBeforeFinalCommit: git('diff', '--cached', '--name-status').toString(), worktreeBeforeFinalCommit: git('status', '--short').toString(), limitation: 'Source acceptance binds the frozen commit, not the later mutable repository HEAD. Extra author3758 report authenticated but not independently rerun; project release wiring remains pending.' });
console.log({ source: gate.revision, unchangedInputs: gate.before.length, extraInputs: extra.length, nativeAssets: natives.length, helperHashes: helpers.length, retainedOriginalFailures: 9 });
