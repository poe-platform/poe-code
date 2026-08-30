import assert from 'node:assert/strict';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, lstat, readdir, realpath } from 'node:fs/promises';
import { sha, fingerprint, regular, relative, exactJson, verifyTree, writeNew } from '../core.mjs';
import { gitBytes } from '../supervisor.mjs';

export const BASE = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
export const FREEZE = '55810d4aea70fadf151c2fbf746a17f96bfeb599';
const hex = (value, size) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const equal = (left, right, message) => assert.deepEqual(left, right, message);

export function descriptor(entry) {
  relative(entry.path);
  assert.ok(['644', '755'].includes(entry.mode));
  assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && hex(entry.sha256, 64));
  assert.ok(!entry.symlink && !entry.path.split('/').includes('AGENTS.md'));
}

export function validateGrant(grant, reads, requestedWrites = []) {
  assert.ok(grant.precreated === true && grant.fresh === true && grant.initialEntries === 0 && grant.owner === 'preparation-v2');
  assert.ok(path.isAbsolute(grant.root) && path.normalize(grant.root) === grant.root);
  assert.ok(grant.root.includes('/xan-module-review-20260828/preparation-v2/'));
  assert.equal(grant.loaderFallback, false);
  assert.equal(grant.allowNativeSpawn, false);
  assert.equal(grant.allowEval, false);
  for (const read of reads) {
    assert.ok(path.isAbsolute(read));
    assert.ok(read !== grant.root && !read.startsWith(`${grant.root}/`), 'originals and tools not writable');
  }
  for (const target of requestedWrites) {
    assert.ok(path.normalize(target) === target && target.startsWith(`${grant.root}/`), 'emission only');
  }
  return { reads: [...reads], writes: [grant.root], loaderFallback: false };
}

export async function authenticate(handoff, readArtifact, mode) {
  assert.ok(['SYNTHETIC_ONLY', 'CANDIDATE'].includes(mode));
  assert.equal(handoff.schema, 'xan-different-review-v2');
  assert.equal(handoff.classification, mode === 'SYNTHETIC_ONLY' ? 'SYNTHETIC_FIXTURE_NOT_PRODUCT' : 'ROOT_ROUTED_IMMUTABLE_CANDIDATE');
  assert.equal(handoff.freeze, FREEZE);
  assert.equal(handoff.candidate.base, BASE);
  for (const key of ['commit', 'tree', 'baseTree']) assert.ok(hex(handoff.candidate[key], 40));
  assert.ok(Array.isArray(handoff.candidate.delta) && handoff.candidate.delta.length > 0);
  assert.equal(new Set(handoff.candidate.delta).size, handoff.candidate.delta.length);
  for (const name of handoff.candidate.delta) assert.ok(relative(name).startsWith('src/commands/xan/') && /\.(?:ts|mjs)$/.test(name), 'only XAN module files');
  const selected = handoff.selected;
  assert.ok(Array.isArray(selected) && selected.length > 0 && selected.length <= 10000);
  const names = new Set();
  const artifacts = new Map();
  for (const entry of selected) {
    descriptor(entry); assert.ok(!names.has(entry.path)); names.add(entry.path);
    assert.ok(['source', 'build', 'runtime', 'tool', 'receipt', 'adapter', 'consumer'].includes(entry.role));
    const actual = await readArtifact(entry);
    assert.equal(actual.mode, entry.mode); assert.equal(actual.bytes, entry.bytes); assert.equal(actual.sha256, entry.sha256);
    assert.equal(actual.symlink ?? false, false);
    artifacts.set(entry.path, actual);
  }
  for (const role of ['source', 'build', 'runtime', 'tool', 'receipt', 'adapter', 'consumer']) assert.ok(selected.some(entry => entry.role === role), `complete ${role} selection`);
  for (const name of handoff.candidate.delta) assert.ok(selected.some(entry => entry.path === name && entry.role === 'source'), 'every changed XAN module selected');
  const get = ref => {
    assert.ok(ref && typeof ref === 'object' && names.has(ref.path), 'artifact descriptor, not truthy proof');
    const entry = selected.find(item => item.path === ref.path);
    equal({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256, mode: entry.mode }, ref, 'receipt reference binding');
    return entry;
  };
  const json = ref => {
    get(ref); const value = artifacts.get(ref.path);
    assert.ok(value.data instanceof Uint8Array && value.data.length === ref.bytes, 'exact retained JSON size');
    assert.equal(sha(value.data), ref.sha256);
    return JSON.parse(Buffer.from(value.data).toString('utf8'));
  };
  const build = json(handoff.build.receipt);
  equal(build.candidate, handoff.candidate.commit);
  equal(build.inputManifest, handoff.build.inputManifest);
  equal(build.outputManifest, handoff.build.outputManifest);
  equal(build.toolManifest, handoff.build.toolManifest);
  equal(build.exitCode, 0); equal(build.reaped, true); equal(build.truncated, false); equal(build.timedOut, false);
  const inputs = json(handoff.build.inputManifest);
  const outputs = json(handoff.build.outputManifest);
  const tools = json(handoff.build.toolManifest);
  assert.ok(inputs.length && outputs.length && tools.length);
  for (const ref of [...inputs, ...outputs, ...tools]) get(ref);
  equal(inputs.map(ref => ref.path).sort(), selected.filter(entry => ['source', 'build', 'consumer'].includes(entry.role)).map(entry => entry.path).sort(), 'complete selected build input closure');
  equal(tools.map(ref => ref.path).sort(), selected.filter(entry => entry.role === 'tool').map(entry => entry.path).sort(), 'complete selected tools');
  equal(outputs.map(ref => ref.path).sort(), selected.filter(entry => entry.role === 'runtime').map(entry => entry.path).sort(), 'exact build outputs');
  assert.ok(build.command && Array.isArray(build.command.argv) && tools.some(ref => ref.sha256 === build.command.executableSha256));
  equal(build.emissionGrant, handoff.build.emissionGrant);
  validateGrant(handoff.build.emissionGrant, selected.map(entry => path.join(handoff.artifactRoot, entry.path)), outputs.map(ref => path.join(handoff.build.emissionGrant.root, ref.path)));
  const pack = json(handoff.pack.receipt);
  equal(pack.candidate, handoff.candidate.commit); equal(pack.buildReceipt, handoff.build.receipt);
  equal(pack.exitCode, 0); equal(pack.reaped, true); equal(pack.truncated, false);
  const packManifest = json(handoff.pack.manifest);
  equal(pack.manifest, handoff.pack.manifest);
  equal(packManifest, outputs, 'pack tree exactly selected emitted module closure');
  const scope = json(handoff.scope.receipt);
  equal(scope.candidate, handoff.candidate.commit); equal(scope.registryCount, 77); equal(scope.publicXanExport, false);
  equal(scope.base, BASE); equal(scope.delta, handoff.candidate.delta);
  const review = json(handoff.adapter.reviewReceipt);
  equal(review.candidate, handoff.candidate.commit); equal(review.module, handoff.module);
  equal(review.adapter, handoff.adapter.entry); get(handoff.adapter.entry);
  for (const name of ['sourceReviewed', 'actualFactoryBound', 'actualCandidateLocalRegistration', 'sourceCapacityLifetimeAudit', 'actualFsErrorBinding', 'noNativeFallback', 'noEvalFallback']) equal(review[name], true, `review prerequisite ${name}`);
  assert.ok(typeof handoff.module.factoryExport === 'string' && handoff.module.factoryExport.length);
  assert.equal(handoff.module.shape, 'CommandDefinition');
  equal(review.drivers, ['direct', 'shell', 'lifecycle', 'filesystem', 'resources', 'guards']);
  get(handoff.module.entry);
  equal(Object.keys(handoff.layouts).sort(), ['INSTALLED_MOVED', 'SOURCE']);
  for (const layout of Object.values(handoff.layouts)) {
    assert.ok(path.isAbsolute(layout.root));
    equal(layout.entries, [...outputs, handoff.adapter.entry]);
    assert.equal(layout.entry, handoff.module.entry.path);
    assert.equal(layout.adapter, handoff.adapter.entry.path);
    assert.equal(layout.sourceFallback, false);
    assert.ok(Array.isArray(layout.builtins));
  }
  assert.notEqual(handoff.layouts.SOURCE.root, handoff.layouts.INSTALLED_MOVED.root);
  return { admitted: true, mode, candidate: handoff.candidate.commit, artifacts: selected.length, review, productEvidence: mode === 'CANDIDATE' };
}

export async function diskArtifact(root, entry) {
  const filename = await regular(root, entry.path);
  const actual = await fingerprint(filename, entry.bytes);
  if (entry.role !== 'receipt') return actual;
  const parsed = await exactJson(filename, entry);
  const handle = await open(filename, 'r');
  try {
    const data = Buffer.alloc(entry.bytes);
    let offset = 0;
    while (offset < data.length) { const { bytesRead } = await handle.read(data, offset, data.length - offset, offset); assert.ok(bytesRead); offset += bytesRead; }
    assert.equal(sha(data), entry.sha256); assert.ok(parsed !== undefined);
    return { ...actual, data };
  } finally { await handle.close(); }
}

export async function authenticateGit(handoff, repo) {
  const candidate = handoff.candidate;
  const actual = (await gitBytes(['rev-parse', `${candidate.commit}^{tree}`, `${BASE}^{tree}`], 82, repo)).toString().trim().split('\n');
  equal(actual, [candidate.tree, candidate.baseTree]);
  const delta = (await gitBytes(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', BASE, candidate.commit], 262144, repo)).toString().split('\0').filter(Boolean).sort();
  equal(delta, [...candidate.delta].sort());
  for (const entry of handoff.selected.filter(item => ['source', 'build', 'consumer'].includes(item.role))) {
    assert.ok(hex(entry.gitBlob, 40));
    const line = (await gitBytes(['ls-tree', candidate.commit, '--', entry.path], 2048, repo)).toString().trim();
    equal(line, `100${entry.mode} blob ${entry.gitBlob}\t${entry.path}`);
  }
}

export async function freshGrant(root) {
  await mkdir(root, { recursive: false });
  const stat = await lstat(root); assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(await realpath(root), root); assert.equal((await readdir(root)).length, 0);
  return { root, precreated: true, fresh: true, initialEntries: 0, owner: 'preparation-v2', loaderFallback: false, allowNativeSpawn: false, allowEval: false };
}

export async function moveInstalled(layout, parent) {
  await verifyTree(layout.root, layout.entries);
  const original = path.join(parent, 'original'); const moved = path.join(parent, 'moved');
  await mkdir(original);
  for (const entry of layout.entries) {
    const destination = path.join(original, relative(entry.path));
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx', Number.parseInt(entry.mode, 8));
    try {
      for await (const chunk of createReadStream(await regular(layout.root, entry.path), { highWaterMark: 65536 })) {
        let offset = 0;
        while (offset < chunk.length) { const { bytesWritten } = await handle.write(chunk.subarray(offset)); assert.ok(bytesWritten); offset += bytesWritten; }
      }
      await handle.sync();
    } finally { await handle.close(); }
  }
  await verifyTree(original, layout.entries); await rename(original, moved);
  await assert.rejects(lstat(original), { code: 'ENOENT' }); await verifyTree(moved, layout.entries);
  await writeNew(path.join(parent, 'MOVE.json'), { original, moved, originalAbsent: true, sourceFallback: false, entries: layout.entries });
  return moved;
}
