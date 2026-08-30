import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stageBaseline, ownRoot } from './stage-baseline.mjs';
import { hash, save, inventory, copyRegular } from '../execution-prep-v1/artifacts.mjs';
import { sourceDelta, packageDelta } from './guards.mjs';
export const candidate = 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a';
export const candidateTree = '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e';
export const candidatePack = 'b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa';
const repository = resolve(ownRoot, '../../..');
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
function compose(tree, prefix, overrides) {
  return objectHash('tree', Buffer.concat(git(['ls-tree', '-z', tree]).toString().split('\0').filter(Boolean).map(record => {
    const [, mode, type, previous, name] = /^(\d+) (blob|tree) ([a-f0-9]{40})\t(.+)$/u.exec(record);
    const namePath = prefix + name;
    const next = overrides[namePath] ?? (type === 'tree' && Object.keys(overrides).some(key => key.startsWith(namePath + '/')) ? compose(previous, namePath + '/', overrides) : previous);
    return Buffer.concat([Buffer.from(`${mode.replace(/^0+/u, '')} ${name}\0`), Buffer.from(next, 'hex')]);
  })));
}
export function stageCandidate(revision) {
  const base = stageBaseline(revision, 'candidate-01');
  const sourceRoot = join(base.work, 'selected-source'), buildRoot = join(base.work, 'build'), overrides = { ...base.binding.overrides };
  mkdirSync(sourceRoot); const candidateInputs = [];
  for (const before of base.binding.source) {
    const changed = ['src/shell/runtime.ts', 'src/shell/shell.ts'].includes(before.path);
    const bytes = git(['show', `${changed ? candidate : before.commit}:${before.path}`]);
    const after = { ...before, commit: changed ? candidate : before.commit, bytes: bytes.length, sha256: hash(bytes), blob: objectHash('blob', bytes) };
    if (!changed) assert.deepEqual(after, before); else overrides[before.path] = after.blob;
    const target = join(sourceRoot, before.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' }); chmodSync(target, parseInt(after.mode, 8) & 0o777);
    candidateInputs.push(after);
  }
  assert.deepEqual(sourceDelta(base.binding, candidateInputs), ['src/shell/runtime.ts', 'src/shell/shell.ts']);
  assert.equal(compose(base.binding.baselineTree, '', overrides), candidateTree);
  copyRegular(sourceRoot, buildRoot);
  for (const tool of base.binding.typeTools) copyRegular(join(base.moved, 'node_modules', tool.name), join(buildRoot, 'node_modules', tool.name));
  const npm = JSON.parse(readFileSync(join(base.harnessRoot, 'execution-v2/NPM-TOOLS.json')));
  assert.deepEqual(inventory(npm.root), npm.files);
  for (const name of ['home', 'tmp', 'cache', 'packs']) mkdirSync(join(base.work, name));
  for (const name of ['npm-user-config', 'npm-global-config']) writeFileSync(join(base.work, name), '', { flag: 'wx' });
  const env = { PATH: dirname(base.binding.node.path) + ':' + join(buildRoot, 'node_modules/typescript/bin') + ':/usr/bin:/bin', HOME: join(base.work, 'home'), TMPDIR: join(base.work, 'tmp'), LC_ALL: 'C', TZ: 'UTC', npm_config_cache: join(base.work, 'cache'), npm_config_userconfig: join(base.work, 'npm-user-config'), npm_config_globalconfig: join(base.work, 'npm-global-config'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  return { ...base, candidate, candidateTree, candidateInputs, sourceRoot, sourceBefore: inventory(sourceRoot), buildRoot, npm, env, npmCli: join(npm.root, 'bin/npm-cli.js') };
}
export function inspectBuiltPack(stage, path) {
  const bytes = readFileSync(path); assert.equal(hash(bytes), candidatePack);
  const packed = packageDelta(stage.binding, bytes);
  const meta = JSON.parse(readFileSync(join(stage.buildRoot, 'package.json')));
  assert.deepEqual(meta.dependencies ?? {}, {});
  return { ...packed, path, metadata: meta };
}
