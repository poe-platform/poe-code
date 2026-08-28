import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const baselineTree = '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e';
export const baselinePack = 'b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function loadBaseline(repository) {
  const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024, timeout: 10000 });
  const prefix = 'tests/shell/dotglob-independent-20260828/';
  const encoded = git(['show', `8fa48028:${prefix}continuation-evidence-v2/continuation-01/RESULT.json.gz.base64`]);
  assert.equal(hash(encoded), '0905f3527db37322085a7a28844d1045cfaed1fa4a8488c5c796c93fdaacb0e4');
  const raw = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 24 * 1024 * 1024 });
  assert.equal(hash(raw), 'd2fac566f155013419709bcd5c94a5cbc970d83a268771507e3f045b4a511e51');
  const result = JSON.parse(raw);
  assert.equal(result.binding.composition, baselineTree);
  assert.equal(result.pack.sha256, baselinePack);
  assert.equal(result.binding.candidateInputs.length, 265);
  assert.equal(Object.keys(result.pack.members).length, 846);
  const stack = JSON.parse(git(['show', `8fa48028:${prefix}stack-binding-v1/BINDING.json`]));
  const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
  const overrides = { ...stack.overrides };
  for (const entry of result.binding.candidateInputs) {
    assert.ok(!entry.path.split('/').includes('AGENTS.md'));
    const bytes = git(['show', `${entry.commit}:${entry.path}`]);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
    assert.equal(objectHash('blob', bytes), entry.blob);
    if (['src/shell/runtime.ts', 'src/shell/shell.ts'].includes(entry.path)) overrides[entry.path] = entry.blob;
  }
  const compose = (tree, prefix = '') => objectHash('tree', Buffer.concat(git(['ls-tree', '-z', tree]).toString().split('\0').filter(Boolean).map(record => {
    const matched = /^(\d+) (blob|tree) ([a-f0-9]{40})\t(.+)$/u.exec(record);
    assert.ok(matched);
    const [, mode, type, old, name] = matched;
    const path = prefix + name;
    const next = overrides[path] ?? (type === 'tree' && Object.keys(overrides).some(key => key.startsWith(path + '/')) ? compose(old, path + '/') : old);
    return Buffer.concat([Buffer.from(`${mode.replace(/^0+/u, '')} ${name}\0`), Buffer.from(next, 'hex')]);
  })));
  assert.equal(compose(stack.baselineTree), baselineTree);
  const pack = Buffer.from(git(['show', `8fa48028:${prefix}continuation-evidence-v2/continuation-01/PACKAGE.tgz.base64`]).toString().trim(), 'base64');
  assert.equal(hash(pack), baselinePack);
  return { tree: baselineTree, packSha256: baselinePack, source: result.binding.candidateInputs,
    packageMembers: result.pack.members, node: result.binding.node, defaultNames: stack.defaultNames,
    typeTools: stack.typeTools, evidenceSha256: hash(raw), provenance: 'immutable metadata/blob authentication only; no product execution' };
}
