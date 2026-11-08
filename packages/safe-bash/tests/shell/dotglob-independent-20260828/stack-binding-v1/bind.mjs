import assert from 'node:assert/strict';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, packInventory } from '../execution-prep-v1/artifacts.mjs';

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const review = '0fe2274a28f251370e9894cf30bb215f80b600d0';
const prefix = 'tests/shell/directory-stack-independent-20260828/review-3e4cd743/';
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const read = name => git(['show', `${review}:${prefix}${name}`]);
const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const binding = JSON.parse(read('BINDING-v1.json'));
const reconstruction = JSON.parse(gunzipSync(Buffer.from(read('RECONSTRUCTION-v1.json.gz.base64').toString().trim(), 'base64'), { maxOutputLength: 16 * 1024 * 1024 }));
function compose(tree, prefix, overrides) {
  const records = git(['ls-tree', '-z', tree]).toString().split('\0').filter(Boolean);
  return objectHash('tree', Buffer.concat(records.map(record => {
    const match = /^(\d+) (blob|tree) ([a-f0-9]{40})\t(.+)$/u.exec(record);
    assert.ok(match);
    const [, mode, type, old, name] = match, path = prefix + name;
    const object = overrides[path] ?? (type === 'tree' && Object.keys(overrides).some(key => key.startsWith(path + '/')) ? compose(old, path + '/', overrides) : old);
    return Buffer.concat([Buffer.from(`${mode.replace(/^0+/u, '')} ${name}\0`), Buffer.from(object, 'hex')]);
  })));
}
assert.equal(binding.source.length, 265);
for (const entry of binding.source) {
  assert.equal(entry.path.split('/').includes('AGENTS.md'), false);
  const bytes = git(['show', `${entry.commit}:${entry.path}`]);
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  assert.equal(objectHash('blob', bytes), entry.blob);
}
const runtime = binding.source.find(entry => entry.path === 'src/shell/runtime.ts');
const shell = binding.source.find(entry => entry.path === 'src/shell/shell.ts');
assert.equal(runtime.blob, '9ff4aa32354f15901ed18e7e57aa30f812d34b14');
assert.equal(shell.blob, '0ebf7efa77df77707d594fa55c89af4db891ee87');
const composition = compose(reconstruction.baselineTree, '', reconstruction.overrides);
assert.equal(composition, '099455f232870fa1ea59e1a0ae482e003fd170db');
const oldRuntime = git(['rev-parse', 'c26892c3a1a419311c9cf46a6c2976e696e00624:src/shell/runtime.ts']).toString().trim();
const oldOverrides = { ...reconstruction.overrides, 'src/shell/runtime.ts': oldRuntime };
delete oldOverrides['src/shell/shell.ts'];
assert.equal(compose(reconstruction.baselineTree, '', oldOverrides), '3e3a2fe381e11540213285e14e2a9a55a72bdbdd');
const pack = Buffer.from(read('PACKAGE-v1.tgz.base64').toString().trim(), 'base64');
assert.equal(hash(pack), '15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18');
const members = packInventory(pack);
assert.equal(Object.keys(members).length, 846);
assert.equal(members['README.md'].sha256, '87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1');
const tools = JSON.parse(read('TOOLS-v2.json'));
const selectedTools = tools.packages.filter(entry => ['typescript', '@types/node', 'undici-types'].includes(entry.name));
for (const tool of selectedTools) for (const [name, expected] of Object.entries(tool.inventory.files)) {
  const path = resolve(tool.root, name), stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(hash(readFileSync(path)), expected.sha256, path);
}
assert.equal(realpathSync(process.execPath), tools.node.path);
assert.equal(hash(readFileSync(tools.node.path)), tools.node.sha256);
const inventory = JSON.parse(read('INVENTORY-v1.json'));
assert.equal(inventory.defaultNames.length, 77);
console.log(JSON.stringify({
  kind: 'dotglob-accepted-stack-baseline-binding-v1', date: '2026-08-28',
  authority: 'Root accepts qualified STACK and permits presealed bounded immutable-baseline calibration only; DOTGLOB candidate inspection/execution not authorized here.',
  acceptedStackSource: binding.candidate, acceptedReview: review, additiveReview: '1446a706',
  qualifications: { supportedOriginalObligations: 136, C06: 'partial; genuinely escaping-control versus local selection source-only portion retained', S13: 'original /bin/sh fixture unsupported', unconditional138: false, carriedLoadsPerCase: 207, freshReviewClaim: false },
  cdLetBaseComposition: '3e3a2fe381e11540213285e14e2a9a55a72bdbdd', acceptedComposition: composition,
  treeIdentityRole: 'Mathematical Git tree composition authenticated from existing immutable tree metadata and reachable blobs; not a loose commit/object, not current HEAD.',
  baselineTree: reconstruction.baselineTree, overrides: reconstruction.overrides, source: binding.source,
  package: { revision: review, path: prefix + 'PACKAGE-v1.tgz.base64', encodedSha256: hash(read('PACKAGE-v1.tgz.base64')), sha256: hash(pack), bytes: pack.length, members },
  evidence: Object.fromEntries(['BINDING-v1.json', 'RECONSTRUCTION-v1.json.gz.base64', 'TOOLS-v2.json', 'INVENTORY-v1.json', 'HANDOFF.md'].map(name => [prefix + name, { revision: review, sha256: hash(read(name)) }])),
  node: tools.node, typeTools: selectedTools, defaultNames: inventory.defaultNames,
  frozenInputs: { original: '429766aaa9fee0be469ed79b186bc8e3b3ed43c2', overlay: 'deced72dde70151b1b090fbba7d739323491cd89', preparation: 'd5cdd3a3983c32fba8aa1d7d9a4a0d8917a47a45', syntheticEvidence: 'c7f56b1c', priorSyntheticGroups: 42, priorReapedChildren: 38, productPassesFromSynthetic: 0 },
  held: { dotglobCandidate: null, candidateExecution: false, candidateInspection: false },
  initialReadObservation: 'git show 099455... and rev-parse 3e3a2fe abbreviated revision failed because these are composed-tree identities, not available loose objects; no fallback or product execution followed.',
}, null, 2));
